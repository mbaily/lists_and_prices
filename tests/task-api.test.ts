import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile, stat } from 'node:fs/promises';
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
import { bindTaskDestination, createTaskRouter, importTasks, readTaskTokens, type TaskToken } from '../server/task-api.ts';

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
	let bindingFails = false;
	app.use('/api/tasks', createTaskRouter(sessions, documents, {
		readTokens: () => tokens, userExists: user => users.has(user),
		bindDestination(hash, id) {
			const entry = tokens.find(token => token.tokenHash === hash);
			if (bindingFails || !entry?.fromPhotos) throw new Error('Binding failed');
			entry.listIds = [id];
		}
	}));
	const server = http.createServer(app);
	const sockets = attachYjsServer(server, sessions, setupWSConnection);
	server.listen(0, '127.0.0.1'); await once(server, 'listening');
	const port = (server.address() as import('node:net').AddressInfo).port;
	t.after(async () => { sockets.clients.forEach(socket => socket.terminate()); sockets.close(); await new Promise<void>(resolve => server.close(() => resolve())); db.close(); });
	const request = (body: unknown, headers: Record<string, string> = { Authorization: `Bearer ${token}` }, route = '/import', method = 'POST') => fetch(`http://127.0.0.1:${port}/api/tasks${route}`, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
	return { request, port, session, users, revoke: () => { tokens = []; }, enableRecovery: () => { tokens[0].fromPhotos = true; }, failBinding: (fail: boolean) => { bindingFails = fail; } };
}

test('API list creation copies folder defaults once with todo/note types and editable text', async t => {
	const doc = new Y.Doc(); seed(doc);
	t.after(() => doc.destroy());
	doc.getArray<Yjs.Map<unknown>>('folders').get(0).set('defaultItems', [
		{ id: 'todo-template', name: 'Passport', note: false },
		{ id: 'note-template', name: 'Booking\nReference', note: true }
	]);
	const fixture = await apiFixture(t, { async use(_user, operation) { return operation(doc); } });
	const headers = { Cookie: `${COOKIE_NAME}=${encodeURIComponent(fixture.session.token)}` };
	const response = await fixture.request({ name: 'Trip', folderId: 'home' }, headers, '/lists');
	assert.equal(response.status, 200);
	const result = await response.json();
	assert.equal(result.created, true);
	const rows = doc.getArray<Yjs.Map<unknown>>('items').toArray().filter(item => item.get('listId') === result.list.id);
	assert.deepEqual(rows.map(item => [item.get('name'), item.get('note'), item.get('order')]), [['Passport', false, 0], ['Booking\nReference', true, 1]]);
	for (const item of rows) {
		assert.equal(item.get('checked'), false);
		assert.equal(doc.getText(`note_text_${item.get('id')}`).toString(), item.get('name'));
		assert.notEqual(item.get('id'), item.get('note') ? 'note-template' : 'todo-template');
	}
	const repeat = await (await fixture.request({ name: 'Trip', folderId: 'home' }, headers, '/lists')).json();
	assert.equal(repeat.created, false);
	assert.equal(doc.getArray('items').length, 2);
	assert.equal((await fixture.request({ folderId: 'home' }, headers, '/lists/shopping', 'PATCH')).status, 200);
	assert.equal(doc.getArray('items').length, 2, 'moving/reusing a list must not seed default items');
});

test('destination recovery creates defaults from an existing folder without repeating them on retry', async t => {
	const doc = new Y.Doc(); seed(doc);
	t.after(() => doc.destroy());
	const folder = doc.getArray<Yjs.Map<unknown>>('folders').get(0);
	folder.set('name', 'From Photos');
	folder.set('defaultItems', [{ id: 'template', name: 'Review photos', note: true }]);
	const fixture = await apiFixture(t, { async use(_user, operation) { return operation(doc); } });
	fixture.enableRecovery();
	const result = await (await fixture.request({}, undefined, '/destination')).json();
	assert.equal(result.listCreated, true);
	assert.equal(doc.getArray('items').length, 1);
	assert.equal((await fixture.request({}, undefined, '/destination')).status, 200);
	assert.equal(doc.getArray('items').length, 1);
});

test('destination recovery uses the exact root path, creates missing data, and rebinds only this token', async t => {
	const alice = new Y.Doc(), bob = new Y.Doc(); seed(alice); seed(bob);
	t.after(() => { alice.destroy(); bob.destroy(); });
	const fixture = await apiFixture(t, { async use(user, operation) { return operation(user === 'alice' ? alice : bob); } });
	assert.equal((await fixture.request({}, undefined, '/destination')).status,403);
	fixture.enableRecovery();
	assert.equal((await fixture.request({ name:'Other', username:'bob' }, undefined, '/destination')).status,400);
	// A nested same-name folder and a same-name list elsewhere are not the root destination.
	const nested = new Y.Map<unknown>(); nested.set('id','nested'); nested.set('name','From Photos'); nested.set('parentId','home');
	alice.getArray('folders').push([nested]);
	alice.getArray<Yjs.Map<unknown>>('lists').get(0).set('name','From Photos');
	fixture.failBinding(true);
	assert.equal((await fixture.request({}, undefined, '/destination')).status,503);
	fixture.failBinding(false);
	const replies = await Promise.all(Array.from({length:3}, () => fixture.request({}, undefined, '/destination')));
	const resolved = await replies[0].json();
	for (const reply of replies.slice(1)) assert.equal((await reply.json()).list.id,resolved.list.id);
	assert.equal(resolved.folderCreated,false); assert.equal(resolved.listCreated,false,'retry reuses data created before a binding failure');
	assert.notEqual(resolved.list.folderId,'nested');
	assert.equal(alice.getArray('folders').length,3); assert.equal(alice.getArray('lists').length,2);
	assert.equal(bob.getArray('folders').length,1); assert.equal(bob.getArray('lists').length,1);
	assert.equal((await fixture.request({listId:'shopping',tasks:['Other list']})).status,403);
	assert.equal((await fixture.request({listId:resolved.list.id,tasks:['Milk #supplies_photos']})).status,200);
	const target = alice.getArray<Yjs.Map<unknown>>('lists').toArray().find(list => list.get('id') === resolved.list.id)!;
	target.set('favourite',true);
	assert.equal((await fixture.request({}, undefined, '/destination')).status,200); assert.equal(target.get('favourite'),true);
	const index = alice.getArray<Yjs.Map<unknown>>('lists').toArray().indexOf(target);
	alice.getArray('lists').delete(index,1);
	const replacement = await (await fixture.request({}, undefined, '/destination')).json();
	assert.equal(replacement.folderCreated,false); assert.equal(replacement.listCreated,true);
	assert.notEqual(replacement.list.id,resolved.list.id);
	assert.equal((await fixture.request({listId:replacement.list.id,tasks:['Eggs']})).status,200);
	const folder = alice.getArray<Yjs.Map<unknown>>('folders').toArray().find(folder => folder.get('id') === replacement.list.folderId)!;
	folder.set('archived',true);
	assert.equal((await fixture.request({}, undefined, '/destination')).status,400);
	folder.set('archived',false);
	const duplicate = new Y.Map<unknown>(); duplicate.set('id','duplicate'); duplicate.set('name','From Photos'); duplicate.set('parentId',null);
	alice.getArray('folders').push([duplicate]);
	assert.equal((await fixture.request({}, undefined, '/destination')).status,409);
	fixture.revoke(); assert.equal((await fixture.request({}, undefined, '/destination')).status,401);
});

test('recovery binding is durable and keeps unrelated tokens unchanged', async t => {
	const directory = await mkdtemp(path.join(tmpdir(),'pnl-task-tokens-')); t.after(() => rm(directory,{recursive:true,force:true}));
	const file = path.join(directory,'tokens.json'), hash = 'a'.repeat(64), other = {tokenHash:'b'.repeat(64),username:'bob',listIds:['other']};
	await writeFile(file,JSON.stringify({tokens:[{tokenHash:hash,username:'alice',listIds:['old'],fromPhotos:true},other]}));
	bindTaskDestination(file,hash,'replacement');
	assert.deepEqual(readTaskTokens(file),[{tokenHash:hash,username:'alice',listIds:['replacement'],fromPhotos:true},other]);
	assert.equal((await stat(file)).mode & 0o777,0o600);
	assert.throws(() => bindTaskDestination(file,other.tokenHash,'unauthorized'));
	assert.throws(() => bindTaskDestination(file,'c'.repeat(64),'unauthorized'));
	assert.deepEqual(readTaskTokens(file)[1],other);
});

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
