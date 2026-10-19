import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import express from 'express';
import bcrypt from 'bcryptjs';
import { LeveldbPersistence } from 'y-leveldb';
import { docs, getYDoc, getPersistence, setPersistence } from 'y-websocket/bin/utils';
import { createOfflineSyncRouter } from '../server/offline-sync.ts';
import { createAuthRouter } from '../server/auth-http.ts';
import { SessionStore, COOKIE_NAME } from '../server/auth.ts';
import { createTaskDocuments } from '../server/task-documents.ts';
import { encodeSyncMessage, decodeSyncMessage } from '../src/lib/syncProtocol.ts';
import { createApp, Y, Provider } from './helpers/app.mjs';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

async function fixture(t) {
	const directory = await mkdtemp(path.join(tmpdir(), 'pnl-offline-sync-'));
	const disk = new LeveldbPersistence(directory);
	const previous = getPersistence();
	let releaseWrite, holdWrites = false, failWrites = false;
	const checkpointSizes = [];
	setPersistence({
		provider: { async storeUpdate(name, update) {
			checkpointSizes.push(update.byteLength);
			if (failWrites) return null;
			if (holdWrites) await new Promise(resolve => { releaseWrite = resolve; });
			return disk.storeUpdate(name, update);
		} },
		async bindState(name, doc) {
			const stored = await disk.getYDoc(name);
			Y.applyUpdate(doc, Y.encodeStateAsUpdate(stored)); stored.destroy();
			doc.on('update', update => { void disk.storeUpdate(name, update); });
		},
		async writeState() {}
	});
	const db = new Database(':memory:');
	const hash = bcrypt.hashSync('test-only', 4);
	let now = Date.now();
	const sessions = new SessionStore(db, { secret: 'offline-tests', ttlMs: 86400000, now: () => now,
		readPasswordHash: username => ['alice', 'bob'].includes(username) ? hash : undefined });
	const login = await sessions.login('alice', 'test-only');
	let cookie = `${COOKIE_NAME}=${encodeURIComponent(login.token)}`;
	const app = express();
	app.use('/api/sync', createOfflineSyncRouter(sessions, createTaskDocuments()));
	app.use('/api', createAuthRouter(sessions, false));
	const server = http.createServer(app);
	server.listen(0, '127.0.0.1'); await once(server, 'listening');
	const base = `http://127.0.0.1:${server.address().port}`;
	t.after(async () => {
		if (releaseWrite) releaseWrite();
		await new Promise(resolve => server.close(resolve));
		for (const doc of docs.values()) doc.destroy();
		docs.clear(); setPersistence(previous);
		await disk.destroy(); db.close(); await rm(directory, { recursive: true, force: true });
	});
	return {
		disk, sessions, checkpointSizes,
		advanceWeek() { now += 7 * 86400000; },
		holdWrites() { holdWrites = true; },
		failWrites() { failWrites = true; },
		async release() { await until(() => releaseWrite !== undefined); holdWrites = false; releaseWrite(); releaseWrite = undefined; },
		async fetch(url, init = {}) {
			const response = await fetch(base + url, { ...init, headers: { ...init.headers, Cookie: cookie } });
			const nextCookie = response.headers.get('set-cookie');
			if (nextCookie) cookie = nextCookie.split(';')[0];
			return response;
		}
	};
}

async function until(check) {
	const end = Date.now() + 5000;
	while (!check()) {
		if (Date.now() > end) throw new Error('Timed out waiting for isolated test fixture');
		await new Promise(resolve => setTimeout(resolve, 5));
	}
}

test('server rejects expired sessions, other-account uploads and malformed data before changing documents', async t => {
	const f = await fixture(t);
	const doc = new Y.Doc({ gc: false });
	doc.getMap('items').set('private', 'bob-only');
	const body = encodeSyncMessage('bob', Y.encodeStateVector(doc), Y.encodeStateAsUpdate(doc));
	const rejected = await f.fetch('/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body });
	assert.equal(rejected.status, 409);
	const stored = await f.disk.getYDoc('yjs/pnl-alice');
	assert.equal(stored.getMap('items').size, 0); stored.destroy();
	assert.equal(docs.size, 0);
	const invalid = await f.fetch('/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: new Uint8Array([255]) });
	assert.equal(invalid.status, 400);
	f.advanceWeek();
	assert.equal((await f.fetch('/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body })).status, 401);
	doc.destroy();
});

test('HTTP sync success waits for persistence and survives releasing the server document', async t => {
	const f = await fixture(t);
	const doc = new Y.Doc({ gc: false });
	doc.getText('note').insert(0, 'week of offline work');
	f.holdWrites();
	let responded = false;
	const response = f.fetch('/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' },
		body: encodeSyncMessage('alice', Y.encodeStateVector(doc), Y.encodeStateAsUpdate(doc))
	}).then(response => { responded = true; return response; });
	await until(() => docs.size === 1);
	assert.equal(responded, false);
	await f.release();
	const confirmed = await response;
	assert.equal(confirmed.status, 200);
	assert.equal(confirmed.headers.get('cache-control'), 'no-store');
	const message = decodeSyncMessage(new Uint8Array(await confirmed.arrayBuffer()));
	assert.equal(message.username, 'alice');
	assert.equal(docs.size, 0);
	const restored = await f.disk.getYDoc('yjs/pnl-alice');
	assert.equal(restored.getText('note').toString(), 'week of offline work');
	restored.destroy(); doc.destroy();
});

test('a swallowed LevelDB write failure never becomes a successful sync acknowledgement', async t => {
	const f = await fixture(t);
	const doc = new Y.Doc({ gc: false });
	doc.getText('note').insert(0, 'unconfirmed work');
	f.failWrites();
	const response = await f.fetch('/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' },
		body: encodeSyncMessage('alice', Y.encodeStateVector(doc), Y.encodeStateAsUpdate(doc)) });
	assert.equal(response.status, 503);
	doc.destroy();
});

test('repeated confirmations of a live document store differences rather than repeated full histories', async t => {
	const f = await fixture(t);
	const live = getYDoc('yjs/pnl-alice', false);
	const lease = { readyState: 1, send() {} };
	live.conns.set(lease, new Set());
	const client = new Y.Doc({ gc: false });
	client.getText('note').insert(0, 'x'.repeat(100000));
	const post = () => f.fetch('/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' },
		body: encodeSyncMessage('alice', Y.encodeStateVector(client), Y.encodeStateAsUpdate(client)) });
	assert.equal((await post()).status, 200);
	client.getText('note').insert(100000, 'small edit');
	assert.equal((await post()).status, 200);
	assert.ok(f.checkpointSizes[1] < f.checkpointSizes[0] / 100);
	const restored = await f.disk.getYDoc('yjs/pnl-alice');
	assert.ok(restored.getText('note').toString().endsWith('small edit'));
	restored.destroy(); client.destroy(); live.conns.delete(lease);
});

test('real client cache survives a week offline, expired login, reauthentication and concurrent server edits', async t => {
	const f = await fixture(t);
	const network = { onLine: true };
	const options = { username: 'alice', storage: [['pnl_sync:alice', 'manual']], realPersistence: true, navigator: network, WebsocketProvider: Provider,
		fetch: (url, init) => { assert.equal(network.onLine, true); return f.fetch(url, init); } };
	let app = createApp(options);
	try {
		await until(() => app.store.idbSynced.done);
		app.doc.getMap('items').set('remove-on-phone', 'old');
		await app.store.syncNow();
		assert.equal(app.store.syncState.pending, false);
		assert.equal(app.store.localSaveState.status, 'saved');
		network.onLine = false;
		f.advanceWeek();
		app.doc.getMap('items').delete('remove-on-phone');
		app.doc.getText('note').insert(0, 'written without internet');
		await app.store.saveLocalData();
		app.dispose();
		app = createApp(options);
		await until(() => app.store.idbSynced.done);
		assert.equal(app.doc.getText('note').toString(), 'written without internet');
		assert.equal(app.doc.getMap('items').has('remove-on-phone'), false);
		assert.equal(app.store.syncState.pending, true);
		const peer = await f.disk.getYDoc('yjs/pnl-alice');
		peer.getMap('items').set('other-device', 'changed during the trip');
		await f.disk.storeUpdate('yjs/pnl-alice', Y.encodeStateAsUpdate(peer)); peer.destroy();
		network.onLine = true;
		await app.store.syncNow();
		assert.equal(app.load('src/lib/auth.svelte.ts').auth.needsLogin, true);
		assert.equal(app.doc.getText('note').toString(), 'written without internet');
		assert.equal((await app.load('src/lib/auth.svelte.ts').login('alice', 'test-only')).ok, true);
		await app.store.syncNow();
		assert.equal(app.store.syncState.pending, false);
		assert.equal(app.doc.getMap('items').get('other-device'), 'changed during the trip');
		const stored = await f.disk.getYDoc('yjs/pnl-alice');
		assert.equal(stored.getText('note').toString(), 'written without internet');
		assert.equal(stored.getMap('items').has('remove-on-phone'), false);
		stored.destroy();
		app.dispose(); network.onLine = false;
		app = createApp(options);
		await until(() => app.store.idbSynced.done);
		assert.equal(app.store.syncState.pending, false);
		assert.ok(app.store.syncState.lastSyncAt);
		assert.equal(app.doc.getMap('items').get('other-device'), 'changed during the trip');
	} finally { app.dispose(); }
});
