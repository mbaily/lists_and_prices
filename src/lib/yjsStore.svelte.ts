/**
 * Central Yjs document and provider setup.
 * One Y.Doc per authenticated user, keyed by username.
 * Synced via y-websocket; persisted locally via y-indexeddb.
 */
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { WebsocketProvider } from 'y-websocket';

export type ItemType = 'plain' | 'priced';
export type SyncStatus = 'offline' | 'connecting' | 'synced';

/** True once y-indexeddb has finished loading persisted data into the Y.Doc. */
export const idbSynced = $state<{ done: boolean }>({ done: false });

// ─── Reactive state (Svelte 5 runes – used in components via import) ──────────
// We export plain objects that components can $state-wrap or read directly.

let _doc: Y.Doc | null = null;
let _wsProvider: WebsocketProvider | null = null;
let _idbProvider: IndexeddbPersistence | null = null;

let _historicalDoc: Y.Doc | null = null;

export const syncState = $state<{ status: SyncStatus }>({ status: 'offline' });
export const commitState = $state<{ isHistorical: boolean, commitId: string | null }>({ isHistorical: false, commitId: null });


/** Increments on every Yjs doc update — derive from this to re-read data reactively. */
export const docState = $state<{ version: number }>({ version: 0 });

/** Call once after login to initialise the shared Y.Doc for this user. */
export function initYjs(username: string, wsUrl: string) {
	console.log(`[Perf] initYjs started for user ${username}`);
	const t0 = performance.now();

	if (_doc) destroyYjs();

	const doc = new Y.Doc({ gc: false });
	_doc = doc;

	idbSynced.done = false;
	const tIdbStart = performance.now();
	_idbProvider = new IndexeddbPersistence(`pnl-${username}`, doc);
	_idbProvider.on('synced', () => {
		const tIdbEnd = performance.now();
		console.log(`[Perf] IndexedDB synced in ${Math.round(tIdbEnd - tIdbStart)}ms`);
		idbSynced.done = true;
		docState.version++;
	});

	const tWsStart = performance.now();
	_wsProvider = new WebsocketProvider(wsUrl, `pnl-${username}`, doc, {
		connect: true
	});

	syncState.status = 'connecting';

	doc.on('update', () => { docState.version++; });

	_wsProvider.on('status', ({ status }: { status: string }) => {
		const tWsStatus = performance.now();
		console.log(`[Perf] WebSocket status changed to '${status}' at ${Math.round(tWsStatus - tWsStart)}ms`);
		if (status === 'connected') syncState.status = 'synced';
		else if (status === 'connecting') syncState.status = 'connecting';
		else syncState.status = 'offline';
	});

	const tEnd = performance.now();
	console.log(`[Perf] initYjs synchronous setup completed in ${Math.round(tEnd - t0)}ms`);
	return doc;
}

export function getDoc(): Y.Doc {
	if (_historicalDoc) return _historicalDoc;
	if (!_doc) throw new Error('Yjs not initialised');
	return _doc;
}

export function destroyYjs() {
	_wsProvider?.destroy();
	_idbProvider?.destroy();
	_doc?.destroy();
	_historicalDoc?.destroy();
	_doc = null;
	_historicalDoc = null;
	_wsProvider = null;
	_idbProvider = null;
	syncState.status = 'offline';
	docState.version = 0;
	idbSynced.done = false;
	commitState.isHistorical = false;
	commitState.commitId = null;
}

export function reconnectYjs() {
	// Force the WebSocket provider to reconnect. Useful for iOS Safari when
	// returning from background/offline where the connection drops.
	_wsProvider?.disconnect();
	_wsProvider?.connect();
}

// ─── Commits / Snapshots ────────────────────────────────────────────────────────

export interface Commit {
	id: string;
	name: string;
	createdAt: string;
	snapshot: Uint8Array;
}

export function createCommit(name: string) {
	if (!_doc) return;
	const snapshot = Y.snapshot(_doc);
	const snapshotBytes = Y.encodeSnapshot(snapshot);

	const commits = _doc.getArray('commits');
	const commitObj = new Y.Map();
	commitObj.set('id', crypto.randomUUID());
	commitObj.set('name', name);
	commitObj.set('createdAt', new Date().toISOString());
	commitObj.set('snapshot', snapshotBytes);

	commits.insert(0, [commitObj]); // Add to front
	docState.version++; // Trigger re-render
}

export function readCommits(): Commit[] {
	if (!_doc) return [];
	return _doc.getArray('commits').toArray().map((m: any) => ({
		id: m.get('id'),
		name: m.get('name'),
		createdAt: m.get('createdAt'),
		snapshot: m.get('snapshot')
	}));
}

export function deleteCommit(commitId: string) {
	if (!_doc) return;
	const commits = _doc.getArray('commits');
	const idx = commits.toArray().findIndex((m: any) => m.get('id') === commitId);
	if (idx !== -1) {
		commits.delete(idx, 1);
		docState.version++;
	}
}

export function viewCommit(commitId: string) {
	if (!_doc) return;
	const commits = readCommits();
	const commit = commits.find(c => c.id === commitId);
	if (!commit) return;

	const snap = Y.decodeSnapshot(commit.snapshot);
	_historicalDoc = Y.createDocFromSnapshot(_doc, snap);
	commitState.isHistorical = true;
	commitState.commitId = commitId;
	docState.version++;
}

export function exitCommitView() {
	_historicalDoc?.destroy();
	_historicalDoc = null;
	commitState.isHistorical = false;
	commitState.commitId = null;
	docState.version++;
}

// ─── Data shape helpers ────────────────────────────────────────────────────────
// All data lives in a single Y.Map at the root of the document.
// Structure:
//   folders:  Y.Array<Y.Map>  — each map: { id, name, color, parentId|null, order }
//   lists:    Y.Array<Y.Map>  — each map: { id, name, color, folderId, type, order }
//   items:    Y.Array<Y.Map>  — each map: { id, listId, name, price|null, checked, order }

export function getFolders(doc: Y.Doc): Y.Array<Y.Map<unknown>> {
	return doc.getArray('folders');
}

export function getLists(doc: Y.Doc): Y.Array<Y.Map<unknown>> {
	return doc.getArray('lists');
}

export function getItems(doc: Y.Doc): Y.Array<Y.Map<unknown>> {
	return doc.getArray('items');
}
export function getSpreadsheets(doc: Y.Doc): Y.Array<Y.Map<unknown>> {
        return doc.getArray('spreadsheets');
}

/** Returns the Y.Map<string> holding all cell values for a given spreadsheet.
 *  Key format: "R,C" (0-based row, col).  Values are raw cell strings (formula or literal). */
export function getSheetCells(doc: Y.Doc, sheetId: string): Y.Map<string> {
        return doc.getMap(`sheet-cells-${sheetId}`);
}