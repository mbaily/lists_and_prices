import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { createHash } from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import http from 'node:http';
import { createRequire } from 'node:module';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import cookieSignature from 'cookie-signature';
import express from 'express';
import WebSocket from 'ws';
import {
	COOKIE_NAME, SessionStore, isValidPassword, isValidUsername,
	readHtpasswdHash, readSessionCookie, sessionTtlMs
} from '../server/auth.ts';
import { createAuthRouter } from '../server/auth-http.ts';
import {
	SESSION_RECHECK_MS, SessionSocket, attachYjsServer, authorizedDocName,
	authorizeYjsUpgrade, type WebSocketLike
} from '../server/auth-websocket.ts';

// Test-only credentials. No imports of server/index.ts or reads of application data.
const SECRET = 'isolated-test-secret-not-used-by-the-application';
const PASSWORD = 'test password';
const HASH = bcrypt.hashSync(PASSWORD, 4);
const RESET_HASH = bcrypt.hashSync('reset password', 4);
const START = 1_800_000_000_000;

function fixture(t: TestContext, ttlMs = 60_000) {
	const db = new Database(':memory:');
	const cleanups: (() => void | Promise<void>)[] = [() => { db.close(); }];
	t.after(async () => { for (const cleanup of cleanups.reverse()) await cleanup(); });
	const users = new Map([['alice', HASH], ['bob', HASH]]);
	let now = START;
	const options = { secret: SECRET, readPasswordHash: (name: string) => users.get(name), ttlMs, now: () => now };
	const sessions = new SessionStore(db, options);
	return {
		db, users, options, sessions,
		setNow: (value: number) => { now = value; },
		addCleanup: (cleanup: () => void | Promise<void>) => { cleanups.push(cleanup); }
	};
}

test('credentials reject nonstrings, room/file delimiters, and bcrypt truncation', () => {
	for (const name of ['alice', 'Alice.1', 'a+b@example.test', '_user', 'a-b~c']) {
		assert.equal(isValidUsername(name), true);
	}
	for (const name of [undefined, null, {}, [], 42, '', ' alice', 'alice ', 'a:b', 'a\nb', 'a\rb',
		'alice\n', 'alice\r', 'alice\u2028', 'alice\u2029', 'a/b', 'a\\b', 'a?b', 'a#b', 'a%2fb', 'a\0b', 'a'.repeat(129)]) {
		assert.equal(isValidUsername(name), false);
	}
	for (const password of [undefined, null, {}, [], 42, '', 'a'.repeat(73), 'é'.repeat(37)]) {
		assert.equal(isValidPassword(password), false);
	}
	assert.equal(isValidPassword('a'.repeat(72)), true);
	assert.equal(isValidPassword('é'.repeat(36)), true);
	assert.equal(isValidPassword(' password with spaces '), true);
});

test('htpasswd lookup is exact, supports CRLF, and rejects duplicates or broken hashes', () => {
	assert.equal(readHtpasswdHash(`alice2:${RESET_HASH}\r\nalice:${HASH}\r\n`, 'alice'), HASH);
	assert.equal(readHtpasswdHash(`alice2:${HASH}\n`, 'alice'), undefined);
	assert.equal(readHtpasswdHash(`alice:${HASH}\nalice:${RESET_HASH}\n`, 'alice'), undefined);
	assert.equal(readHtpasswdHash('alice:not-bcrypt\n', 'alice'), undefined);
	assert.equal(readHtpasswdHash(`a/b:${HASH}\n`, 'a/b'), undefined);
});

test('session lifetime configuration is finite, positive, and not partially parsed', () => {
	assert.equal(sessionTtlMs(), 30 * 86_400_000);
	assert.equal(sessionTtlMs('1'), 86_400_000);
	for (const days of ['', '0', '-1', '1.5', '30oops', '30\n', '30\r', '30\u2028', 'Infinity', 'NaN', '9999999999999999']) {
		assert.throws(() => sessionTtlMs(days), /SESSION_EXPIRY_DAYS/);
	}
});

test('cookie parsing agrees for HTTP and WS and rejects duplicates and bad encoding', () => {
	const token = 'v2.example.signature+/';
	assert.equal(readSessionCookie(`other=x; ${COOKIE_NAME}=${encodeURIComponent(token)}`), token);
	assert.equal(readSessionCookie(`${COOKIE_NAME}=${token}`), token);
	assert.equal(readSessionCookie(undefined), undefined);
	assert.equal(readSessionCookie(`other=${token}`), undefined);
	assert.equal(readSessionCookie(`${COOKIE_NAME}=%ZZ`), undefined);
	assert.equal(readSessionCookie(`${COOKIE_NAME}=; ${COOKIE_NAME}=${token}`), undefined);
	assert.equal(readSessionCookie(`${COOKIE_NAME}=${token}; ${COOKIE_NAME}=${token}`), undefined);
});

test('opaque sessions persist across store recreation without storing bearer tokens or password hashes', async (t) => {
	const { db, options, sessions } = fixture(t);
	const first = await sessions.login('alice', PASSWORD);
	const second = await sessions.login('alice', PASSWORD);
	assert.ok(first && second);
	assert.notEqual(first.token, second.token);
	assert.match(first.token, /^v2\.[a-f0-9]{64}\.[A-Za-z0-9+/]{43}$/);
	const stored = db.prepare('SELECT * FROM sessions').all();
	const serialized = JSON.stringify(stored);
	assert.equal(serialized.includes(first.token), false);
	assert.equal(serialized.includes(first.token.split('.').slice(0, 2).join('.')), false);
	assert.equal(serialized.includes(HASH), false);
	assert.equal(serialized.includes(PASSWORD), false);
	const restoredDb = new Database(db.serialize());
	t.after(() => restoredDb.close());
	const restarted = new SessionStore(restoredDb, options);
	assert.deepEqual(restarted.verify(first.token), { idHash: first.idHash, username: 'alice', expiresAt: START + 60_000 });
	assert.equal(new SessionStore(db, { ...options, secret: 'rotated-test-secret' }).verify(first.token), null);
});

test('legacy cookies, tampering, unknown signed IDs, and nonstring cookies fail closed', async (t) => {
	const { sessions } = fixture(t);
	const session = await sessions.login('alice', PASSWORD);
	assert.ok(session);
	const changedId = `${session.token.slice(0, 3)}${session.token[3] === 'a' ? 'b' : 'a'}${session.token.slice(4)}`;
	const changedSignature = `${session.token.slice(0, -1)}${session.token.endsWith('A') ? 'B' : 'A'}`;
	for (const token of [undefined, null, {}, [], 123, '', 'alice', cookieSignature.sign('alice', SECRET),
		changedId, changedSignature, cookieSignature.sign(`v2.${'0'.repeat(64)}`, SECRET),
		cookieSignature.sign(`v2.${'a'.repeat(64)}`, 'wrong-secret')]) {
		assert.equal(sessions.verify(token), null);
	}
	assert.equal(sessions.verify(session.token)?.username, 'alice');
});

test('expiry is checked at the exact deadline, persisted, and cannot be extended by replay', async (t) => {
	const { sessions, setNow, db, options } = fixture(t);
	const session = await sessions.login('alice', PASSWORD);
	assert.ok(session);
	setNow(session.expiresAt - 1);
	assert.ok(sessions.verify(session.token));
	setNow(session.expiresAt);
	assert.equal(sessions.verify(session.token), null);
	setNow(START);
	assert.equal(new SessionStore(db, options).verify(session.token), null);
});

test('logout revokes persistently, is idempotent, and does not revoke other sessions', async (t) => {
	const { sessions, db, options } = fixture(t);
	const first = await sessions.login('alice', PASSWORD);
	const otherDevice = await sessions.login('alice', PASSWORD);
	const bob = await sessions.login('bob', PASSWORD);
	assert.ok(first && otherDevice && bob);
	sessions.revoke(first.token);
	sessions.revoke(first.token);
	sessions.revoke({ invalid: 'cookie' });
	assert.equal(new SessionStore(db, options).verify(first.token), null);
	assert.ok(sessions.verify(otherDevice.token));
	assert.ok(sessions.verify(bob.token));
});

test('removed and reset accounts invalidate sessions permanently', async (t) => {
	const { sessions, users } = fixture(t);
	const removed = await sessions.login('alice', PASSWORD);
	const reset = await sessions.login('bob', PASSWORD);
	assert.ok(removed && reset);
	users.delete('alice');
	users.set('bob', RESET_HASH);
	assert.equal(sessions.verify(removed.token), null);
	assert.equal(sessions.verify(reset.token), null);
	users.set('alice', HASH);
	users.set('bob', HASH);
	assert.equal(sessions.verify(removed.token), null);
	assert.equal(sessions.verify(reset.token), null);
});

test('CLI-style revocation invalidates every user session even after identical credentials are restored', async (t) => {
	const { sessions, db, options } = fixture(t);
	const first = await sessions.login('alice', PASSWORD);
	const second = await sessions.login('alice', PASSWORD);
	const bob = await sessions.login('bob', PASSWORD);
	assert.ok(first && second && bob);
	new SessionStore(db, options).revokeUser('alice');
	assert.equal(sessions.verify(first.token), null);
	assert.equal(sessions.verify(second.token), null);
	assert.ok(sessions.verify(bob.token));
});

test('bad credentials never mint sessions, including removal/reset during async bcrypt', async (t) => {
	const { sessions, users, db } = fixture(t);
	for (const [username, password] of [['alice', 'wrong'], ['missing', PASSWORD], ['alice', {}], [{}, PASSWORD]]) {
		assert.equal(await sessions.login(username, password), null);
	}
	const pending = sessions.login('alice', PASSWORD);
	users.set('alice', RESET_HASH);
	assert.equal(await pending, null);
	const removed = sessions.login('bob', PASSWORD);
	users.delete('bob');
	assert.equal(await removed, null);
	assert.deepEqual(db.prepare('SELECT * FROM sessions').all(), []);
});

test('unreadable or malformed credential sources fail closed without exposing errors', async (t) => {
	const { sessions, users, db, options } = fixture(t);
	const session = await sessions.login('alice', PASSWORD);
	assert.ok(session);
	const unreadable = new SessionStore(db, { ...options, readPasswordHash: () => { throw new Error('test-only read failure'); } });
	assert.equal(unreadable.verify(session.token), null);
	assert.equal(await unreadable.login('alice', PASSWORD), null);
	users.set('bob', 'invalid hash');
	assert.equal(await sessions.login('bob', PASSWORD), null);
});

test('expired rows are pruned and forged database lookup hashes are not bearer credentials', async (t) => {
	const { sessions, setNow, db } = fixture(t);
	const session = await sessions.login('alice', PASSWORD);
	assert.ok(session);
	assert.equal(sessions.verify(session.idHash), null);
	assert.equal(session.idHash, createHash('sha256').update(session.token.split('.').slice(0, 2).join('.')).digest('hex'));
	setNow(session.expiresAt);
	sessions.pruneExpired();
	assert.deepEqual(db.prepare('SELECT * FROM sessions').all(), []);
});

test('only the exact owned room is accepted, preserving the yjs/ document namespace', () => {
	for (const url of ['/yjs/pnl-alice', '/yjs/pnl-alice?', '/yjs/pnl-alice?client=1&room=pnl-bob']) {
		assert.equal(authorizedDocName(url, 'alice'), 'yjs/pnl-alice');
	}
	assert.equal(authorizedDocName('/yjs/pnl-a+b@example.test', 'a+b@example.test'), 'yjs/pnl-a+b@example.test');
	for (const url of [undefined, '', '/yjs', '/yjs/', '/yjs/pnl-', '/yjs/pnl-bob', '/yjs/pnl-Alice',
		'/yjsx/pnl-alice', '/yjs-other/pnl-alice', '/pnl-alice', '//yjs/pnl-alice', '/yjs//pnl-alice',
		'/yjs/pnl-alice/', '/yjs/pnl-alice/extra', '/yjs/../yjs/pnl-alice', '/yjs/./pnl-alice',
		'/yjs/pnl-%61lice', '/%79js/pnl-alice', '/yjs%2fpnl-alice', '/yjs/pnl-alice%2f',
		'/yjs/pnl-alice%00', '/yjs/pnl-alice%', '/yjs/pnl-alice#fragment', '/yjs/pnl-alice?q=1#fragment',
		'/yjs\\pnl-alice', '/yjs/pnl-alice\r\n', '/yjs/pnl-alice ', 'http://localhost/yjs/pnl-alice']) {
		assert.equal(authorizedDocName(url, 'alice'), null, String(url));
	}
	assert.equal(authorizedDocName('/yjs/pnl-alice/bob', 'alice/bob'), null);
});

function cookie(token: string): string {
	return `${COOKIE_NAME}=${encodeURIComponent(token)}`;
}

test('upgrade authorization rejects cross-user rooms and revalidates expiry and credentials', async (t) => {
	const { sessions, users, setNow } = fixture(t);
	const alice = await sessions.login('alice', PASSWORD);
	const bob = await sessions.login('bob', PASSWORD);
	assert.ok(alice && bob);
	const upgrade = (url: string, token?: string) => authorizeYjsUpgrade(sessions, { url, headers: { cookie: token && cookie(token) } });
	assert.deepEqual(upgrade('/yjs/pnl-alice'), { ok: false, status: 401 });
	assert.deepEqual(upgrade('/yjs/pnl-bob', alice.token), { ok: false, status: 403 });
	assert.deepEqual(upgrade('/yjs/pnl-alice', bob.token), { ok: false, status: 403 });
	assert.deepEqual(upgrade('/yjs/pnl-alice/extra', alice.token), { ok: false, status: 403 });
	assert.equal(upgrade('/yjs/pnl-alice?client=1', alice.token).ok, true);
	users.set('bob', RESET_HASH);
	assert.deepEqual(upgrade('/yjs/pnl-bob', bob.token), { ok: false, status: 401 });
	setNow(alice.expiresAt);
	assert.deepEqual(upgrade('/yjs/pnl-alice', alice.token), { ok: false, status: 401 });
});

class FakeSocket extends EventEmitter implements WebSocketLike {
	binaryType = 'nodebuffer';
	readyState = 1;
	sent: Uint8Array[] = [];
	ping() {}
	send(data: Uint8Array, callback?: (error?: Error) => void) {
		this.sent.push(data);
		callback?.();
	}
	terminate() {
		if (this.readyState === 3) return;
		this.readyState = 3;
		this.emit('close');
	}
}

async function fakeConnection(f: ReturnType<typeof fixture>, username = 'alice') {
	const session = await f.sessions.login(username, PASSWORD);
	assert.ok(session);
	const raw = new FakeSocket();
	const guarded = new SessionSocket(raw, f.sessions, session);
	f.addCleanup(() => guarded.close());
	return { session, raw, guarded };
}

test('logout closes every socket for that session immediately, but not another device', async (t) => {
	const f = fixture(t);
	const first = await fakeConnection(f);
	const sameSessionRaw = new FakeSocket();
	const sameSession = new SessionSocket(sameSessionRaw, f.sessions, first.session);
	f.addCleanup(() => sameSession.close());
	const other = await fakeConnection(f);
	f.sessions.revoke(first.session.token);
	assert.equal(first.raw.readyState, 3);
	assert.equal(sameSessionRaw.readyState, 3);
	assert.equal(other.raw.readyState, 1);
});

test('invalid established sessions cannot deliver inbound frames or outbound broadcasts', async (t) => {
	for (const reason of ['expired', 'removed', 'reset', 'external revocation']) {
		await t.test(reason, async (t) => {
			const f = fixture(t);
			const incoming = await fakeConnection(f);
			const outgoing = await fakeConnection(f);
			let delivered = 0;
			incoming.guarded.on('message', () => { delivered++; });
			incoming.raw.emit('message', new Uint8Array([1]));
			outgoing.guarded.send(new Uint8Array([1]));
			assert.equal(delivered, 1);
			assert.equal(outgoing.raw.sent.length, 1);
			if (reason === 'expired') f.setNow(incoming.session.expiresAt);
			if (reason === 'removed') f.users.delete('alice');
			if (reason === 'reset') f.users.set('alice', RESET_HASH);
			if (reason === 'external revocation') new SessionStore(f.db, f.options).revokeUser('alice');
			incoming.raw.emit('message', new Uint8Array([2]));
			outgoing.guarded.send(new Uint8Array([2]));
			assert.equal(delivered, 1, 'the rejected frame must not reach a later Yjs listener');
			assert.equal(outgoing.raw.sent.length, 1, 'the rejected broadcast must not reach the network');
			assert.equal(incoming.raw.readyState, 3);
			assert.equal(outgoing.raw.readyState, 3);
		});
	}
});

test('idle sockets close at expiry without any HTTP request or websocket traffic', async (t) => {
	const f = fixture(t, 1000);
	const session = await f.sessions.login('alice', PASSWORD);
	assert.ok(session);
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
	const raw = new FakeSocket();
	const guarded = new SessionSocket(raw, f.sessions, session);
	f.addCleanup(() => guarded.close());
	f.setNow(session.expiresAt - 1);
	t.mock.timers.tick(999);
	assert.equal(raw.readyState, 1);
	f.setNow(session.expiresAt);
	t.mock.timers.tick(1);
	assert.equal(raw.readyState, 3);
	assert.equal(f.sessions.verify(session.token), null);
});

test('30-day expiry is split into safe Node timeout intervals', async (t) => {
	const f = fixture(t, sessionTtlMs('30'));
	const session = await f.sessions.login('alice', PASSWORD);
	assert.ok(session);
	// Leave the 30-second interval real/unref'ed so this does not simulate 86,400 polls.
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const validate = t.mock.method(f.sessions, 'validateId');
	const raw = new FakeSocket();
	const guarded = new SessionSocket(raw, f.sessions, session);
	f.addCleanup(() => guarded.close());
	f.setNow(START + 2_147_483_647);
	t.mock.timers.tick(2_147_483_647);
	assert.equal(validate.mock.callCount(), 1);
	assert.equal(raw.readyState, 1);
	f.setNow(session.expiresAt);
	t.mock.timers.tick(f.sessions.ttlMs - 2_147_483_647);
	assert.equal(raw.readyState, 3);
});

test('idle sockets detect account changes and revocations from another store within the recheck interval', async (t) => {
	for (const reason of ['removed', 'reset', 'external logout', 'external CLI']) {
		await t.test(reason, async (t) => {
			const f = fixture(t);
			const session = await f.sessions.login('alice', PASSWORD);
			assert.ok(session);
			t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
			const raw = new FakeSocket();
			const guarded = new SessionSocket(raw, f.sessions, session);
			f.addCleanup(() => guarded.close());
			if (reason === 'removed') f.users.delete('alice');
			if (reason === 'reset') f.users.set('alice', RESET_HASH);
			if (reason === 'external logout') new SessionStore(f.db, f.options).revoke(session.token);
			if (reason === 'external CLI') new SessionStore(f.db, f.options).revokeUser('alice');
			f.setNow(START + SESSION_RECHECK_MS - 1);
			t.mock.timers.tick(SESSION_RECHECK_MS - 1);
			assert.equal(raw.readyState, 1);
			f.setNow(START + SESSION_RECHECK_MS);
			t.mock.timers.tick(1);
			assert.equal(raw.readyState, 3);
		});
	}
});

test('socket validation failures close safely, and normal closure cancels monitors', async (t) => {
	const f = fixture(t);
	const first = await fakeConnection(f);
	t.mock.method(f.sessions, 'validateId', () => { throw new Error('test-only database failure'); });
	assert.doesNotThrow(() => first.raw.emit('message', new Uint8Array([1])));
	assert.equal(first.raw.readyState, 3);
	assert.doesNotThrow(() => first.guarded.close());
	assert.doesNotThrow(() => f.sessions.revoke(first.session.token));
});

type Setup = Parameters<typeof attachYjsServer>[2];

async function httpFixture(t: TestContext, setup?: Setup, secure = false) {
	const f = fixture(t);
	const app = express();
	app.use('/api', createAuthRouter(f.sessions, secure));
	const server = http.createServer(app);
	const connections: { socket: SessionSocket; docName: string; gc: false }[] = [];
	const wss = attachYjsServer(server, f.sessions, (socket, req, options) => {
		connections.push({ socket, ...options });
		setup?.(socket, req, options);
	});
	const clients = new Set<WebSocket>();
	f.addCleanup(async () => {
		for (const client of clients) client.terminate();
		for (const client of wss.clients) client.terminate();
		server.closeAllConnections();
		await new Promise<void>((resolve) => wss.close(() => resolve()));
		await new Promise<void>((resolve) => server.close(() => resolve()));
	});
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	const address = server.address();
	assert.ok(address && typeof address !== 'string');
	const base = `127.0.0.1:${address.port}`;
	const request = (path: string, method = 'GET', cookieHeader?: string, body?: unknown) => fetch(`http://${base}${path}`, {
		method,
		headers: { ...(cookieHeader ? { Cookie: cookieHeader } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
		body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
		signal: AbortSignal.timeout(5000)
	});
	const makeClient = (path: string, cookieHeader?: string) => {
		const client = new WebSocket(`ws://${base}${path}`, { headers: cookieHeader ? { Cookie: cookieHeader } : {}, handshakeTimeout: 5000 });
		clients.add(client);
		client.once('close', () => clients.delete(client));
		// Expected rejection/teardown may also emit an error after the observed response.
		client.on('error', () => {});
		return client;
	};
	const connect = async (path: string, cookieHeader: string) => {
		const client = makeClient(path, cookieHeader);
		await once(client, 'open');
		return client;
	};
	const upgradeStatus = (path: string, cookieHeader?: string) => new Promise<number>((resolve, reject) => {
		const client = makeClient(path, cookieHeader);
		client.once('open', () => { client.close(); resolve(101); });
		client.once('unexpected-response', (_req: unknown, response: http.IncomingMessage) => {
			response.resume();
			resolve(response.statusCode ?? 0);
			client.terminate();
		});
		client.once('error', reject);
	});
	const login = async (username = 'alice', previousCookie?: string) => {
		const response = await request('/api/login', 'POST', previousCookie, { username, password: PASSWORD });
		assert.equal(response.status, 200);
		const header = response.headers.get('set-cookie');
		assert.ok(header);
		await response.json();
		return { header, cookie: header.split(';', 1)[0] };
	};
	return { ...f, wss, connections, request, makeClient, connect, upgradeStatus, login };
}

test('real HTTP routes validate credentials, cookie attributes, tampering, and expiry', { timeout: 10_000 }, async (t) => {
	const f = await httpFixture(t, undefined, true);
	for (const body of [{}, { username: [], password: PASSWORD }, { username: 'alice', password: {} },
		{ username: 'alice/bob', password: PASSWORD }, { username: 'alice', password: 'a'.repeat(73) }]) {
		assert.equal((await f.request('/api/login', 'POST', undefined, body)).status, 400);
	}
	assert.equal((await f.request('/api/login', 'POST', undefined, { username: 'alice', password: 'wrong' })).status, 401);
	const login = await f.login();
	for (const attribute of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/', 'Max-Age=60']) {
		assert.ok(login.header.includes(attribute), attribute);
	}
	const response = await f.request('/api/session', 'GET', login.cookie);
	assert.equal(response.status, 200);
	assert.equal(response.headers.get('cache-control'), 'no-store');
	assert.deepEqual(await response.json(), { username: 'alice' });
	for (const invalid of [undefined, cookie(cookieSignature.sign('alice', SECRET)), cookie('j:{"username":"alice"}'),
		`${login.cookie}x`, `${COOKIE_NAME}=%ZZ`, `${login.cookie}; ${login.cookie}`]) {
		assert.equal((await f.request('/api/session', 'GET', invalid)).status, 401);
		assert.equal(await f.upgradeStatus('/yjs/pnl-alice', invalid), 401);
	}
	f.setNow(START + 60_000);
	assert.equal((await f.request('/api/session', 'GET', login.cookie)).status, 401);
	assert.equal(await f.upgradeStatus('/yjs/pnl-alice', login.cookie), 401);
});

test('malformed JSON and backend errors never expose credentials in responses or logs', { timeout: 10_000 }, async (t) => {
	const f = await httpFixture(t);
	const log = t.mock.method(console, 'error', () => {});
	const sensitive = 'test-only-sensitive-value';
	const malformed = await f.request('/api/login', 'POST', undefined, `{"username":"alice","password":"${sensitive}"`);
	assert.equal(malformed.status, 400);
	assert.deepEqual(await malformed.json(), { error: 'Invalid request' });
	t.mock.method(f.sessions, 'verify', () => { throw new Error(sensitive); });
	const unavailable = await f.request('/api/session');
	assert.equal(unavailable.status, 503);
	assert.deepEqual(await unavailable.json(), { error: 'Authentication unavailable' });
	assert.equal(await f.upgradeStatus('/yjs/pnl-alice'), 503);
	assert.equal(log.mock.callCount(), 0);
});

test('live upgrades enforce ownership and pass explicit canonical names with gc:false', { timeout: 10_000 }, async (t) => {
	const f = await httpFixture(t);
	const alice = await f.login();
	const bob = await f.login('bob');
	assert.equal(await f.upgradeStatus('/yjs/pnl-bob', alice.cookie), 403);
	assert.equal(await f.upgradeStatus('/yjs/pnl-alice', bob.cookie), 403);
	for (const path of ['/yjsx/pnl-alice', '/yjs/pnl-alice/extra', '/yjs/pnl-%61lice', '/pnl-alice']) {
		assert.equal(await f.upgradeStatus(path, alice.cookie), 403);
	}
	assert.equal(f.connections.length, 0);
	await f.connect('/yjs/pnl-alice?client=one', alice.cookie);
	await f.connect('/yjs/pnl-alice?client=two', alice.cookie);
	await f.connect('/yjs/pnl-bob', bob.cookie);
	assert.deepEqual(f.connections.map(({ docName, gc }) => ({ docName, gc })), [
		{ docName: 'yjs/pnl-alice', gc: false }, { docName: 'yjs/pnl-alice', gc: false }, { docName: 'yjs/pnl-bob', gc: false }
	]);
});

test('HTTP logout closes associated live sockets and permanently rejects cookie replay', { timeout: 10_000 }, async (t) => {
	const f = await httpFixture(t);
	const first = await f.login();
	const otherDevice = await f.login();
	const a = await f.connect('/yjs/pnl-alice', first.cookie);
	const b = await f.connect('/yjs/pnl-alice', first.cookie);
	const other = await f.connect('/yjs/pnl-alice', otherDevice.cookie);
	const closed = Promise.all([once(a, 'close'), once(b, 'close')]);
	const logout = await f.request('/api/logout', 'POST', first.cookie);
	assert.equal(logout.status, 200);
	assert.match(logout.headers.get('set-cookie') ?? '', /Expires=Thu, 01 Jan 1970/);
	await closed;
	assert.equal(other.readyState, WebSocket.OPEN);
	assert.equal((await f.request('/api/session', 'GET', first.cookie)).status, 401);
	assert.equal(await f.upgradeStatus('/yjs/pnl-alice', first.cookie), 401);
	assert.equal((await f.request('/api/session', 'GET', otherDevice.cookie)).status, 200);
	assert.equal((await f.request('/api/logout', 'POST', first.cookie)).status, 200);
});

test('login rotates an existing browser session and closes its old websocket', { timeout: 10_000 }, async (t) => {
	const f = await httpFixture(t);
	const first = await f.login();
	const client = await f.connect('/yjs/pnl-alice', first.cookie);
	const closed = once(client, 'close');
	const replacement = await f.login('bob', first.cookie);
	await closed;
	assert.notEqual(first.cookie, replacement.cookie);
	assert.equal((await f.request('/api/session', 'GET', first.cookie)).status, 401);
	assert.deepEqual(await (await f.request('/api/session', 'GET', replacement.cookie)).json(), { username: 'bob' });
});

test('HTTP and live upgrade checks reject removed/reset users and permit a fresh password login', { timeout: 10_000 }, async (t) => {
	const f = await httpFixture(t);
	const alice = await f.login();
	const bob = await f.login('bob');
	f.users.delete('alice');
	f.users.set('bob', RESET_HASH);
	for (const [name, login] of [['alice', alice], ['bob', bob]] as const) {
		assert.equal((await f.request('/api/session', 'GET', login.cookie)).status, 401);
		assert.equal(await f.upgradeStatus(`/yjs/pnl-${name}`, login.cookie), 401);
	}
	assert.equal((await f.request('/api/login', 'POST', undefined, { username: 'bob', password: PASSWORD })).status, 401);
	assert.equal((await f.request('/api/login', 'POST', undefined, { username: 'bob', password: 'reset password' })).status, 200);
});

test('revocation during the upgrade handshake cannot reach Yjs setup or send document data', { timeout: 10_000 }, async (t) => {
	const f = await httpFixture(t);
	const login = await f.login();
	f.wss.once('headers', () => f.sessions.revoke(readSessionCookie(login.cookie)));
	const client = f.makeClient('/yjs/pnl-alice', login.cookie);
	let messages = 0;
	client.on('message', () => { messages++; });
	await once(client, 'close');
	assert.equal(f.connections.length, 0);
	assert.equal(messages, 0);
});

test('real y-websocket preserves snapshots for a fresh document and blocks revoked Yjs updates', { timeout: 10_000 }, async (t) => {
	// The upstream utility reads these at import time. Disable optional disk/network hooks
	// before loading it so even an inherited deployment environment cannot touch real data.
	delete process.env.YPERSISTENCE;
	delete process.env.CALLBACK_URL;
	delete process.env.CALLBACK_OBJECTS;
	const require = createRequire(import.meta.url);
	const Y: typeof import('yjs') = require('yjs');
	const { setupWSConnection, docs } = require('y-websocket/bin/utils');
	const encoding = require('lib0/encoding');
	const syncProtocol = require('y-protocols/sync');
	const f = await httpFixture(t, setupWSConnection);
	t.after(() => {
		for (const doc of docs.values()) doc.destroy();
		docs.clear();
	});
	const login = await f.login();
	const client = await f.connect('/yjs/pnl-alice?client=snapshot', login.cookie);
	const doc = docs.get('yjs/pnl-alice');
	assert.ok(doc);
	assert.equal(doc.name, 'yjs/pnl-alice');
	assert.equal(doc.gc, false);
	assert.equal(docs.has('pnl-alice'), false);
	doc.getArray('items').push(['historical item']);
	const snapshot = Y.snapshot(doc);
	doc.getArray('items').delete(0, 1);
	const fresh = new Y.Doc({ gc: false });
	Y.applyUpdate(fresh, Y.encodeStateAsUpdate(doc));
	const historical = Y.createDocFromSnapshot(fresh, snapshot);
	assert.deepEqual(historical.getArray('items').toArray(), ['historical item']);
	historical.destroy();
	fresh.destroy();

	const attacker = new Y.Doc({ gc: false });
	attacker.getArray('items').push(['must not be accepted']);
	const encoder = encoding.createEncoder();
	encoding.writeVarUint(encoder, 0);
	syncProtocol.writeUpdate(encoder, Y.encodeStateAsUpdate(attacker));
	attacker.destroy();
	f.users.set('alice', RESET_HASH);
	const closed = once(client, 'close');
	client.send(encoding.toUint8Array(encoder));
	await closed;
	assert.deepEqual(doc.getArray('items').toArray(), []);
	assert.equal(doc.conns.size, 0);
});
