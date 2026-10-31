import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { compile } from 'svelte/compiler';
import { createApp, componentFunctions, root, transpile, Y } from './helpers/app.mjs';

const require = createRequire(import.meta.url);

// Render the real page/login templates at the post-mount state. SSR does not
// run onMount, so seed readiness explicitly; HomeScreen is just a marker here.
// These probes cover rendered branches, not browser mounting or user events.
function renderPage(app, continueOffline = false) {
	function loadComponent(file) {
		let source = file.endsWith('HomeScreen.svelte') ? '<p>Home screen</p>' : readFileSync(path.join(root, file), 'utf8');
		if (file === 'src/routes/+page.svelte') {
			source = source.replace('let ready = $state(false)', 'let ready = $state(true)');
			if (continueOffline) source = source.replace('let continueOffline = $state(false)', 'let continueOffline = $state(true)');
		}
		const { js } = compile(source, { filename: file, generate: 'server', dev: false });
		const module = { exports: {} };
		const localRequire = specifier => {
			if (specifier.startsWith('$lib/')) {
				const target = 'src/lib/' + specifier.slice(5);
				return target.startsWith('src/lib/components/') ? loadComponent(target) : app.load(target + '.ts');
			}
			return require(specifier);
		};
		new Function('require', 'module', 'exports', transpile(js.code))(localRequire, module, module.exports);
		return module.exports;
	}
	return require('svelte/server').render(loadComponent('src/routes/+page.svelte').default).body;
}

for (const endpoint of ['session', 'sync']) {
	for (const status of [401, 403]) {
		test(`${endpoint} HTTP ${status} shows sign-in for the cached account and keeps local edits`, async () => {
			const app = createApp({ username: 'alice', storage: [['pnl_sync:alice', 'manual']], fetch: async () => new Response('', { status }) });
			try {
				app.doc.getMap('items').set('offline', 'keep me');
				if (endpoint === 'session') await app.load('src/lib/auth.svelte.ts').checkSession();
				else { app.store.idbSynced.done = true; await app.store.syncNow(); }
				// Sign-in must also be visible if local data is still loading.
				app.store.idbSynced.done = false;
				const html = renderPage(app);
				assert.match(html, /Your session has expired or is no longer valid/);
				assert.match(html, /value="alice"/);
				assert.match(html, /readonly/);
				assert.match(html, /Continue offline/);
				assert.doesNotMatch(html, /Home screen/);
				assert.equal(app.store.getDoc(), app.doc);
				assert.equal(app.doc.getMap('items').get('offline'), 'keep me');

				app.store.idbSynced.done = true;
				assert.match(renderPage(app, true), /Home screen/);
				assert.equal(app.load('src/lib/auth.svelte.ts').auth.needsLogin, true);
			} finally { app.dispose(); }
		});
	}
}

for (const outcome of ['offline', 'server-error', 'valid-session']) {
	test(`${outcome} keeps cached access without asking for sign-in`, async () => {
		const app = createApp({ username: 'alice', fetch: async () => {
			if (outcome === 'offline') throw new TypeError('Failed to fetch');
			return outcome === 'valid-session' ? Response.json({ username: 'alice' }) : new Response('', { status: 503 });
		} });
		try {
			await app.load('src/lib/auth.svelte.ts').checkSession();
			app.store.idbSynced.done = true;
			assert.match(renderPage(app), /Home screen/);
		} finally { app.dispose(); }
	});
}

test('page sign-in resumes synchronization of the same document, including manual mode', async () => {
	let expired = true, app;
	const requests = [];
	const remote = new Y.Doc({ gc: false });
	app = createApp({ username: 'alice', storage: [['pnl_sync:alice', 'manual']], fetch: async (url, init) => {
		requests.push(url);
		if (url === '/api/login') { expired = false; return Response.json({ ok: true }); }
		if (expired) return new Response('', { status: 401 });
		const { encodeSyncMessage, decodeSyncMessage } = app.load('src/lib/syncProtocol.ts');
		const message = decodeSyncMessage(init.body);
		if (message.update.length) Y.applyUpdate(remote, message.update);
		return new Response(encodeSyncMessage('alice', Y.encodeStateVector(remote), Y.encodeStateAsUpdate(remote, message.vector)));
	} });
	try {
		app.store.idbSynced.done = true;
		app.doc.getMap('items').set('offline', 'retained');
		await app.store.syncNow();
		const auth = app.load('src/lib/auth.svelte.ts');
		assert.equal((await auth.login('alice', 'test-only')).ok, true);
		const state = {
			...app.store, continueOffline: true,
			reloadSettings: () => assert.fail('The same account keeps its settings'),
			yjsUrl: () => assert.fail('The existing document keeps its provider')
		};
		const source = componentFunctions('src/routes/+page.svelte', ['handleLogin']);
		new Function('state', `with (state) { ${transpile(source)}; handleLogin('alice'); }`)(state);
		await app.store.syncNow();
		assert.equal(state.continueOffline, false);
		assert.equal(auth.auth.needsLogin, false);
		assert.equal(app.store.getDoc(), app.doc);
		assert.equal(app.doc.getMap('items').get('offline'), 'retained');
		assert.equal(remote.getMap('items').get('offline'), 'retained');
		assert.equal(app.store.syncState.pending, false);
		assert.deepEqual(requests, ['/api/sync/state', '/api/login', '/api/sync/state', '/api/sync']);
	} finally { app.dispose(); remote.destroy(); }
});
