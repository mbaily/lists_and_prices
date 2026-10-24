import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import bcrypt from 'bcryptjs';
import { resolveStoragePaths } from '../server/storage-paths.ts';
import { backupUserData, captureServiceStorage } from '../scripts/backup-user-data.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const { LeveldbPersistence } = require('y-leveldb');
const Y = require('yjs');

test('shared data root and explicit overrides resolve independently of the server module', () => {
	const paths = resolveStoragePaths({ LISTS_DATA_DIR: '../user data' }, '/app/server', '/app/code');
	assert.equal(paths.dbFile, '/app/user data/server.db');
	assert.equal(paths.yjsDirectory, '/app/user data/yjs-data');
	assert.equal(paths.taskTokensFile, '/app/user data/task-tokens.json');
	assert.equal(paths.htpasswdFile, '/app/server/.htpasswd');
	const overrides = resolveStoragePaths({ LISTS_DATA_DIR: '/state', LISTS_DB_PATH: '/sqlite/custom.db',
		YPERSISTENCE: '../level', LISTS_TASK_TOKENS_PATH: '/integrations/tokens.json' }, '/app/server', '/app/code');
	assert.equal(overrides.dbFile, '/sqlite/custom.db');
	assert.equal(overrides.yjsDirectory, '/app/level');
	assert.equal(overrides.taskTokensFile, '/integrations/tokens.json');
	const legacy = resolveStoragePaths({}, '/app/server', '/unrelated');
	assert.equal(legacy.dbFile, '/app/server/server.db');
	assert.equal(legacy.taskTokensFile, '/app/server/task-tokens.json');
	assert.equal(legacy.yjsDirectory, undefined, 'No implicit change to legacy in-memory mode');
	for (const key of ['LISTS_DATA_DIR', 'LISTS_DB_PATH', 'LISTS_TASK_TOKENS_PATH', 'YPERSISTENCE']) {
		assert.throws(() => resolveStoragePaths({ [key]: ' ' }), /nonempty/);
	}
	assert.throws(() => resolveStoragePaths({ LISTS_DB_PATH: '/app/server/.htpasswd' }, '/app/server'), /separate/);
	assert.throws(() => resolveStoragePaths({ YPERSISTENCE: '/app/server' }, '/app/server'), /must not contain/);
});

function fixture(t: TestContext) {
	const directory = fs.mkdtempSync(path.join(tmpdir(), 'lists storage '));
	const app = path.join(directory, 'app'), data = path.join(directory, 'user data');
	fs.mkdirSync(path.join(app, 'server'), { recursive: true });
	fs.mkdirSync(path.join(app, 'build'));
	fs.mkdirSync(path.join(app, 'src/lib'), { recursive: true });
	fs.writeFileSync(path.join(app, 'package.json'), '{"type":"module"}');
	fs.writeFileSync(path.join(app, 'build/index.html'), '<!doctype html><title>Storage fixture</title>');
	for (const file of fs.readdirSync(path.join(root, 'server')).filter(file => file.endsWith('.ts'))) {
		fs.copyFileSync(path.join(root, 'server', file), path.join(app, 'server', file));
	}
	for (const file of ['folderDefaultItems.ts', 'syncProtocol.ts']) {
		fs.copyFileSync(path.join(root, 'src/lib', file), path.join(app, 'src/lib', file));
	}
	fs.symlinkSync(path.join(root, 'node_modules'), path.join(app, 'node_modules'), 'dir');
	fs.writeFileSync(path.join(app, 'server/.htpasswd'), 'alice:' + bcrypt.hashSync('test-only', 4) + '\n');
	const env = { ...process.env };
	for (const key of Object.keys(env)) {
		if (/^(LISTS_|SESSION_|CALLBACK_)/.test(key) || ['YPERSISTENCE', 'GC', 'NODE_OPTIONS', 'NODE_PATH'].includes(key)) delete env[key];
	}
	Object.assign(env, { LISTS_DATA_DIR: data, LISTS_TLS: 'off', LISTS_HOST: '127.0.0.1' });
	t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
	return { directory, app, data, env, paths: resolveStoragePaths(env, path.join(app, 'server'), directory) };
}

async function startServer(t: TestContext, f: ReturnType<typeof fixture>) {
	const entry = pathToFileURL(path.join(f.app, 'server/index.ts')).href;
	const wrapper = `import net from 'node:net';
const listen=net.Server.prototype.listen;
net.Server.prototype.listen=function(){this.once('listening',()=>process.send({port:this.address().port}));return listen.call(this,0,'127.0.0.1');};
await import(${JSON.stringify(entry)});`;
	const child = spawn(process.execPath, ['--import', pathToFileURL(require.resolve('tsx')).href,
		'--input-type=module', '--eval', wrapper], { cwd: f.directory, env: f.env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
	let logs = '';
	child.stdout!.on('data', data => { logs += data; }); child.stderr!.on('data', data => { logs += data; });
	const stop = async () => {
		if (child.exitCode === null && child.signalCode === null) {
			const exit = once(child, 'exit'); child.kill('SIGTERM'); await exit;
		}
	};
	t.after(stop);
	const port = await new Promise<number>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('Startup timeout: ' + logs)), 10_000);
		child.once('message', message => { clearTimeout(timer); resolve((message as { port: number }).port); });
		child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited ${code}: ${logs}`)); });
		child.once('error', error => { clearTimeout(timer); reject(error); });
	});
	return { stop, url: `http://127.0.0.1:${port}` };
}

test('real server and token CLI share external SQLite, Yjs and mutable token bindings across restart', { timeout: 30_000 }, async t => {
	const f = fixture(t);
	const legacy = path.join(f.app, 'server/server.db');
	fs.writeFileSync(legacy, 'decoy legacy data must never be opened');
	const first = await startServer(t, f);
	const login = await fetch(first.url + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ username: 'alice', password: 'test-only' }) });
	assert.equal(login.status, 200);
	const cookie = login.headers.get('set-cookie')!.split(';')[0];
	const output = path.join(f.data, 'client-token');
	execFileSync(process.execPath, ['--import', require.resolve('tsx'), path.join(f.app, 'server/task-token.ts'),
		'--user', 'alice', '--from-photos', '--output', output], { cwd: f.directory, env: f.env });
	const token = fs.readFileSync(output, 'utf8').trim();
	const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
	const destination = await fetch(first.url + '/api/tasks/destination', { method: 'POST', headers, body: '{}' });
	assert.equal(destination.status, 200);
	const { list } = await destination.json();
	const imported = await fetch(first.url + '/api/tasks/import', { method: 'POST', headers,
		body: JSON.stringify({ listId: list.id, tasks: ['Persisted external task'] }) });
	assert.equal(imported.status, 200);
	assert.deepEqual(JSON.parse(fs.readFileSync(f.paths.taskTokensFile, 'utf8')).tokens[0].listIds, [list.id]);
	await assert.rejects(backupUserData(f.paths, path.join(f.directory, 'live-backup')), /Cannot lock Yjs/);
	await first.stop();
	const second = await startServer(t, f);
	assert.equal((await fetch(second.url + '/api/session', { headers: { Cookie: cookie } })).status, 200,
		'SQLite session and signing secret survive restart');
	const lists = await fetch(second.url + '/api/tasks/lists', { headers });
	assert.equal(lists.status, 200); assert.ok((await lists.json()).lists.some((item: { id: string }) => item.id === list.id));
	await second.stop();
	const provider = new LeveldbPersistence(f.paths.yjsDirectory);
	try {
		const doc = await provider.getYDoc('yjs/pnl-alice');
		assert.ok(doc.getArray('items').toArray().some((item: { get(key: string): unknown }) => item.get('name') === 'Persisted external task'));
		doc.destroy();
	} finally { await provider.destroy(); }
	assert.equal(fs.readFileSync(legacy, 'utf8'), 'decoy legacy data must never be opened');
	assert.equal(fs.existsSync(path.join(f.app, 'server/task-tokens.json')), false);
	assert.equal(fs.existsSync(path.join(f.app, 'server/yjs-data')), false);
});

test('user-data backup restores SQLite/WAL, Yjs and token scopes, excludes passwords and refuses overwrite', async t => {
	const f = fixture(t);
	fs.mkdirSync(f.data);
	const sqlite = new Database(f.paths.dbFile);
	t.after(() => sqlite.close());
	sqlite.pragma('journal_mode = WAL'); sqlite.exec('CREATE TABLE records(value TEXT); INSERT INTO records VALUES (\'snapshot\')');
	const provider = new LeveldbPersistence(f.paths.yjsDirectory);
	const doc = new Y.Doc(); doc.getText('note').insert(0, 'leveldb snapshot');
	await provider.storeUpdate('yjs/pnl-alice', Y.encodeStateAsUpdate(doc)); doc.destroy(); await provider.destroy();
	const tokens = { tokens: [{ username: 'alice', tokenHash: 'a'.repeat(64), listIds: ['chosen'], fromPhotos: true }] };
	fs.writeFileSync(f.paths.taskTokensFile, JSON.stringify(tokens));
	fs.writeFileSync(path.join(f.data, '.htpasswd'), 'must not be included');
	fs.writeFileSync(path.join(f.paths.yjsDirectory!, '.htpasswd'), 'also excluded');
	const destination = path.join(f.directory, 'backup');
	await backupUserData(f.paths, destination);
	assert.ok(fs.readdirSync(f.paths.yjsDirectory!).every(name => fs.statSync(path.join(f.paths.yjsDirectory!, name)).uid === fs.statSync(f.paths.yjsDirectory!).uid),
		'Backup lock checking must not leave source files owned by a different user');
	assert.deepEqual(fs.readdirSync(destination).sort(), ['manifest.json', 'server.db', 'task-tokens.json', 'yjs-data']);
	assert.equal(fs.existsSync(path.join(destination, 'yjs-data/.htpasswd')), false);
	assert.equal(fs.statSync(destination).mode & 0o777, 0o700);
	assert.equal(JSON.parse(fs.readFileSync(path.join(destination, 'manifest.json'), 'utf8')).credentialsIncluded, false);
	assert.deepEqual(JSON.parse(fs.readFileSync(path.join(destination, 'task-tokens.json'), 'utf8')), tokens);
	const restored = new Database(path.join(destination, 'server.db'), { readonly: true });
	assert.equal(restored.prepare('SELECT value FROM records').pluck().get(), 'snapshot'); restored.close();
	const restoredYjs = new LeveldbPersistence(path.join(destination, 'yjs-data'));
	try { const saved = await restoredYjs.getYDoc('yjs/pnl-alice'); assert.equal(saved.getText('note').toString(), 'leveldb snapshot'); saved.destroy(); }
	finally { await restoredYjs.destroy(); }
	await assert.rejects(backupUserData(f.paths, destination), /EEXIST/);
	assert.ok(fs.existsSync(path.join(destination, 'manifest.json')), 'Existing backup is never deleted on failure');
	await assert.rejects(backupUserData(f.paths, path.join(f.paths.yjsDirectory!, 'recursive-backup')), /outside/);
});

test('service backup discovers the running process paths rather than the invoking shell configuration', async t => {
	const f = fixture(t);
	const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { cwd: f.directory,
		env: { ...f.env, LISTS_DATA_DIR: 'actual service data', YPERSISTENCE: 'actual service leveldb' }, stdio: 'ignore' });
	t.after(async () => { const exit = once(child, 'exit'); child.kill(); await exit; });
	await once(child, 'spawn');
	const bin = path.join(f.directory, 'bin'); fs.mkdirSync(bin);
	fs.writeFileSync(path.join(bin, 'systemctl'), `#!/bin/sh\nprintf '%s\\n' '${child.pid}'\n`, { mode: 0o755 });
	const previous = process.env.PATH;
	process.env.PATH = bin + path.delimiter + previous;
	try {
		const captured = captureServiceStorage('isolated-fixture.service', path.join(f.app, 'server'));
		assert.equal(captured.dbFile, path.join(f.directory, 'actual service data/server.db'));
		assert.equal(captured.yjsDirectory, path.join(f.directory, 'actual service leveldb'));
		assert.equal(captured.taskTokensFile, path.join(f.directory, 'actual service data/task-tokens.json'));
	} finally { process.env.PATH = previous; }
});

test('standalone backup restarts the service when a data snapshot fails', async t => {
	const f = fixture(t);
	const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { cwd: f.directory, env: f.env, stdio: 'ignore' });
	t.after(async () => { const exit = once(child, 'exit'); child.kill(); await exit; });
	await once(child, 'spawn');
	const bin = path.join(f.directory, 'bin'); fs.mkdirSync(bin);
	const log = path.join(f.directory, 'commands.log');
	fs.writeFileSync(path.join(bin, 'sudo'), '#!/bin/sh\nexec "$@"\n', { mode: 0o755 });
	fs.writeFileSync(path.join(bin, 'systemctl'), `#!/bin/sh
printf '%s\\n' "$*" >> "$BACKUP_TEST_LOG"
if [ "$1" = show ]; then printf '%s\\n' '${child.pid}'; fi
`, { mode: 0o755 });
	const destination = path.join(f.directory, 'failed-backup');
	assert.throws(() => execFileSync('bash', [path.join(root, 'backup.sh'), destination, '--server-dir', path.join(f.app, 'server')], {
		cwd: root, env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH, BACKUP_TEST_LOG: log },
		encoding: 'utf8', timeout: 10_000, stdio: 'pipe'
	}), /User data does not exist/);
	const commands = fs.readFileSync(log, 'utf8');
	assert.match(commands, /stop lists-and-prices.service\nstart lists-and-prices.service/);
	assert.equal(fs.existsSync(destination), false);
});

test('privileged backup opens LevelDB as its non-root owner', {
	skip: process.getuid?.() !== 0 || !process.env.SUDO_UID || process.env.SUDO_UID === '0'
}, async t => {
	const f = fixture(t);
	const uid = Number(process.env.SUDO_UID), gid = Number(process.env.SUDO_GID);
	for (const directory of [f.directory, f.app, path.join(f.app, 'server')]) fs.chmodSync(directory, 0o755);
	fs.chmodSync(path.join(f.app, 'package.json'), 0o644);
	fs.mkdirSync(f.data, { mode: 0o700 }); fs.chownSync(f.data, uid, gid);
	fs.mkdirSync(f.paths.yjsDirectory!, { mode: 0o700 }); fs.chownSync(f.paths.yjsDirectory!, uid, gid);
	const sqlite = new Database(f.paths.dbFile); sqlite.exec('CREATE TABLE records(value TEXT)'); sqlite.close();
	const code = `const {createRequire}=require('node:module');const level=createRequire(process.argv[1])('leveldown')(process.argv[2]);
level.open(error=>{if(error)throw error;level.close(error=>{if(error)throw error;});});`;
	execFileSync(process.execPath, ['-e', code, path.join(f.app, 'package.json'), f.paths.yjsDirectory!], { uid, gid, cwd: '/' });
	await backupUserData(f.paths, path.join(f.directory, 'privileged-backup'));
	assert.ok(fs.readdirSync(f.paths.yjsDirectory!).every(name => fs.statSync(path.join(f.paths.yjsDirectory!, name)).uid === uid));
	// The service/data owner can reopen the store after the root-run snapshot.
	execFileSync(process.execPath, ['-e', code, path.join(f.app, 'package.json'), f.paths.yjsDirectory!], { uid, gid, cwd: '/' });
});
