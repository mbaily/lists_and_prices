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

// ─── Reactive state (Svelte 5 runes – used in components via import) ──────────
// We export plain objects that components can $state-wrap or read directly.

let _doc: Y.Doc | null = null;
let _wsProvider: WebsocketProvider | null = null;
let _idbProvider: IndexeddbPersistence | null = null;

export const syncState = $state<{ status: SyncStatus }>({ status: 'offline' });

/** Increments on every Yjs doc update — derive from this to re-read data reactively. */
export const docState = $state<{ version: number }>({ version: 0 });

/** Call once after login to initialise the shared Y.Doc for this user. */
export function initYjs(username: string, wsUrl: string) {
	if (_doc) destroyYjs();

	const doc = new Y.Doc();
	_doc = doc;

	// Local persistence (survives offline)
	_idbProvider = new IndexeddbPersistence(`pnl-${username}`, doc);

	// Remote sync
	_wsProvider = new WebsocketProvider(wsUrl, `pnl-${username}`, doc, {
		connect: true
	});

	syncState.status = 'connecting';

	doc.on('update', () => { docState.version++; });

	_wsProvider.on('status', ({ status }: { status: string }) => {
		if (status === 'connected') syncState.status = 'synced';
		else if (status === 'connecting') syncState.status = 'connecting';
		else syncState.status = 'offline';
	});

	return doc;
}

export function getDoc(): Y.Doc {
	if (!_doc) throw new Error('Yjs not initialised');
	return _doc;
}

export function destroyYjs() {
	_wsProvider?.destroy();
	_idbProvider?.destroy();
	_doc?.destroy();
	_doc = null;
	_wsProvider = null;
	_idbProvider = null;
	syncState.status = 'offline';
	docState.version = 0;
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
