/**
 * Central Yjs document and provider setup.
 * One Y.Doc per authenticated user, keyed by username.
 * Synced via y-websocket; persisted locally in the existing y-indexeddb database format.
 */
import * as Y from 'yjs';
import { LocalPersistence } from './localPersistence';
import { auth } from './auth.svelte';
import { appUrl } from './urls';
import { encodeSyncMessage, decodeSyncMessage } from './syncProtocol';
import { WebsocketProvider } from 'y-websocket';
import { observeNoteNames } from './noteText';
import { encodeCommitState } from './commitSnapshot';
import { NEARBY_CHECKLIST_MEMBERSHIP_ORIGIN } from './nearbyChecklist';
import { compactCache, maintainCache, type CacheCompaction } from './localCache';

export type ItemType = 'plain' | 'priced';
export type SyncStatus = 'offline' | 'connecting' | 'synced' | 'paused' | 'error' | 'auth-required';

/** True once local persistence has restored the Y.Doc and committed early edits. */
export const idbSynced = $state<{ done: boolean }>({ done: false });

// ─── Reactive state (Svelte 5 runes – used in components via import) ──────────
// We export plain objects that components can $state-wrap or read directly.

let _doc: Y.Doc | null = null;
let _wsProvider: WebsocketProvider | null = null;
let _idbProvider: LocalPersistence | null = null;
let _username: string | null = null;
let _syncTimer: ReturnType<typeof setTimeout> | undefined;
let _syncRequest: Promise<void> | null = null;
let _syncAbort: AbortController | null = null;
const NETWORK_ORIGIN = Symbol('server-sync');
const syncKey = (username: string) => `pnl_sync:${username}`;

export const localSaveState = $state<{ status: 'loading' | 'saving' | 'saved' | 'error'; error: string | null }>({ status: 'loading', error: null });

let _historicalDoc: Y.Doc | null = null;
let _undoManager: Y.UndoManager | null = null;
let _stopNoteNames: (() => void) | null = null;
let _stopCacheMaintenance: (() => void) | null = null;
let _compaction: Promise<CacheCompaction> | null = null;
export const cacheState = $state<{ loadMs: number | null; compacting: boolean; lastCompaction: CacheCompaction | null; error: string | null }>({
	loadMs: null, compacting: false, lastCompaction: null, error: null
});
const COMMIT_ORIGIN = Symbol('commit-management');

export const syncState = $state<{
	status: SyncStatus; automatic: boolean; syncing: boolean; pending: boolean;
	lastSyncAt: number | null; error: string | null;
}>({ status: 'offline', automatic: true, syncing: false, pending: true, lastSyncAt: null, error: null });
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

	_username = username;
	try { syncState.automatic = localStorage.getItem(syncKey(username)) !== 'manual'; }
	catch { syncState.automatic = true; }
	idbSynced.done = false;
	localSaveState.status = 'loading';
	localSaveState.error = null;
	const tIdbStart = performance.now();
	const persistence = new LocalPersistence(`pnl-${username}`, doc);
	_idbProvider = persistence;
	persistence.on('synced', () => {
		if (_doc !== doc) return;
		cacheState.loadMs = Math.round(performance.now() - tIdbStart);
		idbSynced.done = true;
		localSaveState.status = 'saved';
		syncState.pending = persistence.pendingSync;
		syncState.lastSyncAt = persistence.lastSyncAt;
		docState.version++;
		_stopCacheMaintenance = maintainCache(doc, compactLocalCache, error => {
			if (_doc === doc) console.warn('Local cache compaction failed; stored data retained.', error);
		});
		reconnectYjs();
	});
	persistence.on('saving', () => {
		if (_doc !== doc) return;
		localSaveState.status = 'saving';
		syncState.pending = true;
		if (syncState.status === 'synced') syncState.status = 'connecting';
		scheduleSync();
	});
	persistence.on('saved', () => {
		if (_doc !== doc) return;
		localSaveState.status = 'saved';
		localSaveState.error = null;
	});
	persistence.on('error', (error: unknown) => {
		if (_doc !== doc) return;
		localSaveState.status = 'error';
		localSaveState.error = error instanceof Error ? error.message : 'Could not save on this device.';
	});

	_wsProvider = new WebsocketProvider(wsUrl, `pnl-${username}`, doc, { connect: false });
	syncState.status = syncState.automatic ? 'connecting' : 'paused';
	doc.on('update', () => { if (_doc === doc) docState.version++; });
	_wsProvider.on('status', ({ status }: { status: string }) => {
		if (_doc !== doc) return;
		if (auth.needsLogin) syncState.status = 'auth-required';
		else if (!syncState.automatic) syncState.status = 'paused';
		else if (status === 'disconnected') syncState.status = 'offline';
		else syncState.status = syncState.pending ? 'connecting' : 'synced';
	});
	_wsProvider.on('sync', (synced: boolean) => {
		if (_doc === doc && synced) scheduleSync(0);
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

export function getDocumentUsername(): string | null { return _username; }

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
	clearTimeout(_syncTimer);
	_syncTimer = undefined;
	_syncAbort?.abort();
	_syncAbort = null;
	_syncRequest = null;
	_username = null;
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
	void Promise.resolve(_idbProvider?.destroy()).catch(error => console.warn('Local save failed while closing the document.', error));
	_doc?.destroy();
	_historicalDoc?.destroy();
	_doc = null;
	_historicalDoc = null;
	_undoManager = null;
	_wsProvider = null;
	_idbProvider = null;
	Object.assign(syncState, { status: 'offline', syncing: false, pending: true, lastSyncAt: null, error: null });
	localSaveState.status = 'loading';
	localSaveState.error = null;
	docState.version = 0;
	idbSynced.done = false;
	commitState.isHistorical = false;
	commitState.commitId = null;
}

function scheduleSync(delay = 1500) {
	if (!syncState.automatic || auth.needsLogin || !idbSynced.done || _syncTimer !== undefined) return;
	_syncTimer = setTimeout(() => {
		_syncTimer = undefined;
		void syncNow();
	}, delay);
}

export function reconnectYjs() {
	if (!idbSynced.done) return;
	if (!syncState.automatic || auth.needsLogin) {
		_wsProvider?.disconnect();
		syncState.status = auth.needsLogin ? 'auth-required' : 'paused';
		return;
	}
	_wsProvider?.disconnect();
	_wsProvider?.connect();
}

export function setAutomaticSync(automatic: boolean) {
	if (!_username) return;
	try { localStorage.setItem(syncKey(_username), automatic ? 'automatic' : 'manual'); }
	catch { syncState.error = 'Could not remember the sync setting on this device.'; return; }
	syncState.automatic = automatic;
	clearTimeout(_syncTimer);
	_syncTimer = undefined;
	if (!automatic) _syncAbort?.abort();
	reconnectYjs();
	if (automatic) scheduleSync(0);
}

/** Called for changes made to the per-account setting in another tab. */
export function refreshSyncPreference() {
	if (!_username) return;
	try { syncState.automatic = localStorage.getItem(syncKey(_username)) !== 'manual'; } catch { return; }
	if (!syncState.automatic) {
		clearTimeout(_syncTimer);
		_syncTimer = undefined;
		_syncAbort?.abort();
	}
	reconnectYjs();
}

export async function saveLocalData() {
	if (!_idbProvider) return;
	try { await _idbProvider.flush(); }
	catch { /* The persistence error event supplies the visible save error. */ }
}

/** Explicit HTTP synchronization works with automatic WebSockets disabled.
 * A completed exchange includes a server persistence acknowledgement, not just
 * an open socket. Never upload one account's document under another session. */
export function syncNow(): Promise<void> {
	if (_syncRequest) return _syncRequest;
	const doc = _doc, persistence = _idbProvider, username = _username;
	if (!doc || !persistence || !username || !idbSynced.done) return Promise.resolve();
	if (auth.needsLogin) { syncState.status = 'auth-required'; return Promise.resolve(); }
	if (typeof navigator !== 'undefined' && !navigator.onLine) {
		syncState.status = 'offline';
		syncState.error = 'You are offline. Changes stay saved on this device.';
		return Promise.resolve();
	}
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(new Error('Sync timed out. Your local changes are kept. Try again.')), 30_000);
	_syncAbort = controller;
	const current = () => _doc === doc && !controller.signal.aborted;
	syncState.syncing = true;
	syncState.error = null;
	const exchange = async (path: `/${string}`, vector: Uint8Array, update?: Uint8Array) => {
		const response = await fetch(appUrl(path), {
			method: 'POST', headers: { 'Content-Type': 'application/octet-stream' },
			body: encodeSyncMessage(username, vector, update), signal: controller.signal,
			cache: 'no-store'
		});
		if (!current()) throw new DOMException('Sync cancelled', 'AbortError');
		if (response.status === 401 || response.status === 403 || response.status === 409) {
			auth.needsLogin = true;
			_wsProvider?.disconnect();
			throw new Error('Sign in again to sync. Your offline changes are kept.');
		}
		if (!response.ok) throw new Error('Server sync failed. Your local changes are kept.');
		const message = decodeSyncMessage(new Uint8Array(await response.arrayBuffer()));
		if (message.username !== username) throw new Error('The server returned a different account. Sync stopped.');
		return message;
	};
	_syncRequest = (async () => {
		try {
			await persistence.refresh();
			if (!current()) return;
			syncState.pending = persistence.pendingSync;
			syncState.lastSyncAt = persistence.lastSyncAt;
			const remote = await exchange('/api/sync/state', Y.encodeStateVector(doc));
			if (!current()) return;
			Y.applyUpdate(doc, remote.update, NETWORK_ORIGIN);
			await persistence.flush();
			if (!current()) return;
			const revision = persistence.currentRevision;
			const result = await exchange('/api/sync', Y.encodeStateVector(doc), Y.encodeStateAsUpdate(doc, remote.vector));
			if (!current()) return;
			const unchanged = persistence.currentRevision === revision;
			Y.applyUpdate(doc, result.update, NETWORK_ORIGIN);
			const vector = Y.encodeStateVector(doc);
			const matches = vector.length === result.vector.length && vector.every((value, index) => value === result.vector[index]);
			const complete = unchanged && matches && await persistence.markSynced(Date.now(), persistence.currentRevision);
			if (!current()) return;
			syncState.pending = !complete;
			syncState.lastSyncAt = persistence.lastSyncAt;
			syncState.status = syncState.automatic ? (complete ? 'synced' : 'connecting') : 'paused';
		} catch (error) {
			if (_doc !== doc) return;
			if (controller.signal.aborted) {
				if (!(controller.signal.reason instanceof Error) || controller.signal.reason.name === 'AbortError') return;
				error = controller.signal.reason;
			}
			syncState.status = auth.needsLogin ? 'auth-required' : 'error';
			syncState.error = error instanceof Error ? error.message : 'Sync failed. Your local changes are kept.';
		} finally {
			clearTimeout(timeout);
			if (_doc === doc && _syncAbort === controller) {
				syncState.syncing = false;
				_syncRequest = null;
				_syncAbort = null;
				if (syncState.pending) scheduleSync(syncState.error ? 30_000 : 1500);
			}
		}
	})();
	return _syncRequest;
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
