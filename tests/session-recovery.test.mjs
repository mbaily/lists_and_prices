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
	test(`session HTTP ${status} clears login and closes document`, async () => {
		const app = createApp({ username: 'alice', fetch: async () => new Response('{}', { status }) });
		try {
			const auth = app.load('src/lib/auth.svelte.ts');
			const lifecycle = app.load('src/lib/sessionDocument.ts');
			assert.equal(lifecycle.reconcileSessionDocument('alice', await auth.checkSession(), 'ws://unused'), false);
			assert.equal(auth.auth.username, null);
			assert.throws(() => app.store.getDoc(), /not initialised/);
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
