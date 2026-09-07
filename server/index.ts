#!/usr/bin/env node
/**
 * Lists & Prices — Node.js server
 *
 * Serves the built SvelteKit SPA, handles auth, and runs y-websocket.
 *
 * CLI flags:
 *   --port <n>           HTTP/S port (default 8080)
 *   --create-cert        Generate self-signed TLS cert and exit
 *   --add-user           Add/update a user in .htpasswd (prompts for credentials)
 *   --remove-user        Remove a user from .htpasswd (prompts for username)
 */

import https from 'node:https';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';

import express from 'express';
import { setupWSConnection } from 'y-websocket/bin/utils';
import forge from 'node-forge';
import bcrypt from 'bcryptjs';
import { SessionStore, isValidUsername, isValidPassword, readHtpasswdHash, sessionTtlMs } from './auth.ts';
import { createAuthRouter } from './auth-http.ts';
import { attachYjsServer } from './auth-websocket.ts';

// better-sqlite3 is a CJS module; use createRequire to import it from ESM.
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUILD_DIR = path.join(__dirname, '../build');
const CERT_FILE = path.join(__dirname, 'cert.pem');
const KEY_FILE = path.join(__dirname, 'key.pem');
const HTPASSWD_FILE = path.join(__dirname, '.htpasswd');
const DB_FILE = path.join(__dirname, 'server.db');

// ── SQLite ──────────────────────────────────────────────────────────────
// One DB for the persistent session secret and revocable, expiring sessions.
const db = new Database(DB_FILE) as import('better-sqlite3').Database;
db.exec(`
  CREATE TABLE IF NOT EXISTS kv (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

function kvGet(key: string): string | undefined {
	return (db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined)?.value;
}
function kvSet(key: string, value: string) {
	db.prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)').run(key, value);
}

// Persist the session secret across restarts.
// On first start a new random secret is generated and saved.
function getOrCreateSecret(): string {
	const existing = kvGet('session_secret');
	if (existing) return existing;
	const fresh = Buffer.from(forge.random.getBytesSync(32), 'binary').toString('hex');
	kvSet('session_secret', fresh);
	return fresh;
}

const SESSION_SECRET = process.env.SESSION_SECRET ?? getOrCreateSecret();
const sessions = new SessionStore(db, {
	secret: SESSION_SECRET,
	ttlMs: sessionTtlMs(process.env.SESSION_EXPIRY_DAYS),
	// Read current credentials on every verification, including established sockets.
	readPasswordHash: (username) => readHtpasswdHash(fs.readFileSync(HTPASSWD_FILE, 'utf-8'), username)
});

// ── Parse CLI args ────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const portArg = args.includes('--port') ? parseInt(args[args.indexOf('--port') + 1], 10) : 8080;

if (args.includes('--create-cert')) {
	await generateCert();
	process.exit(0);
}
if (args.includes('--add-user')) {
	await cliAddUser();
	db.close();
	process.exit(process.exitCode ?? 0);
}
if (args.includes('--remove-user')) {
	await cliRemoveUser();
	db.close();
	process.exit(process.exitCode ?? 0);
}

// ── Self-signed cert generation ───────────────────────────────────────────────
async function generateCert() {
	console.log('Generating self-signed TLS certificate…');
	const keys = forge.pki.rsa.generateKeyPair(2048);
	const cert = forge.pki.createCertificate();
	cert.publicKey = keys.publicKey;
	cert.serialNumber = '01';
	cert.validity.notBefore = new Date();
	cert.validity.notAfter = new Date();
	cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 10);
	const attrs = [{ name: 'commonName', value: 'localhost' }];
	cert.setSubject(attrs);
	cert.setIssuer(attrs);
	cert.sign(keys.privateKey, forge.md.sha256.create());
	fs.writeFileSync(CERT_FILE, forge.pki.certificateToPem(cert));
	fs.writeFileSync(KEY_FILE, forge.pki.privateKeyToPem(keys.privateKey));
	console.log(`Wrote ${CERT_FILE} and ${KEY_FILE}`);
}

// ── .htpasswd management ──────────────────────────────────────────────────────
function prompt(question: string, hideInput = false): Promise<string> {
	return new Promise((resolve) => {
		let muted = false;
		const output = new Writable({
			write(chunk, _encoding, done) {
				if (!muted) process.stdout.write(chunk);
				done();
			}
		});
		const rl = readline.createInterface({
			input: process.stdin, output, terminal: Boolean(process.stdin.isTTY && process.stdout.isTTY)
		});
		rl.question(question, (answer) => {
			rl.close();
			output.end();
			if (hideInput && process.stdin.isTTY) process.stdout.write('\n');
			resolve(answer);
		});
		muted = hideInput;
	});
}

function writeHtpasswd(contents: string): void {
	// Atomic replacement avoids transient empty/partial files revoking unrelated users.
	const exists = fs.existsSync(HTPASSWD_FILE);
	const target = exists ? fs.realpathSync(HTPASSWD_FILE) : HTPASSWD_FILE;
	const mode = exists ? fs.statSync(target).mode & 0o777 : 0o600;
	const temporary = `${target}.${randomUUID()}.tmp`;
	const fd = fs.openSync(temporary, 'wx', 0o600);
	try {
		try {
			fs.writeFileSync(fd, contents);
			fs.fchmodSync(fd, mode);
		} finally {
			fs.closeSync(fd);
		}
		fs.renameSync(temporary, target);
	} finally {
		fs.rmSync(temporary, { force: true });
	}
}

async function cliAddUser() {
	const username = (await prompt('Username: ')).trim();
	if (!isValidUsername(username)) {
		console.error('Username must be 1–128 characters: letters, numbers, or . _ ~ @ + -');
		process.exitCode = 1;
		return;
	}
	const password = await prompt('Password: ', true);
	if (!isValidPassword(password)) {
		console.error('Password must be 1–72 UTF-8 bytes (bcrypt must not truncate it).');
		process.exitCode = 1;
		return;
	}
	const hash = await bcrypt.hash(password, 10);
	let lines: string[] = [];
	if (fs.existsSync(HTPASSWD_FILE)) {
		lines = fs.readFileSync(HTPASSWD_FILE, 'utf-8').split('\n').filter(Boolean);
	}
	// Replace all matching entries so duplicate legacy records cannot remain ambiguous.
	lines = lines.filter((l) => !l.startsWith(username + ':'));
	lines.push(`${username}:${hash}`);
	writeHtpasswd(lines.join('\n') + '\n');
	sessions.revokeUser(username);
	console.log(`User "${username}" added/updated.`);
}

async function cliRemoveUser() {
	const username = (await prompt('Username to remove: ')).trim();
	if (!isValidUsername(username)) {
		console.error('Invalid username.');
		process.exitCode = 1;
		return;
	}
	// Revoke even if the credentials file is already missing.
	sessions.revokeUser(username);
	if (!fs.existsSync(HTPASSWD_FILE)) { console.error('.htpasswd not found.'); process.exitCode = 1; return; }
	const lines = fs.readFileSync(HTPASSWD_FILE, 'utf-8').split('\n').filter(Boolean);
	const filtered = lines.filter((l) => !l.startsWith(username + ':'));
	writeHtpasswd(filtered.join('\n') + (filtered.length ? '\n' : ''));
	// Also catch a login that completed while the CLI was updating the file.
	sessions.revokeUser(username);
	console.log(`User "${username}" removed.`);
}

// ── Express app ───────────────────────────────────────────────────────────────
const useTls = fs.existsSync(CERT_FILE) && fs.existsSync(KEY_FILE);
const app = express();
app.use('/api', createAuthRouter(sessions, useTls));

// Serve built SPA
app.use(express.static(BUILD_DIR));
app.get('/{*path}', (req, res) => {
	if (req.path.match(/\.[a-zA-Z0-9]+$/)) {
		return res.status(404).json({ error: 'Not found' });
	}
	res.sendFile(path.join(BUILD_DIR, 'index.html'));
});

// ── HTTP/S server ─────────────────────────────────────────────────────────────
const server = useTls
	? https.createServer({ cert: fs.readFileSync(CERT_FILE), key: fs.readFileSync(KEY_FILE) }, app)
	: http.createServer(app);

// ── y-websocket ───────────────────────────────────────────────────────────────
attachYjsServer(server, sessions, setupWSConnection);

server.listen(portArg, () => {
	console.log(`Lists & Prices server running on ${useTls ? 'https' : 'http'}://localhost:${portArg}`);
	if (!useTls) console.warn('TLS not configured — run with --create-cert for HTTPS.');
});
