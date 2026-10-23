import { createRequire } from 'node:module';
import { chmodSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Database as SqliteDatabase } from 'better-sqlite3';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3') as typeof import('better-sqlite3');
const Y = require('yjs') as typeof import('yjs');

// Consolidate similar-sized records instead of repeatedly merging a large base
// with tiny edits. Each size tier spans 4x the previous tier, with up to 31
// records waiting in each tier. Limit work per maintenance pass.
const MERGE_RECORDS = 32;
const MIN_TIER_BYTES = 4096;
const MAX_MERGES_PER_PASS = 4;

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
	private compactedRevision: number | undefined;
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
		this.db.prepare(`INSERT INTO metadata (key, value) VALUES (?, ?)
			ON CONFLICT(key) DO UPDATE SET value = excluded.value WHERE metadata.value <> excluded.value`).run(key, value);
	}
	mergedUpdate(): Uint8Array {
		const rows = this.db.prepare('SELECT bytes FROM updates ORDER BY id').all() as { bytes: Buffer }[];
		return Y.mergeUpdates(rows.map(row => row.bytes));
	}
	append(update: Uint8Array) {
		this.db.prepare('INSERT INTO updates (bytes) VALUES (?)').run(Buffer.from(update));
	}
	compact() {
		const revision = this.revision;
		if (this.compactedRevision === revision) return 0;
		let merges = 0;
		for (; merges < MAX_MERGES_PER_PASS; merges++) {
			const rows = this.db.prepare('SELECT id, length(bytes) AS size FROM updates ORDER BY id').all() as { id: number; size: number }[];
			const tiers = new Map<number, number[]>();
			let group: number[] | undefined;
			for (const row of rows) {
				const tier = Math.floor(Math.log(Math.max(row.size, MIN_TIER_BYTES) / MIN_TIER_BYTES) / Math.log(4));
				const ids = tiers.get(tier) ?? [];
				ids.push(row.id); tiers.set(tier, ids);
				if (ids.length === MERGE_RECORDS) { group = ids; break; }
			}
			if (!group) { this.compactedRevision = revision; break; }
			const ids = group;
			const placeholders = ids.map(() => '?').join(',');
			this.db.transaction(() => {
				const updates = this.db.prepare(`SELECT bytes FROM updates WHERE id IN (${placeholders}) ORDER BY id`).all(...ids) as { bytes: Buffer }[];
				const merged = Y.mergeUpdates(updates.map(row => row.bytes));
				const retainedId = ids.at(-1)!;
				this.db.prepare('UPDATE updates SET bytes = ? WHERE id = ?').run(Buffer.from(merged), retainedId);
				this.db.prepare(`DELETE FROM updates WHERE id IN (${placeholders}) AND id <> ?`).run(...ids, retainedId);
			})();
		}
		return merges;
	}
	exportSnapshot(file = path.join(this.directory, 'document.yjs')) {
		const output = path.resolve(file), database = path.resolve(this.db.name);
		if (output === database || output.startsWith(database + '-')) throw new Error('The export must not overwrite the SQLite database or its journal.');
		atomicPrivateFile(output, this.mergedUpdate());
		return output;
	}
	close() { this.db.close(); }
}
