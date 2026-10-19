import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp } from './helpers/app.mjs';

for (const status of [500, 502, 503, 504, 429]) {
	test(`session HTTP ${status} preserves cached login and document`, async () => {
		const app = createApp({ username: 'alice', fetch: async () => new Response('{}', { status }) });
		try {
			const auth = app.load('src/lib/auth.svelte.ts');
			const lifecycle = app.load('src/lib/sessionDocument.ts');
			assert.equal(lifecycle.reconcileSessionDocument('alice', await auth.checkSession(), 'ws://unused'), true);
			assert.equal(auth.auth.username, 'alice');
			assert.equal(app.store.getDoc(), app.doc);
		} finally { app.dispose(); }
	});
}

for (const status of [401, 403]) {
	test(`session HTTP ${status} requests sign-in while retaining offline login and document`, async () => {
		const app = createApp({ username: 'alice', fetch: async () => new Response('{}', { status }) });
		try {
			const auth = app.load('src/lib/auth.svelte.ts');
			const lifecycle = app.load('src/lib/sessionDocument.ts');
			app.doc.getMap('offline').set('unsynced', 'keep me');
			assert.equal(lifecycle.reconcileSessionDocument('alice', await auth.checkSession(), 'ws://unused'), true);
			assert.equal(auth.auth.username, 'alice');
			assert.equal(auth.auth.needsLogin, true);
			assert.equal(app.store.getDoc(), app.doc);
			assert.equal(app.doc.getMap('offline').get('unsynced'), 'keep me');
		} finally { app.dispose(); }
	});
}

test('invalid successful session response preserves cached access', async () => {
	const app = createApp({ username: 'alice', fetch: async () => new Response('not JSON') });
	try {
		const auth = app.load('src/lib/auth.svelte.ts');
		assert.equal(await auth.checkSession(), true);
		assert.equal(auth.auth.username, 'alice');
	} finally { app.dispose(); }
});

for (const cachedUsername of ['alice', null]) {
	test(`verified account bob replaces document loaded for ${cachedUsername}`, async () => {
		const app = createApp({ username: cachedUsername, fetch: async () => Response.json({ username: 'bob' }) });
		const previousDocument = globalThis.document;
		globalThis.document = { documentElement: { setAttribute() {}, style: { setProperty() {}, removeProperty() {} } } };
		try {
			const folder = app.data.createFolder('Alice private folder', null);
			const auth = app.load('src/lib/auth.svelte.ts');
			const lifecycle = app.load('src/lib/sessionDocument.ts');
			assert.equal(lifecycle.reconcileSessionDocument(cachedUsername, await auth.checkSession(), 'ws://unused'), true);
			assert.equal(auth.auth.username, 'bob');
			assert.notEqual(app.store.getDoc(), app.doc);
			assert.equal(app.data.readFolders().some(f => f.id === folder), false);
			assert.equal(app.doc.isDestroyed, true);
		} finally {
			globalThis.document = previousDocument;
			app.dispose();
		}
	});
}

test('temporary server failure without a cached account does not open a document', async () => {
	const app = createApp({ fetch: async () => new Response('{}', { status: 503 }) });
	try {
		const auth = app.load('src/lib/auth.svelte.ts');
		assert.equal(await auth.checkSession(), false);
		assert.equal(auth.auth.username, null);
	} finally { app.dispose(); }
});

test('a late session rejection cannot undo a newer login or recreate its working document', async () => {
	let finish;
	const app = createApp({ username: 'alice', fetch: async path => path === '/api/login'
		? Response.json({ ok: true }) : new Promise(resolve => { finish = resolve; }) });
	try {
		const auth = app.load('src/lib/auth.svelte.ts');
		const pending = auth.checkSession();
		assert.equal((await auth.login('alice', 'test-only')).ok, true);
		app.doc.getMap('offline').set('recent', 'keep this document');
		finish(new Response('', { status: 401 }));
		const lifecycle = app.load('src/lib/sessionDocument.ts');
		assert.equal(lifecycle.reconcileSessionDocument(null, await pending, 'ws://unused'), true);
		assert.equal(auth.auth.needsLogin, false);
		assert.equal(app.store.getDoc(), app.doc);
		assert.equal(app.doc.getMap('offline').get('recent'), 'keep this document');
	} finally { app.dispose(); }
});
