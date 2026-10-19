import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp, Provider, Y } from './helpers/app.mjs';

function client(options = {}) {
	const locals = [], sockets = [];
	class Local extends Provider {
		constructor(_name, doc) {
			super(); locals.push(this);
			doc.on('update', () => { this.currentRevision++; this.pendingSync = true; this.emit('saving'); });
		}
		async flush() { this.emit('saved'); }
	}
	class Socket extends Provider {
		connects = 0;
		disconnects = 0;
		constructor() { super(); sockets.push(this); }
		connect() { this.connects++; }
		disconnect() { this.disconnects++; }
	}
	const app = createApp({ username: 'alice', IndexeddbPersistence: Local, WebsocketProvider: Socket, ...options });
	locals[0].emit('synced');
	return { ...app, locals, sockets };
}

test('manual mode survives reload and blocks startup, resume and remote-tab reconnections', () => {
	const app = client({ storage: [['pnl_sync:alice', 'manual']] });
	try {
		assert.equal(app.store.syncState.automatic, false);
		app.store.reconnectYjs();
		app.store.refreshSyncPreference();
		assert.equal(app.sockets[0].connects, 0);
		app.store.setAutomaticSync(true);
		assert.equal(app.sockets[0].connects, 1);
		app.storage.set('pnl_sync:alice', 'manual');
		app.store.refreshSyncPreference();
		assert.equal(app.store.syncState.automatic, false);
		assert.ok(app.sockets[0].disconnects > 0);
	} finally { app.dispose(); }
});

test('manual sync exchanges offline edits and remote deletions without opening a WebSocket', async () => {
	const remote = new Y.Doc({ gc: false });
	remote.getMap('items').set('remote', 'from server');
	let app;
	let posts = 0;
	app = client({ storage: [['pnl_sync:alice', 'manual']], fetch: async (path, init) => {
		const { encodeSyncMessage, decodeSyncMessage } = app.load('src/lib/syncProtocol.ts');
		const request = decodeSyncMessage(init.body);
		assert.equal(request.username, 'alice');
		if (path === '/api/sync') { posts++; Y.applyUpdate(remote, request.update); }
		return new Response(encodeSyncMessage('alice', Y.encodeStateVector(remote), Y.encodeStateAsUpdate(remote, request.vector)));
	} });
	try {
		app.doc.getMap('items').set('phone', 'offline addition');
		await app.store.syncNow();
		assert.equal(remote.getMap('items').get('phone'), 'offline addition');
		assert.equal(app.doc.getMap('items').get('remote'), 'from server');
		assert.equal(app.store.syncState.pending, false);
		assert.ok(app.store.syncState.lastSyncAt);
		assert.equal(app.sockets[0].connects, 0);
		remote.getMap('items').delete('remote');
		app.doc.getMap('items').delete('phone');
		await app.store.syncNow();
		assert.equal(app.doc.getMap('items').size, 0);
		assert.equal(remote.getMap('items').size, 0);
		assert.equal(posts, 2);
	} finally { app.dispose(); remote.destroy(); }
});

test('expired sync session keeps edits and pauses connections until signing in again', async () => {
	let expired = true, app;
	const remote = new Y.Doc({ gc: false });
	app = client({ fetch: async (path, init) => {
		if (path === '/api/login') { expired = false; return Response.json({ ok: true }); }
		if (expired) return new Response('', { status: 401 });
		const { encodeSyncMessage, decodeSyncMessage } = app.load('src/lib/syncProtocol.ts');
		const request = decodeSyncMessage(init.body);
		if (request.update.length) Y.applyUpdate(remote, request.update);
		return new Response(encodeSyncMessage('alice', Y.encodeStateVector(remote), Y.encodeStateAsUpdate(remote, request.vector)));
	} });
	try {
		app.doc.getMap('items').set('offline', 'retained');
		await app.store.syncNow();
		assert.equal(app.store.syncState.status, 'auth-required');
		assert.equal(app.store.getDoc(), app.doc);
		assert.equal(app.doc.getMap('items').get('offline'), 'retained');
		const auth = app.load('src/lib/auth.svelte.ts');
		assert.equal((await auth.login('alice', 'test-only')).ok, true);
		app.store.reconnectYjs();
		await app.store.syncNow();
		assert.equal(remote.getMap('items').get('offline'), 'retained');
		assert.equal(app.store.syncState.pending, false);
	} finally { app.dispose(); remote.destroy(); }
});

test('failed uploads and edits made during an upload remain pending', async () => {
	let app, fail = true;
	const remote = new Y.Doc({ gc: false });
	app = client({ storage: [['pnl_sync:alice', 'manual']], fetch: async (path, init) => {
		const { encodeSyncMessage, decodeSyncMessage } = app.load('src/lib/syncProtocol.ts');
		const request = decodeSyncMessage(init.body);
		if (path === '/api/sync') {
			if (fail) return new Response('', { status: 503 });
			Y.applyUpdate(remote, request.update);
			app.doc.getMap('items').delete('item');
		}
		return new Response(encodeSyncMessage('alice', Y.encodeStateVector(remote), Y.encodeStateAsUpdate(remote, request.vector)));
	} });
	try {
		app.doc.getMap('items').set('item', 'offline');
		await app.store.syncNow();
		assert.equal(app.store.syncState.pending, true);
		assert.equal(app.store.syncState.lastSyncAt, null);
		fail = false;
		await app.store.syncNow();
		assert.equal(app.store.syncState.pending, true, 'the deletion happened after the uploaded snapshot');
		assert.equal(app.store.syncState.lastSyncAt, null);
		assert.equal(app.doc.getMap('items').has('item'), false);
	} finally { app.dispose(); remote.destroy(); }
});

test('an old response cannot mutate or change status for a replacement account', async () => {
	let finish;
	const app = client({ storage: [['pnl_sync:alice', 'manual']], fetch: async () => new Promise(resolve => { finish = resolve; }) });
	try {
		const pending = app.store.syncNow();
		await new Promise(resolve => setImmediate(resolve));
		app.store.initYjs('bob', 'ws://unused');
		finish(new Response('', { status: 401 }));
		await pending;
		assert.equal(app.load('src/lib/auth.svelte.ts').auth.needsLogin, false);
		assert.equal(app.store.syncState.error, null);
		assert.equal(app.store.getDoc().getMap('items').size, 0);
	} finally { app.dispose(); }
});

for (const granted of [true, false]) {
	test(`storage protection reports the browser's ${granted ? 'grant' : 'refusal'}`, async () => {
		let requested = 0;
		const app = createApp({ navigator: { storage: {
			persisted: async () => false, persist: async () => { requested++; return granted; },
			estimate: async () => ({ usage: 1024, quota: 4096 })
		} } });
		try {
			const storage = app.load('src/lib/browserStorage.svelte.ts');
			await storage.checkBrowserStorage(true);
			assert.equal(requested, 1);
			assert.equal(storage.storageState.persistence, granted ? 'persistent' : 'best-effort');
			assert.equal(storage.storageState.usage, 1024);
		} finally { app.dispose(); }
	});
}

test('a controlling worker with missing cached assets is not reported as offline ready', async () => {
	const previous = { document: globalThis.document, caches: globalThis.caches };
	const handlers = new Map();
	let cached = false;
	const app = createApp({ navigator: { serviceWorker: {
		controller: { scriptURL: 'https://offline.test/sw.js' },
		addEventListener: (name, callback) => handlers.set(name, callback),
		removeEventListener: name => handlers.delete(name)
	} } });
	globalThis.document = { querySelectorAll: () => [{ href: 'https://offline.test/start.js' }], addEventListener() {}, removeEventListener() {} };
	globalThis.caches = { async match() { return cached ? { ok: true } : undefined; } };
	let stop;
	try {
		const storage = app.load('src/lib/browserStorage.svelte.ts');
		stop = storage.watchBrowserStorage();
		await new Promise(resolve => setImmediate(resolve));
		assert.equal(storage.storageState.offlineLaunch, false);
		cached = true;
		await handlers.get('controllerchange')();
		assert.equal(storage.storageState.offlineLaunch, true);
	} finally {
		stop?.(); app.dispose();
		globalThis.document = previous.document;
		globalThis.caches = previous.caches;
	}
});
