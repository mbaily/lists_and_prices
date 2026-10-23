import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import https from 'node:https';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import bcrypt from 'bcryptjs';
import express from 'express';
import WebSocket from 'ws';
import { LocalStorage } from '../server/local-storage.ts';
import { createLocalHost } from '../server/local-server.ts';
import { loginUpstream, normalizeUpstream, UpstreamSync } from '../server/local-sync.ts';
import { encodeSyncMessage, decodeSyncMessage } from '../src/lib/syncProtocol.ts';
import { SessionStore } from '../server/auth.ts';
import { createAuthRouter } from '../server/auth-http.ts';

const require = createRequire(import.meta.url);
const Y = require('yjs') as typeof import('yjs');
const { WebsocketProvider } = require('y-websocket') as typeof import('y-websocket');
const root = fileURLToPath(new URL('../', import.meta.url));

async function selfSignedCertificate(directory: string) {
	const forge = require('node-forge') as typeof import('node-forge');
	const keys = forge.pki.rsa.generateKeyPair(2048);
	const certificate = forge.pki.createCertificate();
	certificate.publicKey = keys.publicKey; certificate.serialNumber = '01';
	certificate.validity.notBefore = new Date(Date.now() - 60_000);
	certificate.validity.notAfter = new Date(Date.now() + 86_400_000);
	certificate.setSubject([{ name: 'commonName', value: 'localhost' }]);
	certificate.setIssuer(certificate.subject.attributes);
	certificate.setExtensions([{ name: 'subjectAltName', altNames: [{ type: 7, ip: '127.0.0.1' }] }]);
	certificate.sign(keys.privateKey, forge.md.sha256.create());
	const cert = path.join(directory, 'cert.pem'), key = path.join(directory, 'key.pem');
	await writeFile(cert, forge.pki.certificateToPem(certificate));
	await writeFile(key, forge.pki.privateKeyToPem(keys.privateKey), { mode: 0o600 });
	return { cert, key };
}

async function until(check: () => boolean, timeout = 5000) {
	const end = Date.now() + timeout;
	while (!check()) {
		if (Date.now() > end) throw new Error('Timed out waiting for isolated local client');
		await new Promise(resolve => setTimeout(resolve, 10));
	}
}

for (const insecure of [false, true]) test(`upstream subpaths support login, HTTP sync and WebSockets over ${insecure ? 'untrusted TLS with --insecure' : 'HTTP'}`, async t => {
	const directory = await mkdtemp(path.join(tmpdir(), 'lists subpath '));
	const remoteStorage = new LocalStorage(path.join(directory, 'remote'));
	remoteStorage.set('passwordHash', bcrypt.hashSync('test-only', 4));
	const remote = createLocalHost({ storage: remoteStorage, username: 'alice', status: () => ({}) });
	const prefix = '/lists_and_prices', paths: string[] = [];
	// Production subpath auth clears a legacy root cookie before issuing the
	// scoped cookie. Share its real session database with the fixture's Yjs host.
	const prefixedAuth = express();
	prefixedAuth.use('/api', createAuthRouter(new SessionStore(remoteStorage.db, {
		secret: remoteStorage.get('sessionSecret')!,
		readPasswordHash: username => username === 'alice' ? remoteStorage.get('passwordHash') : undefined
	}), insecure, prefix + '/'));
	// Model the deployment proxy, which removes only the configured public prefix
	// before forwarding HTTP requests and WebSocket upgrades to the root server.
	const stripPrefix = (request: http.IncomingMessage) => {
		paths.push(request.url!);
		if (!request.url?.startsWith(prefix + '/')) return false;
		request.url = request.url.slice(prefix.length);
		return true;
	};
	const handle = (request: http.IncomingMessage, response: http.ServerResponse) => {
		if (!stripPrefix(request)) { response.writeHead(404).end(); return; }
		if (request.url === '/api/login' || request.url === '/api/session') prefixedAuth(request, response);
		else remote.server.emit('request', request, response);
	};
	const certificate = insecure ? await selfSignedCertificate(directory) : undefined;
	const proxy = certificate
		? https.createServer({ cert: await readFile(certificate.cert), key: await readFile(certificate.key) }, handle)
		: http.createServer(handle);
	proxy.on('upgrade', (request, socket, head) => {
		if (stripPrefix(request)) remote.server.emit('upgrade', request, socket, head);
		else socket.destroy();
	});
	proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening');
	const server = normalizeUpstream(`${insecure ? 'https' : 'http'}://127.0.0.1:${(proxy.address() as { port: number }).port}${prefix}/`);
	const localStorage = new LocalStorage(path.join(directory, 'local'));
	const doc = new Y.Doc({ gc: false });
	doc.on('update', update => localStorage.append(update));
	let upstream: UpstreamSync | undefined;
	t.after(async () => {
		await upstream?.close(); await remote.close();
		await new Promise<void>(resolve => proxy.close(() => resolve()));
		doc.destroy(); localStorage.close(); remoteStorage.close();
		await rm(directory, { recursive: true, force: true });
	});
	if (insecure) await assert.rejects(loginUpstream(server, 'alice', 'test-only'), 'verification is enabled by default');
	const cookie = await loginUpstream(server, 'alice', 'test-only', insecure);
	if (insecure) await assert.rejects(fetch(server + '/api/session'), 'upstream override must not disable TLS validation globally');
	upstream = new UpstreamSync({ server, username: 'alice', cookie, doc, storage: localStorage, insecure, intervalMs: 60_000 });
	assert.equal(upstream.provider.url, server.replace(/^http/, 'ws') + '/yjs/pnl-alice');
	upstream.start(); await upstream.sync();
	assert.equal(upstream.status.pending, false);
	await until(() => upstream!.provider.synced);
	doc.getText('note').insert(0, 'local through prefixed WebSocket');
	await until(() => remote.doc.getText('note').toString() === 'local through prefixed WebSocket');
	remote.doc.getText('note').insert(0, 'remote: ');
	await until(() => doc.getText('note').toString().startsWith('remote: '));
	await upstream.sync();
	assert.equal(upstream.status.pending, false);
	for (const route of ['/api/login', '/api/session', '/api/sync/state', '/api/sync', '/yjs/pnl-alice']) {
		assert.ok(paths.includes(prefix + route), `Expected a request to ${prefix + route}`);
	}
});

test('local storage retains original updates, deletions, snapshots and pending dependencies across compaction and restart', async t => {
	const directory = await mkdtemp(path.join(tmpdir(), 'lists local storage '));
	t.after(() => rm(directory, { recursive: true, force: true }));
	let storage = new LocalStorage(directory);
	const original = new Y.Doc({ gc: false });
	original.getText('note').insert(0, 'historical text');
	const beforeDelete = Y.snapshot(original);
	storage.append(Y.encodeStateAsUpdate(original));
	original.on('update', update => storage.append(update));
	original.getText('note').delete(0, 11);
	const dependent = new Y.Doc({ gc: false });
	dependent.getText('pending').insert(0, 'first');
	const missing = Y.encodeStateAsUpdate(dependent);
	let later: Uint8Array | undefined;
	dependent.on('update', update => { later = update; });
	dependent.getText('pending').insert(5, ' second');
	for (let index = 0; index < 70; index++) storage.append(later!);
	storage.compact();
	assert.throws(() => new LocalStorage(directory), /locked|busy/i, 'a second process must not open the same data directory for writes');
	storage.exportSnapshot();
	assert.match(await readFile(path.join(directory, '.gitignore'), 'utf8'), /^\*/);
	storage.close();
	storage = new LocalStorage(directory);
	const restored = new Y.Doc({ gc: false });
	Y.applyUpdate(restored, storage.mergedUpdate());
	assert.equal(restored.getText('note').toString(), 'text');
	const history = Y.createDocFromSnapshot(restored, beforeDelete);
	assert.equal(history.getText('note').toString(), 'historical text');
	Y.applyUpdate(restored, missing);
	assert.equal(restored.getText('pending').toString(), 'first second');
	const snapshotCopy = new Y.Doc({ gc: false });
	Y.applyUpdate(snapshotCopy, await readFile(path.join(directory, 'document.yjs')));
	Y.applyUpdate(snapshotCopy, missing);
	assert.equal(snapshotCopy.getText('pending').toString(), 'first second');
	assert.equal(storage.revision, 72);
	storage.close(); original.destroy(); dependent.destroy(); restored.destroy(); history.destroy(); snapshotCopy.destroy();
});

test('small edits preserve a large existing record and consolidate without changing sync revisions', async t => {
	const directory = await mkdtemp(path.join(tmpdir(), 'lists large SQLite base '));
	let storage = new LocalStorage(directory);
	const doc = new Y.Doc({ gc: false });
	t.after(async () => { storage.close(); doc.destroy(); await rm(directory, { recursive: true, force: true }); });
	doc.getText('large').insert(0, 'x'.repeat(17 * 1024 * 1024));
	const base = Y.encodeStateAsUpdate(doc);
	storage.append(base);
	doc.on('update', update => storage.append(update));
	storage.db.exec(`CREATE TRIGGER preserve_large_update BEFORE DELETE ON updates WHEN OLD.id = 1
		BEGIN SELECT RAISE(ABORT, 'large base was unnecessarily rewritten'); END;
		CREATE TRIGGER preserve_large_update_value BEFORE UPDATE ON updates WHEN OLD.id = 1
		BEGIN SELECT RAISE(ABORT, 'large base was unnecessarily rewritten'); END;`);
	let merges = 0;
	for (let index = 0; index < 1100; index++) {
		doc.getText('edits').insert(index, 'a');
		const revision = storage.revision;
		merges += storage.compact();
		assert.equal(storage.revision, revision);
	}
	assert.ok(merges > 0, 'small updates should still be consolidated');
	assert.ok((storage.db.prepare('SELECT count(*) AS count FROM updates').get() as { count: number }).count < 64);
	assert.equal((storage.db.prepare('SELECT length(bytes) AS size FROM updates WHERE id = 1').get() as { size: number }).size, base.byteLength);
	storage.set('ackRevision', String(storage.revision));
	storage.close(); storage = new LocalStorage(directory);
	const restored = new Y.Doc({ gc: false });
	Y.applyUpdate(restored, storage.mergedUpdate());
	assert.equal(restored.getText('large').length, 17 * 1024 * 1024);
	assert.equal(restored.getText('edits').toString(), 'a'.repeat(1100));
	assert.equal(storage.get('ackRevision'), String(storage.revision));
	assert.equal(storage.compact(), 0);
	assert.equal(storage.compact(), 0, 'idle maintenance must do no further consolidation');
	restored.destroy();
});

test('a failed consolidation rolls back its replacements and retains every original update', async t => {
	const directory = await mkdtemp(path.join(tmpdir(), 'lists failed consolidation '));
	const storage = new LocalStorage(directory), doc = new Y.Doc({ gc: false });
	t.after(async () => { storage.close(); doc.destroy(); await rm(directory, { recursive: true, force: true }); });
	doc.on('update', update => storage.append(update));
	for (let index = 0; index < 40; index++) doc.getText('note').insert(index, 'a');
	const before = storage.db.prepare('SELECT id, bytes FROM updates ORDER BY id').all();
	storage.db.exec(`CREATE TRIGGER fail_consolidation BEFORE DELETE ON updates
		BEGIN SELECT RAISE(ABORT, 'simulated failed consolidation'); END;`);
	assert.throws(() => storage.compact(), /simulated failed consolidation/);
	assert.deepEqual(storage.db.prepare('SELECT id, bytes FROM updates ORDER BY id').all(), before);
	storage.db.exec('DROP TRIGGER fail_consolidation');
	assert.ok(storage.compact() > 0);
	const restored = new Y.Doc({ gc: false });
	Y.applyUpdate(restored, storage.mergedUpdate());
	assert.equal(restored.getText('note').toString(), 'a'.repeat(40)); restored.destroy();
});

test('unchanged metadata values are not rewritten', async t => {
	const directory = await mkdtemp(path.join(tmpdir(), 'lists idle metadata '));
	const storage = new LocalStorage(directory);
	t.after(async () => { storage.close(); await rm(directory, { recursive: true, force: true }); });
	storage.set('ackRevision', '0');
	const count = () => (storage.db.prepare('SELECT total_changes() AS count').get() as { count: number }).count;
	const before = count(); storage.set('ackRevision', '0');
	assert.equal(count(), before);
	storage.set('ackRevision', '1'); assert.equal(count(), before + 1);
});

test('headless replica serves browser WebSockets, survives offline restarts, and merges both ways after reconnection', async t => {
	const directory = await mkdtemp(path.join(tmpdir(), 'lists local replica '));
	const hash = bcrypt.hashSync('test-only', 4);
	const upstreamDirectory = path.join(directory, 'upstream'), localDirectory = path.join(directory, 'local');
	const build = path.join(directory, 'frontend');
	await import('node:fs/promises').then(fs => fs.mkdir(build));
	await writeFile(path.join(build, 'index.html'), '<!doctype html><title>Local frontend fixture</title>');
	let remoteStorage = new LocalStorage(upstreamDirectory);
	remoteStorage.set('passwordHash', hash);
	let remote = createLocalHost({ storage: remoteStorage, username: 'alice', status: () => ({}) });
	remote.server.listen(0, '127.0.0.1'); await once(remote.server, 'listening');
	const port = (remote.server.address() as { port: number }).port;
	const base = `http://127.0.0.1:${port}`;
	const cookie = await loginUpstream(base, 'alice', 'test-only');
	let localStorage = new LocalStorage(localDirectory);
	localStorage.set('passwordHash', hash);
	let upstream: UpstreamSync | undefined;
	let local = createLocalHost({ storage: localStorage, username: 'alice', buildDirectory: build, status: () => upstream!.status });
	local.server.listen(0, '127.0.0.1'); await once(local.server, 'listening');
	let localBase = `http://127.0.0.1:${(local.server.address() as { port: number }).port}`;
	upstream = new UpstreamSync({ server: base, username: 'alice', cookie, doc: local.doc, storage: localStorage, intervalMs: 60_000 });
	upstream.start();
	const browserCookie = await loginUpstream(localBase, 'alice', 'test-only');
	class BrowserSocket extends WebSocket {
		constructor(url: string) { super(url, { headers: { Cookie: browserCookie } }); }
	}
	const browser = new Y.Doc({ gc: false });
	const provider = new WebsocketProvider(localBase.replace('http', 'ws') + '/yjs', 'pnl-alice', browser, {
		WebSocketPolyfill: BrowserSocket as unknown as typeof globalThis.WebSocket, disableBc: true
	});
	let remoteClosed = false, localClosed = false;
	t.after(async () => {
		provider.destroy(); browser.destroy();
		await upstream?.close();
		if (!localClosed) { await local.close(); localStorage.close(); }
		if (!remoteClosed) { await remote.close(); remoteStorage.close(); }
		await rm(directory, { recursive: true, force: true });
	});
	await until(() => provider.synced);
	assert.equal(await (await fetch(localBase)).text(), '<!doctype html><title>Local frontend fixture</title>');
	assert.equal((await fetch(localBase + '/api/local/status')).status, 401);
	assert.equal((await fetch(localBase + '/api/tasks')).status, 404);
	browser.getMap('items').set('local', 'from browser');
	await until(() => remote.doc.getMap('items').get('local') === 'from browser');
	remote.doc.getMap('items').set('remote', 'from server');
	await until(() => browser.getMap('items').get('remote') === 'from server');
	await upstream.sync();
	if (upstream.status.pending) await upstream.sync();
	await until(() => !upstream!.status.pending);
	assert.ok(upstream.status.lastSyncAt);
	const changes = () => (localStorage.db.prepare('SELECT total_changes() AS count').get() as { count: number }).count;
	const beforeIdle = changes(), persistedConfirmation = localStorage.get('lastSyncAt');
	await upstream.sync(); await upstream.sync();
	assert.equal(changes(), beforeIdle, 'successful idle sync must not update SQLite rows');
	assert.equal(localStorage.get('lastSyncAt'), persistedConfirmation);
	assert.equal((await readdir(localDirectory)).includes('document.yjs'), false, 'sync does not create an export');
	const response = await fetch(localBase + '/api/sync/state', { method: 'POST', headers: { Cookie: browserCookie, 'Content-Type': 'application/octet-stream' }, body: encodeSyncMessage('alice', Y.encodeStateVector(browser)) });
	assert.equal(response.status, 200); assert.equal(response.headers.get('X-Lists-Sync-Target'), 'laptop');
	assert.equal(decodeSyncMessage(new Uint8Array(await response.arrayBuffer())).username, 'alice');

	await remote.close(); remoteStorage.close(); remoteClosed = true;
	browser.getMap('items').delete('remote');
	browser.getText('offline').insert(0, 'saved with no upstream');
	await until(() => local.doc.getText('offline').toString() === 'saved with no upstream');
	await upstream.sync();
	assert.equal(upstream.status.pending, true); assert.ok(upstream.status.error);
	provider.destroy();
	await upstream.close(); await local.close(); localStorage.close(); localClosed = true;
	localStorage = new LocalStorage(localDirectory);
	local = createLocalHost({ storage: localStorage, username: 'alice', buildDirectory: build, status: () => upstream!.status });
	local.server.listen(0, '127.0.0.1'); await once(local.server, 'listening'); localClosed = false;
	localBase = `http://127.0.0.1:${(local.server.address() as { port: number }).port}`;
	assert.equal(local.doc.getText('offline').toString(), 'saved with no upstream');
	assert.equal(local.doc.getMap('items').has('remote'), false);
	assert.equal((await fetch(localBase + '/api/session', { headers: { Cookie: browserCookie } })).status, 200, 'local login persists independently of upstream availability');
	upstream = new UpstreamSync({ server: base, username: 'alice', cookie, doc: local.doc, storage: localStorage, intervalMs: 60_000 });
	upstream.start(); await upstream.sync();
	assert.equal(upstream.status.pending, true);

	remoteStorage = new LocalStorage(upstreamDirectory);
	remote = createLocalHost({ storage: remoteStorage, username: 'alice', status: () => ({}) });
	remote.doc.getText('offline').insert(0, 'other device: ');
	remote.server.listen(port, '127.0.0.1'); await once(remote.server, 'listening'); remoteClosed = false;
	await upstream.sync();
	assert.equal(upstream.status.pending, false);
	assert.equal(local.doc.getText('offline').length > 'saved with no upstream'.length, true);
	assert.equal(remote.doc.getText('offline').toString(), local.doc.getText('offline').toString());
	assert.equal(remote.doc.getMap('items').has('remote'), false, 'a deletion-only change reaches upstream');

	await fetch(base + '/api/logout', { method: 'POST', headers: { Cookie: cookie } });
	await upstream.sync();
	assert.equal(upstream.status.needsLogin, true);
	assert.equal((await fetch(localBase + '/api/session', { headers: { Cookie: browserCookie } })).status, 200);
	local.doc.getText('offline').insert(0, 'still local: ');
	assert.equal(upstream.status.pending, true);
});

test('local HTTP sync rejects another account and never acknowledges a failed disk write', async t => {
	const directory = await mkdtemp(path.join(tmpdir(), 'lists local failure '));
	const storage = new LocalStorage(directory);
	storage.set('passwordHash', bcrypt.hashSync('test-only', 4));
	let failed = false;
	const local = createLocalHost({ storage, username: 'alice', status: () => ({}), onStorageError: () => { failed = true; } });
	local.server.listen(0, '127.0.0.1'); await once(local.server, 'listening');
	t.after(async () => { await local.close(); storage.close(); await rm(directory, { recursive: true, force: true }); });
	const base = `http://127.0.0.1:${(local.server.address() as { port: number }).port}`;
	const cookie = await loginUpstream(base, 'alice', 'test-only');
	const doc = new Y.Doc({ gc: false }); t.after(() => doc.destroy());
	doc.getText('note').insert(0, 'must be saved');
	const post = (username: string) => fetch(base + '/api/sync', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/octet-stream' },
		body: encodeSyncMessage(username, Y.encodeStateVector(doc), Y.encodeStateAsUpdate(doc)) });
	assert.equal((await post('bob')).status, 409);
	assert.equal(local.doc.getText('note').length, 0);
	storage.append = () => { throw new Error('Simulated disk failure'); };
	assert.equal((await post('alice')).status, 503);
	assert.equal(failed, true);
	const restored = new Y.Doc({ gc: false });
	Y.applyUpdate(restored, storage.mergedUpdate());
	assert.equal(restored.getText('note').length, 0);
	restored.destroy();
});

test('generated launcher starts from an arbitrary working directory and keeps all runtime files there', async t => {
	const directory = await mkdtemp(path.join(tmpdir(), "lists CLI ' spaces "));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const remoteStorage = new LocalStorage(path.join(directory, 'remote'));
	remoteStorage.set('passwordHash', bcrypt.hashSync('test-only', 4));
	const certificate = await selfSignedCertificate(directory);
	const remote = createLocalHost({ storage: remoteStorage, username: 'alice', ...certificate, status: () => ({}) });
	remote.server.listen(0, '127.0.0.1'); await once(remote.server, 'listening');
	t.after(async () => { await remote.close(); remoteStorage.close(); });
	const base = `https://127.0.0.1:${(remote.server.address() as { port: number }).port}`;
	const executable = path.join(directory, 'lists-local-client');
	execFileSync(process.execPath, [path.join(root, 'scripts/build-local-client.mjs'), '--output', executable], { cwd: directory });
	const password = path.join(directory, 'password'); await writeFile(password, 'test-only\n', { mode: 0o600 });
	let child: ReturnType<typeof spawn>;
	let output = '';
	async function start(args: string[], command = executable) {
		output = '';
		child = spawn(command, args, { cwd: directory, stdio: ['ignore', 'pipe', 'pipe'] });
		child.stdout!.on('data', chunk => { output += chunk; }); child.stderr!.on('data', chunk => { output += chunk; });
		await until(() => { assert.equal(child.exitCode, null, output); return output.includes('Running in foreground'); }, 10_000);
	}
	async function stop() {
		const exited = once(child, 'exit'); child.kill('SIGTERM');
		const [code] = await exited; assert.equal(code, 0, output);
	}
	t.after(() => { if (child?.exitCode === null) child.kill('SIGKILL'); });
	await start(['--server', base, '--username', 'alice', '--password-file', password, '--no-serve', '--insecure']);
	await until(() => output.includes('Upstream confirmed.'));
	await stop();
	assert.deepEqual((await readdir(path.join(directory, 'lists-local-data'))).sort(), ['.gitignore', 'yjs.sqlite']);
	// Export is local-only: it needs neither a reachable server nor credentials.
	const exportCommand = (args: string[]) => new Promise<void>((resolve, reject) => {
		const command = spawn(path.join(root, 'local_client_run.sh'), ['--export-yjs', ...args], { cwd: directory, stdio: ['ignore', 'pipe', 'pipe'] });
		let result = '';
		command.stdout.on('data', chunk => { result += chunk; }); command.stderr.on('data', chunk => { result += chunk; });
		command.once('error', reject);
		command.once('exit', code => code === 0 ? resolve() : reject(new Error(result)));
	});
	const snapshot = path.join(directory, 'lists-local-data', 'document.yjs');
	await exportCommand([]);
	const exported = await readFile(snapshot), restored = new Y.Doc({ gc: false });
	Y.applyUpdate(restored, exported); restored.destroy();
	await writeFile(snapshot, 'old export is left alone');
	await start(['--no-serve', '--insecure']);
	await until(() => output.includes('Upstream confirmed.'));
	await stop();
	assert.equal(await readFile(snapshot, 'utf8'), 'old export is left alone', 'startup, sync and shutdown leave previous exports untouched');
	// A fresh pull has the checked-in run script but no generated executable.
	await rm(executable);
	await start(['--server', base, '--username', 'alice', '--no-serve', '--insecure'], path.join(root, 'local_client_run.sh'));
	await until(() => output.includes('Upstream confirmed.'));
	await stop();
	assert.ok(!output.includes('password'), output);
	await exportCommand(['--output', './custom-backup.yjs']);
	assert.deepEqual(await readFile(path.join(directory, 'custom-backup.yjs')), exported);
	await assert.rejects(exportCommand(['--output', './lists-local-data/yjs.sqlite']), /must not overwrite/);
});
