/**
 * Central Yjs document and provider setup.
 * One Y.Doc per authenticated user, keyed by username.
 * Synced via y-websocket; persisted locally via y-indexeddb.
 */
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { WebsocketProvider } from 'y-websocket';
import { observeNoteNames } from './noteText';
import { encodeCommitState } from './commitSnapshot';
import { NEARBY_CHECKLIST_MEMBERSHIP_ORIGIN } from './nearbyChecklist';
import { compactCache, maintainCache, type CacheCompaction } from './localCache';

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
let _undoManager: Y.UndoManager | null = null;
let _stopNoteNames: (() => void) | null = null;
let _stopCacheMaintenance: (() => void) | null = null;
let _compaction: Promise<CacheCompaction> | null = null;
export const cacheState = $state<{ loadMs: number | null; compacting: boolean; lastCompaction: CacheCompaction | null; error: string | null }>({
	loadMs: null, compacting: false, lastCompaction: null, error: null
});
const COMMIT_ORIGIN = Symbol('commit-management');

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

	// Root-level note texts, report memberships and cell maps are part of the
	// same action as their metadata. Provider/migration/cache origins are not
	// tracked, nor are remote updates applied with a null origin.
	_undoManager = new Y.UndoManager(doc, {
		captureTimeout: 0,
		captureTransaction: (transaction) => transaction.local && transaction.changed.size > 0 && transaction.origin !== NEARBY_CHECKLIST_MEMBERSHIP_ORIGIN
	});
	_stopNoteNames = observeNoteNames(doc);

	idbSynced.done = false;
	const tIdbStart = performance.now();
	_idbProvider = new IndexeddbPersistence(`pnl-${username}`, doc);
	_idbProvider.on('synced', () => {
		if (_doc !== doc) return;
		const tIdbEnd = performance.now();
		console.log(`[Perf] IndexedDB synced in ${Math.round(tIdbEnd - tIdbStart)}ms`);
		cacheState.loadMs = Math.round(tIdbEnd - tIdbStart);
		idbSynced.done = true;
		docState.version++;
		_stopCacheMaintenance = maintainCache(doc, compactLocalCache, error => {
			if (_doc === doc) console.warn('Local cache compaction failed; stored data retained.', error);
		});
		_wsProvider?.connect();
	});

	const tWsStart = performance.now();
	_wsProvider = new WebsocketProvider(wsUrl, `pnl-${username}`, doc, {
		// Load offline state first, so the initial handshake requests only missing
		// data and a server snapshot cannot race the IndexedDB startup snapshot.
		connect: false
	});

	syncState.status = 'connecting';

	doc.on('update', () => { if (_doc === doc) docState.version++; });

	_wsProvider.on('status', ({ status }: { status: string }) => {
		if (_doc !== doc) return;
		const tWsStatus = performance.now();
		console.log(`[Perf] WebSocket status changed to '${status}' at ${Math.round(tWsStatus - tWsStart)}ms`);
		if (status === 'connected') syncState.status = _wsProvider?.synced ? 'synced' : 'connecting';
		else if (status === 'connecting') syncState.status = 'connecting';
		else syncState.status = 'offline';
	});
	_wsProvider.on('sync', (synced: boolean) => {
		if (_doc === doc && synced) syncState.status = 'synced';
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

/** All application mutations must explicitly target a writable live document. */
export function getMutableDoc(): Y.Doc {
	if (_historicalDoc) throw new Error('Historical commits are read-only. Exit history to make changes.');
	if (!_doc) throw new Error('Yjs not initialised');
	return _doc;
}

export function getWsProvider(): WebsocketProvider | null {
	return _historicalDoc ? null : _wsProvider;
}

export function getUndoManager(): Y.UndoManager {
	getMutableDoc();
	if (!_undoManager) throw new Error('UndoManager not initialised');
	return _undoManager;
}

export function canUndo(): boolean {
	if (_historicalDoc || !_undoManager) return false;
	return _undoManager.undoStack.length > 0;
}

export function getUndoCount(): number {
	if (_historicalDoc || !_undoManager) return 0;
	return _undoManager.undoStack.length;
}

export function undoLastAction(): boolean {
	if (!canUndo()) return false;
	const changed = _undoManager!.undo() !== null;
	docState.version++;
	return changed;
}

export function destroyYjs() {
	_stopCacheMaintenance?.();
	_stopCacheMaintenance = null;
	_compaction = null;
	cacheState.loadMs = null;
	cacheState.compacting = false;
	cacheState.lastCompaction = null;
	cacheState.error = null;
	_stopNoteNames?.();
	_stopNoteNames = null;
	_undoManager?.destroy();
	_wsProvider?.destroy();
	_idbProvider?.destroy();
	_doc?.destroy();
	_historicalDoc?.destroy();
	_doc = null;
	_historicalDoc = null;
	_undoManager = null;
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
	if (!idbSynced.done) return;
	_wsProvider?.disconnect();
	_wsProvider?.connect();
}

/** Safe online or offline; never deletes the database or downloads replacements. */
export function compactLocalCache(): Promise<CacheCompaction> {
	if (_compaction) return _compaction;
	const doc = _doc;
	const db = _idbProvider?.db;
	if (!doc || !db || !idbSynced.done) return Promise.reject(new Error('Local data is still loading.'));
	cacheState.compacting = true;
	cacheState.error = null;
	_compaction = compactCache(db).then(result => {
		if (_doc === doc) {
			cacheState.lastCompaction = result;
			console.log(`[Perf] Local cache: ${result.recordsBefore} → ${result.recordsAfter} records, ${result.bytesBefore} → ${result.bytesAfter} bytes in ${Math.round(result.durationMs)}ms`);
		}
		return result;
	}).catch(error => {
		if (_doc === doc) cacheState.error = error instanceof Error ? error.message : 'Could not compact local cache.';
		throw error;
	}).finally(() => {
		if (_doc === doc) { cacheState.compacting = false; _compaction = null; }
	});
	return _compaction;
}

// ─── Commits / Snapshots ────────────────────────────────────────────────────────

export interface Commit {
	id: string;
	name: string;
	createdAt: string;
	snapshot: Uint8Array;
	state?: Uint8Array;
}

export function createCommit(name: string) {
	if (!_doc || _historicalDoc) return;
	const snapshot = Y.snapshot(_doc);
	const snapshotBytes = Y.encodeSnapshot(snapshot);

	const commits = _doc.getArray('commits');
	const commitObj = new Y.Map();
	commitObj.set('id', crypto.randomUUID());
	commitObj.set('name', name);
	commitObj.set('createdAt', new Date().toISOString());
	commitObj.set('snapshot', snapshotBytes);
	commitObj.set('state', encodeCommitState(_doc));

	_doc.transact(() => commits.insert(0, [commitObj]), COMMIT_ORIGIN);
	docState.version++; // Trigger re-render
}

export function readCommits(): Commit[] {
	if (!_doc) return [];
	return _doc.getArray('commits').toArray().map((m: any) => ({
		id: m.get('id'),
		name: m.get('name'),
		createdAt: m.get('createdAt'),
		snapshot: m.get('snapshot'),
		state: m.get('state')
	}));
}

export function deleteCommit(commitId: string) {
	if (!_doc || _historicalDoc) return;
	const commits = _doc.getArray('commits');
	const idx = commits.toArray().findIndex((m: any) => m.get('id') === commitId);
	if (idx !== -1) {
		_doc.transact(() => commits.delete(idx, 1), COMMIT_ORIGIN);
		docState.version++;
	}
}

export function viewCommit(commitId: string) {
	if (!_doc) return;
	const commits = readCommits();
	const commit = commits.find(c => c.id === commitId);
	if (!commit) return;

	const historicalDoc = new Y.Doc({ gc: false });
	try {
		if (commit.state) Y.applyUpdate(historicalDoc, commit.state);
		else Y.createDocFromSnapshot(_doc, Y.decodeSnapshot(commit.snapshot), historicalDoc);
	} catch (error) {
		historicalDoc.destroy();
		throw error;
	}
	_historicalDoc?.destroy();
	_historicalDoc = historicalDoc;
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
