#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';
import { Writable } from 'node:stream';
import bcrypt from 'bcryptjs';
import { isValidPassword, isValidUsername } from './auth.ts';
import { LocalStorage } from './local-storage.ts';
import { loginUpstream, normalizeUpstream, UpstreamSync } from './local-sync.ts';
import { createLocalHost } from './local-server.ts';

const help = `Lists & Prices local client (Node 24+)

First run:
  lists-local-client --server https://your-server --username your-name
Later runs, including offline:
  lists-local-client

Paths are relative to the directory you run the command from.
  --data-dir PATH       Local files (default ./lists-local-data)
  --export-yjs          Export local document data and exit (stop the client first)
  --output PATH         Export destination (default DATA-DIR/document.yjs)
  --server URL          Upstream URL, including any /lists prefix
  --username NAME       Upstream account; one account per data directory
  --login               Renew the upstream session (prompts for password)
  --password-file PATH  Read password from a private file instead of prompting
  --insecure           Skip upstream HTTPS/WSS certificate verification
  --host ADDRESS        Listen address (default 127.0.0.1; use 0.0.0.0 for LAN)
  --port NUMBER         Listen port (default 8081)
  --cert PATH --key PATH  Trusted TLS certificate and private key for LAN access
  --build-dir PATH      Frontend files (default this checkout's build/)
  --no-serve            Sync only, without serving browsers
  --interval SECONDS    Upstream confirmation interval (default 5)
  --help               Show this help

Use Ctrl-C to stop. No background service or system installation is created.
`;

function passwordPrompt(): Promise<string> {
	if (!process.stdin.isTTY) throw new Error('Use an interactive terminal or --password-file to sign in.');
	return new Promise((resolve, reject) => {
		let muted = false;
		const output = new Writable({ write(chunk, _encoding, done) { if (!muted) process.stdout.write(chunk); done(); } });
		const prompt = readline.createInterface({ input: process.stdin, output, terminal: true });
		prompt.once('SIGINT', () => { prompt.close(); output.end(); reject(new Error('Sign-in cancelled.')); });
		prompt.question('Upstream password (also used for local browser login): ', answer => {
			prompt.close(); output.end(); process.stdout.write('\n'); resolve(answer);
		});
		muted = true;
	});
}

async function main() {
	const { values } = parseArgs({ options: {
		'data-dir': { type: 'string' }, server: { type: 'string' }, username: { type: 'string' },
		'export-yjs': { type: 'boolean' }, output: { type: 'string' },
		login: { type: 'boolean' }, 'password-file': { type: 'string' }, insecure: { type: 'boolean' }, host: { type: 'string' },
		port: { type: 'string' }, cert: { type: 'string' }, key: { type: 'string' },
		'build-dir': { type: 'string' }, 'no-serve': { type: 'boolean' }, interval: { type: 'string' }, help: { type: 'boolean' }
	} });
	if (values.help) { console.log(help); return; }
	if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Use Node 24 or newer.');
	if (values.output && !values['export-yjs']) throw new Error('--output requires --export-yjs.');
	const dataDirectory = path.resolve(values['data-dir'] ?? 'lists-local-data');
	process.umask(0o077);
	if (values['export-yjs']) {
		if (!existsSync(path.join(dataDirectory, 'yjs.sqlite'))) throw new Error(`No local database in ${dataDirectory}. Choose an existing --data-dir to export.`);
		const storage = new LocalStorage(dataDirectory);
		try { console.log(`Exported local document to ${storage.exportSnapshot(values.output && path.resolve(values.output))}`); }
		finally { storage.close(); }
		return;
	}
	const port = Number(values.port ?? 8081), interval = Number(values.interval ?? 5);
	if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Port must be between 0 and 65535.');
	if (!Number.isFinite(interval) || interval < 1 || interval > 3600) throw new Error('Interval must be between 1 and 3600 seconds.');
	if (Boolean(values.cert) !== Boolean(values.key)) throw new Error('Supply both --cert and --key.');
	const buildDirectory = values['no-serve'] ? undefined : path.resolve(values['build-dir'] ?? fileURLToPath(new URL('../build', import.meta.url)));
	if (buildDirectory && !existsSync(path.join(buildDirectory, 'index.html'))) throw new Error('Frontend missing. Run npm run build, supply --build-dir, or use --no-serve.');
	const storage = new LocalStorage(dataDirectory);
	let host: ReturnType<typeof createLocalHost> | undefined;
	let upstream: UpstreamSync | undefined;
	let closing: Promise<void> | undefined;
	const close = () => closing ??= (async () => {
		try { await upstream?.close(); await host?.close(); }
		finally { storage.close(); }
	})();
	try {
		const configuredServer = values.server ?? storage.get('server');
		if (!configuredServer) throw new Error('Supply --server and --username on the first run.');
		const server = normalizeUpstream(configuredServer);
		const username = values.username ?? storage.get('username');
		if (!isValidUsername(username)) throw new Error('Supply --username on the first run.');
		if ((storage.get('username') && storage.get('username') !== username) || (storage.get('server') && storage.get('server') !== server)) {
			throw new Error('This directory belongs to another server/account. Choose another --data-dir.');
		}
		let cookie = storage.get('upstreamCookie');
		if (values.login || values['password-file'] || !cookie) {
			const password = values['password-file'] ? readFileSync(values['password-file'], 'utf8').replace(/\r?\n$/, '') : await passwordPrompt();
			if (!isValidPassword(password)) throw new Error('Password must be 1–72 UTF-8 bytes.');
			cookie = await loginUpstream(server, username, password, values.insecure);
			const existingHash = storage.get('passwordHash');
			const hash = existingHash && await bcrypt.compare(password, existingHash) ? existingHash : await bcrypt.hash(password, 10);
			storage.db.transaction(() => {
				storage.set('username', username); storage.set('server', server);
				storage.set('upstreamCookie', cookie!); storage.set('passwordHash', hash);
			})();
		}
		host = createLocalHost({ storage, username, buildDirectory,
			cert: values.cert && path.resolve(values.cert), key: values.key && path.resolve(values.key),
			status: () => upstream!.status,
			onStorageError: () => {
				console.error('Local disk write failed. Stopping; browser caches retain unconfirmed edits.');
				process.exitCode = 1; void close().catch(() => {});
			}
		});
		let lastStatus = '';
		upstream = new UpstreamSync({ server, username, cookie, doc: host.doc, storage, insecure: values.insecure, intervalMs: interval * 1000,
			onStatus() {
				const state = upstream!.status;
				const label = state.error ?? (state.pending ? 'Changes waiting for upstream confirmation.' : 'Upstream confirmed.');
				if (label !== lastStatus) { console.log(label); lastStatus = label; }
			}
		});
		if (!values['no-serve']) {
			await new Promise<void>((resolve, reject) => {
				host!.server.once('error', reject);
				host!.server.listen(port, values.host ?? '127.0.0.1', () => { host!.server.off('error', reject); resolve(); });
			});
			const address = host.server.address() as { port: number };
			console.log(`Local frontend: ${values.cert ? 'https' : 'http'}://${values.host ?? '127.0.0.1'}:${address.port}`);
			if (!values.cert && !['127.0.0.1', 'localhost', '::1'].includes(values.host ?? '127.0.0.1')) {
				console.log('LAN browsers need trusted HTTPS for the full app. Supply --cert and --key or use an HTTPS proxy.');
			}
		}
		const stop = () => { void close().catch(() => { console.error('Shutdown failed; retain the data directory for recovery.'); process.exitCode = 1; }); };
		process.once('SIGINT', stop); process.once('SIGTERM', stop);
		upstream.start();
		console.log(`Data directory: ${storage.directory}\nUpstream: ${server} (${username})\nRunning in foreground; Ctrl-C stops the client.`);
	} catch (error) { await close(); throw error; }
}

main().catch(error => { console.error(error instanceof Error ? error.message : 'Local client failed.'); process.exitCode = 1; });
