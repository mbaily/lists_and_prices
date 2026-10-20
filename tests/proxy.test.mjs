import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { appBasePath } from '../scripts/app-base-path.mjs';
import { readPublicBasePath, secureCookies, tlsEnabled } from '../server/deployment-config.ts';
import { componentFunctions, createApp, transpile, Y } from './helpers/app.mjs';

test('public base paths accept root and nested prefixes and reject ambiguous URLs', () => {
	for (const value of ['', '/', '/lists', '/tools/lists-v2']) {
		assert.equal(appBasePath(value), value === '/' ? '' : value);
	}
	for (const value of ['lists', '/lists/', '//lists', '/a//b', '/a/../b', '/a.b', '/a?b', '/a#b', '/a%2fb', '/a\\b', 'https://host/lists']) {
		assert.throws(() => appBasePath(value), /APP_BASE_PATH/);
	}
});

test('proxy settings preserve standalone defaults and reject configuration mistakes', () => {
	assert.equal(tlsEnabled(undefined, true), true);
	assert.equal(tlsEnabled('auto', false), false);
	assert.equal(tlsEnabled('off', true), false);
	assert.throws(() => tlsEnabled('false', true), /LISTS_TLS/);
	for (const tls of [true, false]) {
		assert.equal(secureCookies(undefined, tls), tls);
		assert.equal(secureCookies('true', tls), true);
		assert.equal(secureCookies('false', tls), false);
	}
	assert.throws(() => secureCookies('yes', false), /SESSION_COOKIE_SECURE/);
});

test('the server reads the public prefix from the built frontend and supports old builds', t => {
	const directory = mkdtempSync(path.join(tmpdir(), 'lists-build-config-'));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	assert.equal(readPublicBasePath(directory), '');
	for (const basePath of ['', '/lists', '/tools/lists']) {
		writeFileSync(path.join(directory, 'deployment.json'), JSON.stringify({ basePath }));
		assert.equal(readPublicBasePath(directory), basePath);
	}
	for (const basePath of [null, '/lists/', '//host', '/a/../b']) {
		writeFileSync(path.join(directory, 'deployment.json'), JSON.stringify({ basePath }));
		assert.throws(() => readPublicBasePath(directory), /Invalid public base path/);
	}
});

for (const basePath of ['', '/lists', '/tools/lists']) {
	test(`authentication, manual sync and WebSocket URLs use ${basePath || '/'} as their app root`, async () => {
		const calls = [];
		const remote = new Y.Doc({ gc: false });
		remote.getMap('items').set('remote', 'from server');
		let app;
		app = createApp({ username: 'alice', basePath, storage: [['pnl_sync:alice', 'manual']], fetch: async (url, init) => {
			calls.push(url);
			const route = url.slice(basePath.length);
			if (route === '/api/login' || route === '/api/logout') return Response.json({ ok: true });
			if (route === '/api/session') return Response.json({ username: 'alice' });
			assert.ok(['/api/sync/state', '/api/sync'].includes(route), url);
			const { encodeSyncMessage, decodeSyncMessage } = app.load('src/lib/syncProtocol.ts');
			const request = decodeSyncMessage(init.body);
			if (route === '/api/sync') Y.applyUpdate(remote, request.update);
			return new Response(encodeSyncMessage('alice', Y.encodeStateVector(remote), Y.encodeStateAsUpdate(remote, request.vector)));
		} });
		try {
			const auth = app.load('src/lib/auth.svelte.ts');
			assert.equal((await auth.login('alice', 'test-only')).ok, true);
			assert.equal(await auth.checkSession(), true);
			app.store.idbSynced.done = true;
			app.doc.getMap('items').set('local', 'from device');
			await app.store.syncNow();
			assert.equal(app.store.syncState.error, null);
			assert.equal(remote.getMap('items').get('local'), 'from device');
			assert.equal(app.doc.getMap('items').get('remote'), 'from server');
			assert.equal(await auth.logout(), true);
			assert.deepEqual(calls, ['/api/login', '/api/session', '/api/sync/state', '/api/sync', '/api/logout'].map(url => basePath + url));
			const urls = app.load('src/lib/urls.ts');
			assert.equal(urls.yjsUrl({ protocol: 'https:', host: 'host:443' }), `wss://host:443${basePath}/yjs`);
			assert.equal(urls.yjsUrl({ protocol: 'http:', host: 'localhost:8082' }), `ws://localhost:8082${basePath}/yjs`);
			assert.equal(urls.appUrl('/#l/list-id'), `${basePath}/#l/list-id`);
			assert.equal(urls.appUrl('/report/Weekly%20tasks'), `${basePath}/report/Weekly%20tasks`);
			const opened = [];
			const functions = componentFunctions('src/lib/components/SmartFolderReportScreen.svelte', ['navigateToList', 'navigateToFolder']);
			const links = new Function('appUrl', 'navigate', 'readFolders', transpile(functions) + '\nreturn { navigateToList, navigateToFolder };')(
				urls.appUrl, url => opened.push(url), () => [{ id: 'child', parentId: 'parent' }, { id: 'parent', parentId: null }]
			);
			links.navigateToList('list-id');
			links.navigateToFolder('child');
			assert.deepEqual(opened, [`${basePath}/#l/list-id`, `${basePath}/#f/parent/child`]);
		} finally { app.dispose(); remote.destroy(); }
	});
}
