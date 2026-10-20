/// <reference path="./y-websocket.d.ts" />
import { createRequire } from 'node:module';
import { getPersistence } from 'y-websocket/bin/utils';

const require = createRequire(import.meta.url);
const Y = require('yjs') as typeof import('yjs');
const { getLevelUpdates } = require('y-leveldb') as {
	getLevelUpdates(database: UpdateDatabase, name: string, options: { keys: true; values: true }): Promise<RecordEntry[]>;
};
const configured = new WeakSet<LeveldbProvider>();

interface RecordEntry { key: (string | number)[]; value: Uint8Array }
interface UpdateDatabase {
	batch(operations: ({ type: 'del'; key: RecordEntry['key'] } | { type: 'put'; key: RecordEntry['key']; value: Buffer })[], options: { sync: boolean }): Promise<void>;
}
// y-leveldb 0.1.2's exports hide its declarations. Describe only the surface
// used here, including the null results its transaction error handler returns.
interface LeveldbProvider {
	_transact<T>(operation: (database: UpdateDatabase) => Promise<T>): Promise<T | null>;
	getYDoc(name: string): Promise<import('yjs').Doc>;
	getStateVector(name: string): Promise<Uint8Array>;
	getAllDocNames(): Promise<string[] | null>;
	flushDocument(name: string): Promise<void>;
	storeUpdate(name: string, update: Uint8Array): Promise<number | null>;
}

/** Keep y-leveldb's file format and serialized writer, replacing repeated replay
 * with a binary merge. Binary merging retains deleted structs and pending updates.
 * This adapter is deliberately pinned to y-leveldb 0.1.2's transaction interface. */
export function configureLeveldbPersistence(provider: LeveldbProvider, limits = { records: 64, bytes: 16 * 1024 * 1024 }) {
	if (configured.has(provider)) return;
	configured.add(provider);
	const appended = new Map<string, { records: number; bytes: number }>();
	const compacting = new Map<string, Promise<Uint8Array>>();

	const mergeStored = async (name: string): Promise<Uint8Array> => {
		let failure: unknown;
		const result = await provider._transact(async (database: UpdateDatabase) => {
			try {
				const records = await getLevelUpdates(database, name, { keys: true, values: true });
				const update = records.length === 1 ? records[0].value : Y.mergeUpdates(records.map(record => record.value));
				if (records.length > 1) {
					// Retain the highest clock, so legacy writers and cached vectors remain
					// compatible. Replacement and deletion commit together in one batch.
					await database.batch([
						...records.slice(0, -1).map(record => ({ type: 'del' as const, key: record.key })),
						{ type: 'put', key: records.at(-1)!.key, value: Buffer.from(update) }
					], { sync: true });
				}
				return { update };
			} catch (error) {
				// y-leveldb catches transaction errors and otherwise resolves with null.
				failure = error;
				return null;
			}
		});
		if (failure) throw failure;
		if (!result) throw new Error('Could not load persistent document updates');
		return result.update;
	};
	const compact = (name: string) => {
		let pending = compacting.get(name);
		if (!pending) {
			appended.set(name, { records: 0, bytes: 0 });
			pending = mergeStored(name).finally(() => compacting.delete(name));
			compacting.set(name, pending);
		}
		return pending;
	};
	provider.getYDoc = async name => {
		// A load must queue after all preceding writes, even if a background
		// compaction of an earlier snapshot is still running.
		appended.set(name, { records: 0, bytes: 0 });
		const update = await mergeStored(name);
		const doc = new Y.Doc({ gc: false });
		try { Y.applyUpdate(doc, update); return doc; }
		catch (error) { doc.destroy(); throw error; }
	};
	provider.flushDocument = async name => { await mergeStored(name); };
	provider.getStateVector = async name => {
		const doc = await provider.getYDoc(name);
		try { return Y.encodeStateVector(doc); }
		finally { doc.destroy(); }
	};
	const storeUpdate = provider.storeUpdate.bind(provider);
	provider.storeUpdate = async (name, update) => {
		const clock = await storeUpdate(name, update);
		if (typeof clock === 'number' && clock >= 0) {
			const pending = appended.get(name) ?? { records: 0, bytes: 0 };
			pending.records++;
			pending.bytes += update.byteLength;
			appended.set(name, pending);
			if (pending.records >= limits.records || pending.bytes >= limits.bytes) {
				// The acknowledged update is already durable. A failed optimization
				// leaves the original records available and does not lose the write.
				void compact(name).catch(() => console.warn('Persistent update compaction failed; original updates retained.'));
			}
		}
		return clock;
	};
}

/** Do the one-time merge of old oversized logs before accepting browser traffic. */
export async function preparePersistentDocuments() {
	const persistence = getPersistence();
	if (!persistence) return;
	const provider = persistence.provider as LeveldbProvider;
	configureLeveldbPersistence(provider);
	const names = await provider.getAllDocNames();
	if (!names) throw new Error('Could not read persistent document names');
	for (const name of names) await provider.flushDocument(name);
	console.log(`Prepared ${names.length} persistent document(s) for sync.`);
}
