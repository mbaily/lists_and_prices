import { createRequire } from 'node:module';
import { chmodSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Database as SqliteDatabase } from 'better-sqlite3';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3') as typeof import('better-sqlite3');
const Y = require('yjs') as typeof import('yjs');

export function atomicPrivateFile(file: string, contents: Uint8Array | string) {
	const temporary = `${file}.${randomUUID()}.tmp`;
	const fd = openSync(temporary, 'wx', 0o600);
	try {
		try { writeFileSync(fd, contents); fsyncSync(fd); }
		finally { closeSync(fd); }
		renameSync(temporary, file);
		const directory = openSync(path.dirname(file), 'r');
		try { fsyncSync(directory); } finally { closeSync(directory); }
	} finally { rmSync(temporary, { force: true }); }
}

/** One writer per directory. SQLite's OS lock is released even after a crash.
 * Store original update bytes, including unresolved structs and delete sets. */
export class LocalStorage {
	readonly db: SqliteDatabase;
	private exportedRevision = -1;
	constructor(readonly directory: string) {
		mkdirSync(directory, { recursive: true, mode: 0o700 });
		const ignore = path.join(directory, '.gitignore');
		if (!existsSync(ignore)) writeFileSync(ignore, '*\n', { flag: 'wx', mode: 0o600 });
		const file = path.join(directory, 'yjs.sqlite');
		this.db = new Database(file, { timeout: 1000 });
		try {
			chmodSync(file, 0o600);
			this.db.pragma('journal_mode = DELETE');
			this.db.pragma('synchronous = FULL');
			this.db.pragma('locking_mode = EXCLUSIVE');
			this.db.exec(`CREATE TABLE IF NOT EXISTS updates (id INTEGER PRIMARY KEY AUTOINCREMENT, bytes BLOB NOT NULL);
				CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
		} catch (error) { this.db.close(); throw error; }
	}
	get revision() {
		return (this.db.prepare('SELECT coalesce(max(id), 0) AS revision FROM updates').get() as { revision: number }).revision;
	}
	get(key: string): string | undefined {
		return (this.db.prepare('SELECT value FROM metadata WHERE key = ?').get(key) as { value: string } | undefined)?.value;
	}
	set(key: string, value: string) {
		this.db.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)').run(key, value);
	}
	mergedUpdate(): Uint8Array {
		const rows = this.db.prepare('SELECT bytes FROM updates ORDER BY id').all() as { bytes: Buffer }[];
		return Y.mergeUpdates(rows.map(row => row.bytes));
	}
	append(update: Uint8Array) {
		this.db.prepare('INSERT INTO updates (bytes) VALUES (?)').run(Buffer.from(update));
	}
	compact() {
		const { count, bytes } = this.db.prepare('SELECT count(*) AS count, coalesce(sum(length(bytes)), 0) AS bytes FROM updates').get() as { count: number; bytes: number };
		if (count < 64 && (count < 2 || bytes < 16 * 1024 * 1024)) return;
		this.db.transaction(() => {
			const merged = this.mergedUpdate(), revision = this.revision;
			this.db.prepare('UPDATE updates SET bytes = ? WHERE id = ?').run(Buffer.from(merged), revision);
			this.db.prepare('DELETE FROM updates WHERE id < ?').run(revision);
		})();
	}
	exportSnapshot() {
		if (this.exportedRevision === this.revision) return;
		atomicPrivateFile(path.join(this.directory, 'document.yjs'), this.mergedUpdate());
		this.exportedRevision = this.revision;
	}
	close() { this.db.close(); }
}
