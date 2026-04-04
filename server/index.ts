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

import express from 'express';
import cookieParser from 'cookie-parser';
import { WebSocketServer } from 'ws';
import { setupWSConnection } from 'y-websocket/bin/utils';
import forge from 'node-forge';
import bcrypt from 'bcryptjs';
import cookieSignature from 'cookie-signature';

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
// One DB for server-side persistence (session secret, future session table, etc.)
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
const SESSION_EXPIRY_DAYS = parseInt(process.env.SESSION_EXPIRY_DAYS ?? '30', 10);
const COOKIE_NAME = 'prices_n_lists_session';

// ── Parse CLI args ────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const portArg = args.includes('--port') ? parseInt(args[args.indexOf('--port') + 1], 10) : 8080;

if (args.includes('--create-cert')) {
	await generateCert();
	process.exit(0);
}
if (args.includes('--add-user')) {
	await cliAddUser();
	process.exit(0);
}
if (args.includes('--remove-user')) {
	await cliRemoveUser();
	process.exit(0);
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
function prompt(question: string): Promise<string> {
	return new Promise((resolve) => {
		const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
		rl.question(question, (answer) => { rl.close(); resolve(answer); });
	});
}

async function cliAddUser() {
	const username = (await prompt('Username: ')).trim();
	const password = (await prompt('Password: ')).trim();
	if (!username || !password) { console.error('Username and password required.'); return; }
	const hash = await bcrypt.hash(password, 10);
	let lines: string[] = [];
	if (fs.existsSync(HTPASSWD_FILE)) {
		lines = fs.readFileSync(HTPASSWD_FILE, 'utf-8').split('\n').filter(Boolean);
	}
	const idx = lines.findIndex((l) => l.startsWith(username + ':'));
	if (idx !== -1) lines[idx] = `${username}:${hash}`;
	else lines.push(`${username}:${hash}`);
	fs.writeFileSync(HTPASSWD_FILE, lines.join('\n') + '\n');
	console.log(`User "${username}" added/updated.`);
}

async function cliRemoveUser() {
	const username = (await prompt('Username to remove: ')).trim();
	if (!username) { console.error('Username required.'); return; }
	if (!fs.existsSync(HTPASSWD_FILE)) { console.error('.htpasswd not found.'); return; }
	const lines = fs.readFileSync(HTPASSWD_FILE, 'utf-8').split('\n').filter(Boolean);
	const filtered = lines.filter((l) => !l.startsWith(username + ':'));
	fs.writeFileSync(HTPASSWD_FILE, filtered.join('\n') + (filtered.length ? '\n' : ''));
	console.log(`User "${username}" removed.`);
}

// ── Auth helpers ──────────────────────────────────────────────────────────────
async function verifyHtpasswd(username: string, password: string): Promise<boolean> {
	if (!fs.existsSync(HTPASSWD_FILE)) return false;
	const lines = fs.readFileSync(HTPASSWD_FILE, 'utf-8').split('\n').filter(Boolean);
	const line = lines.find((l) => l.startsWith(username + ':'));
	if (!line) return false;
	const hash = line.slice(username.length + 1).trim();
	return bcrypt.compare(password, hash);
}

function signSession(username: string): string {
	return cookieSignature.sign(username, SESSION_SECRET);
}

function verifySession(signed: string): string | false {
	return cookieSignature.unsign(signed, SESSION_SECRET);
}

// ── Express app ───────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(cookieParser());

// Auth middleware for API routes (not login)
function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
	const raw = req.cookies[COOKIE_NAME];
	if (!raw) return res.status(401).json({ error: 'Unauthorised' });
	const username = verifySession(raw);
	if (!username) return res.status(401).json({ error: 'Invalid session' });
	(req as express.Request & { user: string }).user = username as string;
	next();
}

// POST /api/login
app.post('/api/login', async (req, res) => {
	const { username, password } = req.body ?? {};
	if (!username || !password) return res.status(400).json({ error: 'Missing credentials' });
	const ok = await verifyHtpasswd(username, password);
	if (!ok) return res.status(401).json({ error: 'Invalid username or password' });
	const signed = signSession(username);
	res.cookie(COOKIE_NAME, signed, {
		httpOnly: true,
		secure: useTls,
		sameSite: 'strict',
		maxAge: SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000
	});
	res.json({ ok: true });
});

// POST /api/logout
app.post('/api/logout', (_req, res) => {
	res.clearCookie(COOKIE_NAME);
	res.json({ ok: true });
});

// GET /api/session
app.get('/api/session', requireAuth, (req, res) => {
	res.json({ username: (req as express.Request & { user: string }).user });
});

// Serve built SPA
app.use(express.static(BUILD_DIR));
app.get('/{*path}', (_req, res) => {
	res.sendFile(path.join(BUILD_DIR, 'index.html'));
});

// ── HTTP/S server ─────────────────────────────────────────────────────────────
const useTls = fs.existsSync(CERT_FILE) && fs.existsSync(KEY_FILE);
const server = useTls
	? https.createServer({ cert: fs.readFileSync(CERT_FILE), key: fs.readFileSync(KEY_FILE) }, app)
	: http.createServer(app);

// ── y-websocket ───────────────────────────────────────────────────────────────
const wss = new WebSocketServer({ noServer: true });
wss.on('connection', (ws, req) => {
	setupWSConnection(ws, req, { gc: true });
});

server.on('upgrade', (req, socket, head) => {
	if (req.url?.startsWith('/yjs')) {
		// Verify session cookie before allowing WS upgrade.
		// cookie package URL-encodes values; decode before verifying signature.
		const cookies = Object.fromEntries(
			(req.headers.cookie ?? '').split(';').map((c) => {
				const [k, ...v] = c.trim().split('=');
				let val = v.join('=');
				try { val = decodeURIComponent(val); } catch { /* leave as-is */ }
				return [k.trim(), val];
			})
		);
		const raw = cookies[COOKIE_NAME];
		if (!raw || !verifySession(raw)) {
			socket.write('HTTP/1.1 401 Unauthorised\r\n\r\n');
			socket.destroy();
			return;
		}
		wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
	} else {
		socket.destroy();
	}
});

server.listen(portArg, () => {
	console.log(`Lists & Prices server running on ${useTls ? 'https' : 'http'}://localhost:${portArg}`);
	if (!useTls) console.warn('TLS not configured — run with --create-cert for HTTPS.');
});
