import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { configureLeveldbPersistence } from '../server/persistence.ts';

const require = createRequire(import.meta.url);
const Y = require('yjs');
const { LeveldbPersistence, getLevelUpdates, getCurrentUpdateClock } = require('y-leveldb');

async function fixture(t, limits) {
	const directory = await mkdtemp(path.join(tmpdir(), 'pnl-persistence-'));
	const provider = new LeveldbPersistence(directory);
	const originalStore = provider.storeUpdate.bind(provider);
	configureLeveldbPersistence(provider, limits);
	t.after(async () => { await provider.destroy(); await rm(directory, { recursive: true, force: true }); });
	const records = name => provider._transact(db => getLevelUpdates(db, name));
	return { directory, provider, originalStore, records };
}

test('merging repeated checkpoints retains deleted text, snapshots, metadata and update clocks', async t => {
	const f = await fixture(t);
	const name = 'yjs/pnl-test';
	const doc = new Y.Doc({ gc: false });
	t.after(() => doc.destroy());
	doc.getText('note').insert(0, 'original text');
	const snapshot = Y.snapshot(doc);
	await f.originalStore(name, Y.encodeStateAsUpdate(doc));
	doc.getText('note').delete(0, 9);
	doc.getText('note').insert(0, 'updated ');
	for (let i = 0; i < 12; i++) await f.originalStore(name, Y.encodeStateAsUpdate(doc));
	await f.provider.setMeta(name, 'retained', { value: 42 });
	const oldClock = await f.provider._transact(db => getCurrentUpdateClock(db, name));
	const loaded = await f.provider.getYDoc(name);
	t.after(() => loaded.destroy());
	assert.equal(loaded.gc, false);
	assert.equal(loaded.getText('note').toString(), 'updated text');
	assert.equal((await f.records(name)).length, 1);
	assert.deepEqual(await f.provider.getMeta(name, 'retained'), { value: 42 });
	assert.equal(await f.provider._transact(db => getCurrentUpdateClock(db, name)), oldClock);
	const historical = Y.createDocFromSnapshot(loaded, snapshot);
	assert.equal(historical.getText('note').toString(), 'original text'); historical.destroy();
	assert.deepEqual(await f.provider.getStateVector(name), Y.encodeStateVector(doc));
	assert.equal(await f.provider.storeUpdate(name, Y.encodeStateAsUpdate(doc)), oldClock + 1);
	const reopened = new LeveldbPersistence(path.join(f.directory, 'legacy-reader'));
	try {
		for (const update of await f.records(name)) await reopened.storeUpdate(name, update);
		const compatible = await reopened.getYDoc(name);
		assert.equal(compatible.getText('note').toString(), 'updated text'); compatible.destroy();
	} finally { await reopened.destroy(); }
});

test('pending updates survive compaction and integrate when their missing dependencies arrive', async t => {
	const f = await fixture(t);
	const source = new Y.Doc({ gc: false });
	const updates = [];
	source.on('update', update => updates.push(update));
	source.getText('note').insert(0, 'first');
	source.getText('note').insert(5, ' second');
	const name = 'yjs/pnl-pending';
	await f.originalStore(name, updates[1]);
	await f.originalStore(name, updates[1]);
	const pending = await f.provider.getYDoc(name);
	assert.equal(pending.getText('note').toString(), ''); pending.destroy();
	await f.provider.storeUpdate(name, updates[0]);
	const restored = await f.provider.getYDoc(name);
	assert.equal(restored.getText('note').toString(), 'first second');
	restored.destroy(); source.destroy();
});

test('a failed atomic merge leaves every original record available and propagates the load failure', async t => {
	const f = await fixture(t);
	const doc = new Y.Doc(); doc.getText('note').insert(0, 'retained');
	await f.originalStore('one', Y.encodeStateAsUpdate(doc));
	await f.originalStore('one', Y.encodeStateAsUpdate(doc));
	await f.originalStore('other', Y.encodeStateAsUpdate(doc));
	const before = await f.records('one');
	const db = await f.provider._transact(async db => db);
	const originalBatch = db.batch.bind(db);
	db.batch = async () => { throw new Error('simulated atomic write failure'); };
	await assert.rejects(f.provider.getYDoc('one'), /simulated atomic write failure/);
	db.batch = originalBatch;
	assert.deepEqual(await f.records('one'), before);
	assert.equal((await f.records('other')).length, 1);
	const recovered = await f.provider.getYDoc('one');
	assert.equal(recovered.getText('note').toString(), 'retained');
	recovered.destroy(); doc.destroy();
});

test('a load queued behind an in-flight merge includes later queued writes', async t => {
	const f = await fixture(t);
	const doc = new Y.Doc(); doc.getText('note').insert(0, 'first');
	await f.originalStore('one', Y.encodeStateAsUpdate(doc));
	await f.originalStore('one', Y.encodeStateAsUpdate(doc));
	const db = await f.provider._transact(async db => db);
	const originalBatch = db.batch.bind(db);
	let release, started;
	const held = new Promise(resolve => { started = resolve; });
	db.batch = async (...args) => {
		started(); await new Promise(resolve => { release = resolve; });
		db.batch = originalBatch;
		return originalBatch(...args);
	};
	const firstLoad = f.provider.getYDoc('one');
	await held;
	doc.getText('note').insert(5, ' later');
	const write = f.provider.storeUpdate('one', Y.encodeStateAsUpdate(doc));
	const secondLoad = f.provider.getYDoc('one');
	release();
	const [first, , second] = await Promise.all([firstLoad, write, secondLoad]);
	assert.equal(second.getText('note').toString(), 'first later');
	first.destroy(); second.destroy(); doc.destroy();
});

test('background compaction bounds the log while preserving subsequent writes and deletion-only updates', async t => {
	const f = await fixture(t, { records: 4, bytes: 512 });
	const doc = new Y.Doc({ gc: false });
	for (let i = 0; i < 30; i++) {
		doc.getMap('values').set('current', i);
		await f.provider.storeUpdate('one', Y.encodeStateAsUpdate(doc));
	}
	doc.getMap('values').delete('current');
	await f.provider.storeUpdate('one', Y.encodeStateAsUpdate(doc, Y.encodeStateVector(doc)));
	await f.provider.tr;
	assert.ok((await f.records('one')).length < 5);
	const loaded = await f.provider.getYDoc('one');
	assert.equal(loaded.getMap('values').has('current'), false);
	assert.deepEqual(Y.encodeStateVector(loaded), Y.encodeStateVector(doc));
	loaded.destroy(); doc.destroy();
});
