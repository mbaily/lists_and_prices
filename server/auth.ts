import { createHash, createHmac, randomBytes } from 'node:crypto';
import type { Database, Statement } from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import cookieSignature from 'cookie-signature';

export const COOKIE_NAME = 'prices_n_lists_session';
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DATE_MS = 8_640_000_000_000_000;
const TOKEN_PATTERN = /^v2\.[a-f0-9]{64}\.[A-Za-z0-9+/]{43}$/;
const BCRYPT_PATTERN = /^\$2[aby]\$(0[4-9]|[12][0-9]|3[01])\$[./A-Za-z0-9]{53}$/;

// A single, unambiguous URL segment and .htpasswd key. No trimming or case folding.
export function isValidUsername(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[^A-Za-z0-9._~@+-]/.test(value);
}

export function isValidPassword(value: unknown): value is string {
	// bcrypt silently truncates passwords beyond 72 UTF-8 bytes.
	return typeof value === 'string' && value.length > 0 && Buffer.byteLength(value, 'utf8') <= 72;
}

/** Parse only supplied text; this module never opens credential or database files. */
export function readHtpasswdHash(contents: string, username: string): string | undefined {
	if (!isValidUsername(username)) return undefined;
	const matches = contents.split('\n').filter((line) => line.startsWith(`${username}:`));
	// Ambiguous duplicate entries fail closed, rather than choosing a password arbitrarily.
	if (matches.length !== 1) return undefined;
	const hash = matches[0].slice(username.length + 1).trim();
	return BCRYPT_PATTERN.test(hash) ? hash : undefined;
}

export function sessionTtlMs(days = '30'): number {
	const ttl = Number(days) * DAY_MS;
	if (days.length === 0 || /[^0-9]/.test(days) || !Number.isSafeInteger(ttl) || ttl <= 0 || ttl > MAX_DATE_MS - Date.now()) {
		throw new Error('SESSION_EXPIRY_DAYS must be a positive whole number within the supported date range.');
	}
	return ttl;
}

/** Use identical cookie parsing on HTTP and upgrades; reject ambiguous duplicates. */
export function readSessionCookie(header: string | undefined): string | undefined {
	let token: string | undefined;
	for (const part of (header ?? '').split(';')) {
		const separator = part.indexOf('=');
		if (separator < 0 || part.slice(0, separator).trim() !== COOKIE_NAME) continue;
		if (token !== undefined) return undefined;
		try {
			token = decodeURIComponent(part.slice(separator + 1).trim());
		} catch {
			return undefined;
		}
	}
	return token;
}

export interface Session {
	idHash: string;
	username: string;
	expiresAt: number;
}

export interface IssuedSession extends Session {
	token: string;
}

interface SessionRow {
	id_hash: string;
	username: string;
	credential_digest: string;
	expires_at: number;
}

interface SessionOptions {
	secret: string;
	readPasswordHash: (username: string) => string | undefined;
	ttlMs?: number;
	now?: () => number;
}

export class SessionStore {
	readonly ttlMs: number;
	readonly now: () => number;
	private readonly find: Statement<[string], SessionRow>;
	private readonly insert: Statement<[string, string, string, number]>;
	private readonly remove: Statement<[string]>;
	private readonly removeUser: Statement<[string], { id_hash: string }>;
	private readonly removeExpired: Statement<[number], { id_hash: string }>;
	private readonly revokedListeners = new Set<(idHash: string) => void>();

	constructor(db: Database, private readonly options: SessionOptions) {
		this.ttlMs = options.ttlMs ?? sessionTtlMs();
		this.now = options.now ?? (() => Date.now());
		if (typeof options.secret !== 'string' || options.secret.length === 0) {
			throw new Error('A nonempty session secret is required.');
		}
		if (!Number.isSafeInteger(this.ttlMs) || this.ttlMs <= 0 || this.ttlMs > MAX_DATE_MS - this.now()) {
			throw new Error('Invalid session lifetime.');
		}
		db.exec(`
			CREATE TABLE IF NOT EXISTS sessions (
				id_hash TEXT PRIMARY KEY,
				username TEXT NOT NULL,
				credential_digest TEXT NOT NULL,
				expires_at INTEGER NOT NULL
			);
			CREATE INDEX IF NOT EXISTS sessions_username ON sessions (username);
			CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions (expires_at);
		`);
		this.find = db.prepare('SELECT * FROM sessions WHERE id_hash = ?');
		this.insert = db.prepare('INSERT INTO sessions (id_hash, username, credential_digest, expires_at) VALUES (?, ?, ?, ?)');
		this.remove = db.prepare('DELETE FROM sessions WHERE id_hash = ?');
		this.removeUser = db.prepare('DELETE FROM sessions WHERE username = ? RETURNING id_hash');
		this.removeExpired = db.prepare('DELETE FROM sessions WHERE expires_at <= ? RETURNING id_hash');
		this.pruneExpired();
	}

	private readHash(username: string): string | undefined {
		try {
			const hash = this.options.readPasswordHash(username);
			return typeof hash === 'string' && BCRYPT_PATTERN.test(hash) ? hash : undefined;
		} catch {
			// Missing/unreadable credentials fail closed, without logging their contents.
			return undefined;
		}
	}

	private credentialDigest(hash: string): string {
		return createHmac('sha256', this.options.secret).update('credential\0').update(hash).digest('hex');
	}

	private tokenIdHash(token: unknown): string | undefined {
		// Reject old username signatures, JSON cookies, and malformed input before unsigning.
		if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) return undefined;
		const id = cookieSignature.unsign(token, this.options.secret);
		return id === false ? undefined : createHash('sha256').update(id).digest('hex');
	}

	async login(username: unknown, password: unknown): Promise<IssuedSession | null> {
		if (!isValidUsername(username) || !isValidPassword(password)) return null;
		const hash = this.readHash(username);
		if (!hash) return null;
		let matches: boolean;
		try {
			matches = await bcrypt.compare(password, hash);
		} catch {
			return null;
		}
		// bcrypt is asynchronous: account removal/reset during verification must not mint a session.
		if (!matches || this.readHash(username) !== hash) return null;
		this.pruneExpired();
		const id = `v2.${randomBytes(32).toString('hex')}`;
		const idHash = createHash('sha256').update(id).digest('hex');
		const expiresAt = this.now() + this.ttlMs;
		this.insert.run(idHash, username, this.credentialDigest(hash), expiresAt);
		return { idHash, username, expiresAt, token: cookieSignature.sign(id, this.options.secret) };
	}

	verify(token: unknown): Session | null {
		const idHash = this.tokenIdHash(token);
		return idHash ? this.validateId(idHash) : null;
	}

	/** For already-authenticated socket bookkeeping only; requests must use verify(). */
	validateId(idHash: string): Session | null {
		const row = this.find.get(idHash);
		if (!row) {
			// A different server/CLI process may already have deleted it.
			this.notifyRevoked(idHash);
			return null;
		}
		if (!Number.isSafeInteger(row.expires_at) || row.expires_at <= this.now() || !isValidUsername(row.username)) {
			this.revokeId(idHash);
			return null;
		}
		const hash = this.readHash(row.username);
		if (!hash || this.credentialDigest(hash) !== row.credential_digest) {
			this.revokeId(idHash);
			return null;
		}
		return { idHash, username: row.username, expiresAt: row.expires_at };
	}

	revoke(token: unknown): void {
		const idHash = this.tokenIdHash(token);
		if (idHash) this.revokeId(idHash);
	}

	private revokeId(idHash: string): void {
		this.remove.run(idHash);
		this.notifyRevoked(idHash);
	}

	/** CLI changes revoke every session, including when an account is removed and recreated. */
	revokeUser(username: string): void {
		if (!isValidUsername(username)) throw new Error('Invalid username.');
		for (const row of this.removeUser.all(username)) this.notifyRevoked(row.id_hash);
	}

	pruneExpired(): void {
		for (const row of this.removeExpired.all(this.now())) this.notifyRevoked(row.id_hash);
	}

	onRevoked(listener: (idHash: string) => void): () => void {
		this.revokedListeners.add(listener);
		return () => { this.revokedListeners.delete(listener); };
	}

	private notifyRevoked(idHash: string): void {
		for (const listener of this.revokedListeners) listener(idHash);
	}
}
