import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);

// Test the next commit, not the working tree: untracked dependencies must not
// make a broken release pass. This also works in a clean checkout of a commit.
function stagedFile(name) {
	return execFileSync('git', ['show', `:${name}`], { cwd: root, encoding: 'utf8' });
}

function releaseFiles() {
	const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
		.split('\0').filter(Boolean);
	const tracked = new Set(files);
	const dependencies = new Set(files.filter(name => name.startsWith('server/') && name.endsWith('.ts')));
	for (const file of dependencies) {
		for (const match of stagedFile(file).matchAll(/\bfrom\s+['"](\.[^'"]+)['"]/g)) {
			const dependency = path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1]));
			assert.ok(tracked.has(dependency), `${file} imports ${dependency}, but it is missing from Git. Stage and commit it with the server.`);
			dependencies.add(dependency);
		}
	}
	return [...dependencies];
}

test('Git release contains every relative server import', () => {
	releaseFiles();
});

test('actual server entry point boots from Git release files and answers session requests', { timeout: 20_000 }, async (t) => {
	const directory = await mkdtemp(path.join(tmpdir(), 'pnl-release-startup-'));
	t.after(() => rm(directory, { recursive: true, force: true }));
	await mkdir(path.join(directory, 'server'));
	await mkdir(path.join(directory, 'build'));
	await writeFile(path.join(directory, 'build/index.html'), '<!doctype html><title>Isolated release test</title>');
	await writeFile(path.join(directory, 'package.json'), stagedFile('package.json'));
	const files = releaseFiles();
	for (const file of files) {
		await mkdir(path.dirname(path.join(directory, file)), { recursive: true });
		await writeFile(path.join(directory, file), stagedFile(file));
	}
	await symlink(path.join(root, 'node_modules'), path.join(directory, 'node_modules'), 'dir');

	// The real entry point writes a database beside itself. Only these copied
	// release files are executed, so that database is disposable. Never inherit
	// production persistence/callback hooks, credentials, or Node preload hooks.
	const env = { ...process.env };
	for (const key of Object.keys(env)) {
		if (/^(SESSION_|CALLBACK_)/.test(key) || ['YPERSISTENCE', 'GC', 'NODE_OPTIONS', 'NODE_PATH'].includes(key)) delete env[key];
	}
	const entry = pathToFileURL(path.join(directory, 'server/index.ts')).href;
	const wrapper = `
		import net from 'node:net';
		const listen = net.Server.prototype.listen;
		net.Server.prototype.listen = function () {
			this.once('listening', () => process.send({ port: this.address().port }));
			return listen.call(this, 0, '127.0.0.1');
		};
		await import(${JSON.stringify(entry)});
	`;
	const child = spawn(process.execPath, [
		'--import', pathToFileURL(require.resolve('tsx')).href,
		'--input-type=module', '--eval', wrapper
	], { cwd: directory, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
	let output = '';
	child.stdout.on('data', (chunk) => { output += chunk; });
	child.stderr.on('data', (chunk) => { output += chunk; });
	t.after(async () => {
		if (child.exitCode === null && child.signalCode === null) {
			const exited = once(child, 'exit');
			child.kill('SIGKILL');
			await exited;
		}
	});
	const port = await new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`Server startup timed out:\n${output}`)), 10_000);
		child.once('message', (message) => { clearTimeout(timer); resolve(message.port); });
		child.once('error', (error) => { clearTimeout(timer); reject(error); });
		child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Server exited before listening (${code}):\n${output}`)); });
	});
	assert.equal(typeof port, 'number');
	const response = await fetch(`http://127.0.0.1:${port}/api/session`, { signal: AbortSignal.timeout(5000) });
	assert.equal(response.status, 401, 'An unauthenticated request must receive HTTP 401, not a refused connection');
	assert.deepEqual(await response.json(), { error: 'Invalid session' });
	const home = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(5000) });
	assert.equal(home.status, 200);
	assert.match(await home.text(), /Isolated release test/);
});
