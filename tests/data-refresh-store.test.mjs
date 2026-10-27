import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp, Y } from './helpers/app.mjs';

async function fixture(online = false) {
	const username = 'refresh-' + crypto.randomUUID();
	const app = createApp({ username, realPersistence: true, storage: [[`pnl_sync:${username}`, 'manual']],
		navigator: { onLine: online }, fetch: () => assert.fail('Local-only refresh must not contact the server') });
	const deadline = Date.now() + 5000;
	while (!app.store.idbSynced.done) {
		assert.ok(Date.now() < deadline, 'Local fixture must finish loading');
		await new Promise(resolve => setTimeout(resolve, 2));
	}
	const folder = app.data.createFolder('Folder', null);
	const list = app.data.createList('List', folder, 'plain');
	const pin = app.data.createItem(list, 'Original pin');
	app.data.updateItem(pin, { pinned: true });
	await app.store.saveLocalData();
	const { LocalPersistence } = app.load('src/lib/localPersistence.ts');
	const peerDoc = new Y.Doc({ gc: false });
	const peer = new LocalPersistence(`pnl-${username}`, peerDoc);
	await peer.whenSynced;
	return { app, list, pin, LocalPersistence, peerDoc, peer, async close() {
		await peer.destroy(); peerDoc.destroy(); await app.store.saveLocalData(); app.dispose();
	} };
}

for (const mode of ['offline', 'expired-session']) {
	test(`${mode} refresh merges another tab's data while retaining the live document, pins and local edits`, async () => {
		const f = await fixture(mode !== 'offline');
		try {
			if (mode === 'expired-session') f.app.load('src/lib/auth.svelte.ts').auth.needsLogin = true;
			f.peerDoc.getArray('items').get(0).set('checked', true);
			f.peerDoc.getArray('items').push([new Y.Map(Object.entries({
				id: 'peer-pin', listId: f.list, name: 'New pin from another tab', pinned: true, order: 1
			}))]);
			await f.peer.flush();
			f.app.data.updateItem(f.pin, { name: 'Local edit is kept' });
			assert.equal(f.app.data.readAllItems().length, 1);
			const before = f.app.store.getDoc();
			const undoCount = f.app.store.getUndoCount();
			const first = f.app.store.syncNow();
			assert.equal(f.app.store.syncNow(), first, 'Repeated reloads share the running refresh');
			assert.equal(f.app.store.getDoc(), before);
			assert.equal(f.app.store.idbSynced.done, true, 'Refreshing must never reset the screen to startup');
			assert.equal(f.app.data.readAllItems()[0].pinned, true);
			await first;
			assert.equal(f.app.store.getDoc(), before);
			const items = f.app.data.readAllItems();
			assert.equal(items.length, 2);
			assert.equal(items.find(item => item.id === f.pin).name, 'Local edit is kept');
			assert.equal(items.find(item => item.id === f.pin).checked, true);
			assert.ok(items.every(item => item.pinned));
			assert.equal(f.app.store.getUndoCount(), undoCount, 'Remote updates must not enter local undo');
			assert.equal(f.app.store.syncState.status, mode === 'offline' ? 'offline' : 'auth-required');
		} finally { await f.close(); }
	});
}

test('a local refresh failure preserves the document and remains retryable', async () => {
	const f = await fixture();
	const refresh = f.LocalPersistence.prototype.refresh;
	try {
		f.LocalPersistence.prototype.refresh = async () => { throw new Error('Local storage unavailable'); };
		await f.app.store.syncNow();
		assert.equal(f.app.store.getDoc(), f.app.doc);
		assert.equal(f.app.store.idbSynced.done, true);
		assert.equal(f.app.data.readAllItems()[0].pinned, true);
		assert.match(f.app.store.syncState.error, /Local storage unavailable/);
		f.LocalPersistence.prototype.refresh = refresh;
		await f.app.store.syncNow();
		assert.equal(f.app.store.syncState.status, 'offline');
		assert.equal(f.app.store.syncState.syncing, false);
	} finally { f.LocalPersistence.prototype.refresh = refresh; await f.close(); }
});
