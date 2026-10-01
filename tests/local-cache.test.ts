import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as Y from 'yjs';
import { IndexeddbPersistence, storeState } from 'y-indexeddb';
import { compactCache, maintainCache } from '../src/lib/localCache.ts';

function rows(db: IDBDatabase): Promise<Uint8Array[]> {
	return new Promise((resolve, reject) => {
		const tx = db.transaction('updates', 'readonly');
		const read = tx.objectStore('updates').getAll();
		tx.oncomplete = () => resolve(read.result);
		tx.onabort = () => reject(tx.error);
	});
}
function append(db: IDBDatabase, updates: Uint8Array[]): Promise<void> {
	return new Promise((resolve, reject) => {
		const tx = db.transaction('updates', 'readwrite');
		for (const update of updates) tx.objectStore('updates').add(update);
		tx.oncomplete = () => resolve();
		tx.onabort = () => reject(tx.error);
	});
}
async function fixture() {
	const doc = new Y.Doc({ gc: false });
	const name = 'test-cache-' + crypto.randomUUID();
	const provider = new IndexeddbPersistence(name, doc);
	await provider.whenSynced;
	return { doc, name, provider, db: provider.db! };
}

test('compaction below the 500-record library threshold preserves offline edits and deleted snapshot content', async () => {
	const { doc, provider, db, name } = await fixture();
	try {
		const text = doc.getText('note');
		text.insert(0, 'Historical note');
		const snapshot = Y.snapshot(doc);
		text.delete(0, text.length);
		text.insert(0, 'Offline edited note');
		await append(db, Array.from({ length: 100 }, () => Y.encodeStateAsUpdate(doc)));
		const before = await rows(db);
		assert.ok(before.length < 500);
		const result = await compactCache(db);
		assert.equal(result.recordsAfter, 1);
		assert.ok(result.bytesAfter < result.bytesBefore / 50);
		assert.equal((await rows(db)).length, 1);
		await provider.destroy();
		const fresh = new Y.Doc({ gc: false });
		const reloaded = new IndexeddbPersistence(name, fresh);
		try {
			await reloaded.whenSynced;
			assert.equal(fresh.getText('note').toString(), 'Offline edited note');
			assert.deepEqual(Y.encodeStateVector(fresh), Y.encodeStateVector(doc));
			const historical = Y.createDocFromSnapshot(fresh, snapshot);
			assert.equal(historical.getText('note').toString(), 'Historical note');
			historical.destroy();
		} finally { await reloaded.destroy(); fresh.destroy(); }
	} finally { await provider.destroy(); doc.destroy(); }
});

test('compaction retains unseen writes from other tabs and writes queued during compaction', async () => {
	const { doc, provider, db } = await fixture();
	const other = new Y.Doc({ gc: false });
	try {
		other.getMap('items').set('other-tab', 'unsynced');
		await append(db, [Y.encodeStateAsUpdate(other)]);
		assert.equal(doc.getMap('items').get('other-tab'), undefined);
		const compacting = compactCache(db);
		other.getMap('items').set('queued', 'also unsynced');
		const writing = append(db, [Y.encodeStateAsUpdate(other)]);
		await Promise.all([compacting, writing]);
		const restored = new Y.Doc({ gc: false });
		for (const update of await rows(db)) Y.applyUpdate(restored, update);
		assert.equal(restored.getMap('items').get('other-tab'), 'unsynced');
		assert.equal(restored.getMap('items').get('queued'), 'also unsynced');
		restored.destroy();
	} finally { await provider.destroy(); doc.destroy(); other.destroy(); }
});

test('compaction preserves pending updates whose dependencies have not arrived yet', async () => {
	const { doc, provider, db } = await fixture();
	const remote = new Y.Doc({ gc: false });
	try {
		remote.getText('note').insert(0, 'First');
		const dependency = Y.encodeStateAsUpdate(remote);
		const vector = Y.encodeStateVector(remote);
		remote.getText('note').insert(5, ' second');
		await append(db, [Y.encodeStateAsUpdate(remote, vector)]);
		await compactCache(db);
		const restored = new Y.Doc({ gc: false });
		for (const update of await rows(db)) Y.applyUpdate(restored, update);
		assert.equal(restored.getText('note').length, 0);
		Y.applyUpdate(restored, dependency);
		assert.equal(restored.getText('note').toString(), 'First second');
		restored.destroy();
	} finally { await provider.destroy(); doc.destroy(); remote.destroy(); }
});

test('a failed merge leaves every stored update unchanged', async () => {
	const { doc, provider, db } = await fixture();
	try {
		doc.getMap('items').set('offline', 'keep');
		await append(db, [new Uint8Array([255])]);
		const before = await rows(db);
		await assert.rejects(compactCache(db));
		assert.deepEqual(await rows(db), before);
	} finally { await provider.destroy(); doc.destroy(); }
});

test('a failed replacement rolls back the cleared records', async (t) => {
	const { doc, provider, db } = await fixture();
	try {
		doc.getMap('items').set('offline', 'keep');
		const before = await rows(db);
		const add = t.mock.method(IDBObjectStore.prototype, 'add', function () {
			throw new DOMException('Simulated storage failure', 'QuotaExceededError');
		});
		await assert.rejects(compactCache(db), /Simulated storage failure/);
		add.mock.restore();
		assert.deepEqual(await rows(db), before);
	} finally { await provider.destroy(); doc.destroy(); }
});

test('provider persistence and its own compaction still work after cache replacement', async () => {
	const { doc, provider, db } = await fixture();
	try {
		doc.getMap('items').set('first', 'before');
		await compactCache(db);
		doc.getMap('items').set('later', 'after');
		await storeState(provider);
		await compactCache(db);
		doc.getMap('items').delete('first');
		const restored = new Y.Doc({ gc: false });
		for (const update of await rows(db)) Y.applyUpdate(restored, update);
		assert.equal(restored.getMap('items').get('later'), 'after');
		assert.equal(restored.getMap('items').has('first'), false);
		restored.destroy();
	} finally { await provider.destroy(); doc.destroy(); }
});

test('maintenance runs after load, cannot be postponed by continuous edits, and stops on teardown', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const doc = new Y.Doc();
	let calls = 0;
	const stop = maintainCache(doc, async () => { calls++; }, error => { throw error; });
	t.mock.timers.tick(1_000);
	assert.equal(calls, 1);
	for (let i = 0; i < 6; i++) {
		doc.getMap('items').set('value', i);
		t.mock.timers.tick(10_000);
	}
	assert.equal(calls, 2);
	doc.getMap('items').set('value', 7);
	stop();
	t.mock.timers.tick(60_000);
	assert.equal(calls, 2);
	doc.destroy();
});
