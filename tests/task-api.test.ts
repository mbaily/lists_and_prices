import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import bcrypt from 'bcryptjs';
import type * as Yjs from 'yjs';
import { docs, getYDoc, getPersistence, setPersistence, setupWSConnection } from 'y-websocket/bin/utils';
import { SessionStore, COOKIE_NAME } from '../server/auth.ts';
import { attachYjsServer } from '../server/auth-websocket.ts';
import { createTaskDocuments, type TaskDocuments } from '../server/task-documents.ts';
import { createTaskRouter, importTasks, type TaskToken } from '../server/task-api.ts';

const require = createRequire(import.meta.url);
const Y = require('yjs') as typeof Yjs;
const { LeveldbPersistence } = require('y-leveldb');
const { WebsocketProvider } = require('y-websocket');
const { WebSocket } = require('ws');

function seed(doc: Yjs.Doc, id = 'shopping') {
	if (!doc.getArray('folders').length) {
		const folder = new Y.Map<unknown>(); folder.set('id', 'home'); folder.set('name', 'Home');
		doc.getArray('folders').push([folder]);
	}
	const list = new Y.Map<unknown>();
	list.set('id', id); list.set('name', 'Shopping'); list.set('folderId', 'home'); list.set('type', 'plain');
	doc.getArray('lists').push([list]);
}

test('API matching preserves clipboard rules and initializes editable CRDT text', () => {
	const doc = new Y.Doc({ gc: false });
	try {
		seed(doc);
		importTasks(doc, 'shopping', ['Milk #shopping', 'Buy #inline milk', 'https://example.com/#one', '#one'], 'bottom');
		const result = importTasks(doc, 'shopping', ['Milk #supplies_photos', 'Milk', 'milk', 'Bread #supplies_photos', 'Bread #other', 'Buy milk', 'https://example.com/#two', '#two'], 'top');
		assert.equal(result.added, 5); assert.equal(result.duplicates, 3);
		const rows = doc.getArray<Yjs.Map<unknown>>('items').toArray();
		const bread = rows.find(item => item.get('name') === 'Bread #supplies_photos')!;
		assert.equal(doc.getText(`note_text_${bread.get('id')}`).toString(), 'Bread #supplies_photos');
		assert.equal(doc.getMap('note-text-initialized').get(bread.get('id') as string), true);
		assert.equal(bread.get('checked'), false);
		assert.ok((bread.get('order') as number) < 0);
		// CRDT text is authoritative even if the legacy name cache is stale.
		doc.getText(`note_text_${bread.get('id')}`).delete(0, 100);
		doc.getText(`note_text_${bread.get('id')}`).insert(0, 'Fresh bread #bakery');
		assert.equal(importTasks(doc, 'shopping', ['Fresh bread #supplies_photos'], 'bottom').added, 0);
	} finally { doc.destroy(); }
});

async function apiFixture(t: TestContext, documents: TaskDocuments) {
	const Database = require('better-sqlite3'), db = new Database(':memory:');
	const hash = bcrypt.hashSync('test-only', 4);
	const users = new Set(['alice', 'bob']);
	const sessions = new SessionStore(db, { secret: 'isolated-tests', readPasswordHash: user => users.has(user) ? hash : undefined });
	const session = await sessions.login('alice', 'test-only'); assert.ok(session);
	const token = 'a'.repeat(64);
	let tokens: TaskToken[] = [{ tokenHash: createHash('sha256').update(token).digest('hex'), username: 'alice', listIds: ['shopping'] }];
	const app = express();
	app.use('/api/tasks', createTaskRouter(sessions, documents, { readTokens: () => tokens, userExists: user => users.has(user) }));
	const server = http.createServer(app);
	const sockets = attachYjsServer(server, sessions, setupWSConnection);
	server.listen(0, '127.0.0.1'); await once(server, 'listening');
	const port = (server.address() as import('node:net').AddressInfo).port;
	t.after(async () => { sockets.clients.forEach(socket => socket.terminate()); sockets.close(); await new Promise<void>(resolve => server.close(() => resolve())); db.close(); });
	const request = (body: unknown, headers: Record<string, string> = { Authorization: `Bearer ${token}` }, route = '/import', method = 'POST') => fetch(`http://127.0.0.1:${port}/api/tasks${route}`, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
	return { request, port, session, users, revoke: () => { tokens = []; } };
}

test('task API enforces user/list permissions, validates before mutation, and deduplicates retries', async t => {
	const alice = new Y.Doc(), bob = new Y.Doc(); seed(alice); seed(bob);
	t.after(() => { alice.destroy(); bob.destroy(); });
	const fixture = await apiFixture(t, { async use(user, operation) { return operation(user === 'alice' ? alice : bob); } });
	assert.equal((await fixture.request({ listId: 'shopping', tasks: ['Milk'] }, {})).status, 401);
	assert.equal((await fixture.request({ listId: 'other', tasks: ['Milk'] })).status, 403);
	assert.equal((await fixture.request({ listId: 'shopping', tasks: ['Milk', 123] })).status, 400);
	assert.equal(alice.getArray('items').length, 0);
	const first = await fixture.request({ username: 'bob', listId: 'shopping', text: 'Milk #supplies_photos\nMilk #weekly\n123\n\nBread' });
	assert.equal(first.status, 200);
	const result = await first.json(); assert.equal(result.added, 2); assert.equal(result.duplicates, 1); assert.equal(result.ignored, 2);
	assert.equal(bob.getArray('items').length, 0);
	const replies = await Promise.all(Array.from({ length: 5 }, () => fixture.request({ listId: 'shopping', tasks: ['Milk #different', 'Bread'] })));
	for (const reply of replies) assert.equal((await reply.json()).added, 0);
	assert.equal(alice.getArray('items').length, 2);
	const cookie = `${COOKIE_NAME}=${encodeURIComponent(fixture.session.token)}`;
	assert.equal((await fixture.request({ listId: 'missing', tasks: ['Milk'] }, { Cookie: cookie })).status, 404);
	const lists = await fetch(`http://127.0.0.1:${fixture.port}/api/tasks/lists`, { headers: { Cookie: cookie } });
	assert.deepEqual((await lists.json()).lists, [{ id: 'shopping', name: 'Shopping', folderId: 'home' }]);
	assert.equal((await fixture.request({ name: 'From Photos', folderId: 'home' }, undefined, '/lists')).status, 403);
	assert.equal((await fixture.request({ name: 'From Photos', folderId: 'missing' }, { Cookie: cookie }, '/lists')).status, 404);
	const created = await (await fixture.request({ name: 'From Photos', folderId: 'home' }, { Cookie: cookie }, '/lists')).json();
	assert.equal(created.created, true); assert.equal(alice.getArray('lists').length, 2);
	const repeated = await (await fixture.request({ name: 'From Photos', folderId: 'home' }, { Cookie: cookie }, '/lists')).json();
	assert.equal(repeated.created, false); assert.equal(repeated.list.id, created.list.id);
	assert.equal(bob.getArray('lists').length, 1);
	fixture.revoke(); assert.equal((await fixture.request({ listId: 'shopping', tasks: ['Eggs'] })).status, 401);
	fixture.users.delete('alice'); assert.equal((await fixture.request({ listId: 'shopping', tasks: ['Eggs'] }, { Cookie: cookie })).status, 401);
});

test('setup can create a root folder and move a list without changing its tasks or identity', async t => {
	const alice = new Y.Doc(), bob = new Y.Doc(); seed(alice); seed(bob);
	importTasks(alice, 'shopping', ['Keep this task #supplies_photos'], 'bottom');
	const before = alice.getArray('items').toJSON();
	t.after(() => { alice.destroy(); bob.destroy(); });
	const fixture = await apiFixture(t, { async use(user, operation) { return operation(user === 'alice' ? alice : bob); } });
	const headers = { Cookie: `${COOKIE_NAME}=${encodeURIComponent(fixture.session.token)}` };
	assert.equal((await fixture.request({ name: 'From Photos' }, undefined, '/folders')).status, 403);
	assert.equal((await fixture.request({ name: '  ' }, headers, '/folders')).status, 400);
	const created = await (await fixture.request({ name: 'From Photos' }, headers, '/folders')).json();
	assert.equal(created.created, true); assert.equal(created.folder.parentId, null);
	const repeated = await (await fixture.request({ name: 'From Photos' }, headers, '/folders')).json();
	assert.equal(repeated.created, false); assert.equal(repeated.folder.id, created.folder.id);
	assert.equal((await fixture.request({ folderId: created.folder.id }, undefined, '/lists/shopping', 'PATCH')).status, 403);
	assert.equal((await fixture.request({ folderId: 'missing' }, headers, '/lists/shopping', 'PATCH')).status, 404);
	const moved = await (await fixture.request({ folderId: created.folder.id }, headers, '/lists/shopping', 'PATCH')).json();
	assert.equal(moved.moved, true); assert.equal(moved.list.id, 'shopping'); assert.equal(moved.list.folderId, created.folder.id);
	assert.deepEqual(alice.getArray('items').toJSON(), before);
	assert.equal(alice.getText(`note_text_${(before[0] as { id: string }).id}`).toString(), 'Keep this task #supplies_photos');
	assert.equal((await (await fixture.request({ folderId: created.folder.id }, headers, '/lists/shopping', 'PATCH')).json()).moved, false);
	assert.equal(bob.getArray<Yjs.Map<unknown>>('lists').get(0).get('folderId'), 'home');
	assert.equal(bob.getArray('folders').length, 1);
	assert.equal((await fixture.request({ folderId: created.folder.id }, headers, '/lists/missing', 'PATCH')).status, 404);
	alice.getArray<Yjs.Map<unknown>>('folders').toArray().find(folder => folder.get('id') === created.folder.id)!.set('archived', true);
	assert.equal((await fixture.request({ name: 'From Photos' }, headers, '/folders')).status, 400);
	assert.equal((await fixture.request({ folderId: created.folder.id }, headers, '/lists/shopping', 'PATCH')).status, 400);
});

test('imports wait for cold persistence, sync to a live browser, and survive disconnect/reload', async t => {
	const directory = await mkdtemp(path.join(tmpdir(), 'pnl-task-api-'));
	const provider = new LeveldbPersistence(directory);
	const old = getPersistence();
	const initial = new Y.Doc({ gc: false }); seed(initial);
	importTasks(initial, 'shopping', ['Milk #shopping'], 'bottom');
	await provider.storeUpdate('yjs/pnl-alice', Y.encodeStateAsUpdate(initial)); initial.destroy();
	let releaseFlush: (() => void) | undefined;
	setPersistence({
		provider: { async storeUpdate(name, update) { if (releaseFlush) await new Promise<void>(resolve => { releaseFlush = resolve; }); return provider.storeUpdate(name, update); } },
		async bindState(name, doc) {
			await new Promise(resolve => setTimeout(resolve, 20));
			const stored = await provider.getYDoc(name);
			Y.applyUpdate(doc, Y.encodeStateAsUpdate(stored)); stored.destroy();
			doc.on('update', update => { provider.storeUpdate(name, update); });
		},
		async writeState() {}
	});
	const documents = createTaskDocuments();
	t.after(async () => { for (const doc of docs.values()) doc.destroy(); docs.clear(); setPersistence(old); await provider.destroy(); await rm(directory, { recursive: true, force: true }); });
	const fixture = await apiFixture(t, documents);
	const first = await fixture.request({ listId: 'shopping', tasks: ['Milk #supplies_photos', 'Bread #supplies_photos'] });
	assert.equal(first.status, 200); assert.equal((await first.json()).added, 1);
	assert.equal(docs.size, 0, 'API-only documents are released after the request');
	const client = new Y.Doc({ gc: false });
	class AuthenticatedSocket extends WebSocket {
		constructor(url: string, protocols: string[]) { super(url, protocols, { headers: { Cookie: `${COOKIE_NAME}=${encodeURIComponent(fixture.session.token)}` } }); }
	}
	const connection = new WebsocketProvider(`ws://127.0.0.1:${fixture.port}`, 'yjs/pnl-alice', client, { WebSocketPolyfill: AuthenticatedSocket, disableBc: true });
	t.after(() => { connection.destroy(); client.destroy(); });
	await new Promise<void>(resolve => connection.on('sync', (synced: boolean) => { if (synced) resolve(); }));
	await new Promise(resolve => setTimeout(resolve, 50));
	assert.equal(client.getArray('items').length, 2);
	releaseFlush = () => {};
	let responded = false;
	const pending = fixture.request({ listId: 'shopping', tasks: ['Eggs #supplies_photos'] }).then(reply => { responded = true; return reply; });
	await new Promise(resolve => setTimeout(resolve, 50));
	assert.equal(responded, false, 'HTTP success waits for storage acknowledgement');
	assert.equal(client.getArray('items').length, 3, 'live Yjs clients receive the task');
	connection.disconnect(); await new Promise(resolve => setTimeout(resolve, 20));
	assert.equal(getYDoc('yjs/pnl-alice', false).getArray('items').length, 3, 'API lease survives the last browser disconnect');
	const finish = releaseFlush!; releaseFlush = undefined; finish();
	assert.equal((await pending).status, 200);
	assert.equal(docs.size, 0);
	const stored = await provider.getYDoc('yjs/pnl-alice');
	assert.equal(stored.getArray('items').length, 3); stored.destroy();
	const repeat = await fixture.request({ listId: 'shopping', tasks: ['Eggs #other'] });
	assert.equal((await repeat.json()).added, 0);
});
