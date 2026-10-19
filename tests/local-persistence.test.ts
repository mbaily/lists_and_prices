import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { LocalPersistence } from '../src/lib/localPersistence.ts';
import { compactCache } from '../src/lib/localCache.ts';

async function fixture() {
	const doc = new Y.Doc({ gc: false });
	const name = 'test-offline-' + crypto.randomUUID();
	const local = new LocalPersistence(name, doc);
	await local.whenSynced;
	return { doc, local, name };
}

test('existing y-indexeddb data and history survive offline editing and reload with either provider', async () => {
	const name = 'test-legacy-' + crypto.randomUUID();
	const original = new Y.Doc({ gc: false });
	const legacy = new IndexeddbPersistence(name, original);
	await legacy.whenSynced;
	original.getText('note').insert(0, 'Before travel');
	const snapshot = Y.snapshot(original);
	// Closing the connection waits for its already queued transactions.
	await legacy.destroy();
	const doc = new Y.Doc({ gc: false });
	const local = new LocalPersistence(name, doc);
	await local.whenSynced;
	assert.equal(doc.getText('note').toString(), 'Before travel');
	doc.getText('note').insert(doc.getText('note').length, ' — edited offline');
	await local.flush();
	await compactCache(local.db!);
	await local.destroy();
	const restored = new Y.Doc({ gc: false });
	const oldReader = new IndexeddbPersistence(name, restored);
	try {
		await oldReader.whenSynced;
		assert.equal(restored.getText('note').toString(), 'Before travel — edited offline');
		const historical = Y.createDocFromSnapshot(restored, snapshot);
		assert.equal(historical.getText('note').toString(), 'Before travel');
		historical.destroy();
	} finally { await oldReader.destroy(); restored.destroy(); doc.destroy(); original.destroy(); }
});

test('edits before restoration finishes are committed and survive closing immediately', async () => {
	const doc = new Y.Doc({ gc: false });
	const name = 'test-early-' + crypto.randomUUID();
	const local = new LocalPersistence(name, doc);
	doc.getMap('items').set('early', 'offline');
	await local.destroy(); doc.destroy();
	const next = new Y.Doc({ gc: false });
	const restored = new LocalPersistence(name, next);
	try {
		await restored.whenSynced;
		assert.equal(next.getMap('items').get('early'), 'offline');
	} finally { await restored.destroy(); next.destroy(); }
});

test('delete-only changes remain pending after restart and keep the last confirmed sync time', async () => {
	const { doc, local, name } = await fixture();
	doc.getMap('items').set('item', 'delete later');
	await local.flush();
	assert.equal(await local.markSynced(123456, local.currentRevision), true);
	await local.destroy(); doc.destroy();
	const next = new Y.Doc({ gc: false });
	const reloaded = new LocalPersistence(name, next);
	await reloaded.whenSynced;
	assert.equal(reloaded.pendingSync, false);
	const vector = Y.encodeStateVector(next);
	next.getMap('items').delete('item');
	assert.deepEqual(Y.encodeStateVector(next), vector, 'state vectors alone cannot identify deletions');
	await reloaded.destroy(); next.destroy();
	const final = new Y.Doc({ gc: false });
	const finalLocal = new LocalPersistence(name, final);
	try {
		await finalLocal.whenSynced;
		assert.equal(final.getMap('items').has('item'), false);
		assert.equal(finalLocal.pendingSync, true);
		assert.equal(finalLocal.lastSyncAt, 123456);
	} finally { await finalLocal.destroy(); final.destroy(); }
});

test('a failed write reports an error, retains its update, and can be retried', async t => {
	const { doc, local, name } = await fixture();
	const errors: unknown[] = [];
	local.on('error', (error: unknown) => errors.push(error));
	let saves = 0;
	local.on('saved', () => saves++);
	const mock = t.mock.method(IDBObjectStore.prototype, 'add', () => { throw new DOMException('Disk full', 'QuotaExceededError'); });
	doc.getMap('items').set('unsaved', 'keep in memory');
	await assert.rejects(local.flush(), /Disk full/);
	assert.equal(saves, 0);
	assert.ok(errors.length);
	mock.mock.restore();
	await local.flush();
	assert.ok(saves > 0);
	await local.destroy(); doc.destroy();
	const restoredDoc = new Y.Doc();
	const restored = new LocalPersistence(name, restoredDoc);
	try {
		await restored.whenSynced;
		assert.equal(restoredDoc.getMap('items').get('unsaved'), 'keep in memory');
	} finally { await restored.destroy(); restoredDoc.destroy(); }
});

test('sync confirmation cannot clear another tab’s unseen edits', async () => {
	const { doc, local, name } = await fixture();
	const peerDoc = new Y.Doc({ gc: false });
	const peer = new LocalPersistence(name, peerDoc);
	await peer.whenSynced;
	await local.refresh();
	const beforeUpload = local.currentRevision;
	peerDoc.getMap('items').set('other-tab', 'not uploaded yet');
	await peer.flush();
	assert.equal(await local.markSynced(100, beforeUpload), false);
	await local.refresh();
	assert.equal(doc.getMap('items').get('other-tab'), 'not uploaded yet');
	assert.equal(await local.markSynced(200, local.currentRevision), true);
	await Promise.all([local.destroy(), peer.destroy()]); doc.destroy(); peerDoc.destroy();
});

test('an edit during an exchange cannot be acknowledged by its earlier revision', async () => {
	const { doc, local } = await fixture();
	const revision = local.currentRevision;
	doc.getMap('items').set('newer', 'not sent yet');
	try {
		assert.equal(await local.markSynced(100, revision), false);
		assert.equal(local.pendingSync, true);
		assert.equal(local.lastSyncAt, null);
	} finally { await local.destroy(); doc.destroy(); }
});

test('writes by an older client invalidate its cached confirmation even without new metadata', async () => {
	const { doc, local, name } = await fixture();
	doc.getMap('items').set('initial', 'confirmed');
	await local.flush();
	assert.equal(await local.markSynced(123, local.currentRevision), true);
	await local.destroy(); doc.destroy();
	const oldDoc = new Y.Doc({ gc: false });
	const old = new IndexeddbPersistence(name, oldDoc);
	await old.whenSynced;
	oldDoc.getMap('items').set('older-client', 'not confirmed');
	await old.destroy(); oldDoc.destroy();
	const nextDoc = new Y.Doc({ gc: false });
	const next = new LocalPersistence(name, nextDoc);
	try {
		await next.whenSynced;
		assert.equal(nextDoc.getMap('items').get('older-client'), 'not confirmed');
		assert.equal(next.lastSyncAt, 123);
		assert.equal(next.pendingSync, true);
	} finally { await next.destroy(); nextDoc.destroy(); }
});
