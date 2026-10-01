import * as Y from 'yjs';

export interface CacheCompaction {
	recordsBefore: number;
	recordsAfter: number;
	bytesBefore: number;
	bytesAfter: number;
	durationMs: number;
}

/** Merge the persisted log atomically. Read from storage, not just this tab's
 * document: other tabs and offline updates with missing dependencies must survive.
 * Merging retains Yjs identities, deleted content and snapshot history (no GC).
 * IndexedDB serializes other writers before/after this readwrite transaction. */
export function compactCache(db: IDBDatabase): Promise<CacheCompaction> {
	return new Promise((resolve, reject) => {
		const started = performance.now();
		const transaction = db.transaction('updates', 'readwrite');
		const store = transaction.objectStore('updates');
		let result: CacheCompaction;
		let failure: unknown;
		transaction.oncomplete = () => resolve({ ...result, durationMs: performance.now() - started });
		transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('Cache compaction was interrupted.'));
		const request = store.getAll();
		request.onsuccess = () => {
			try {
				const updates = request.result as Uint8Array[];
				const bytesBefore = updates.reduce((size, update) => size + update.byteLength, 0);
				result = { recordsBefore: updates.length, recordsAfter: updates.length, bytesBefore, bytesAfter: bytesBefore, durationMs: 0 };
				if (updates.length < 2) return;
				const merged = Y.mergeUpdates(updates);
				// Clear and add commit together; a failure rolls both back. clear()
				// preserves the auto-increment counter used by y-indexeddb readers.
				store.clear();
				store.add(merged);
				result.recordsAfter = 1;
				result.bytesAfter = merged.byteLength;
			} catch (error) {
				failure = error;
				transaction.abort();
			}
		};
	});
}

/** Compact shortly after loading, then at most once a minute while editing.
 * The timer is not reset by each edit, so continuous typing cannot starve it. */
export function maintainCache(doc: Y.Doc, compact: () => Promise<unknown>, onError: (error: unknown) => void): () => void {
	let stopped = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const schedule = (delay: number) => {
		if (stopped || timer !== undefined) return;
		timer = setTimeout(() => {
			timer = undefined;
			void compact().catch(onError);
		}, delay);
	};
	const changed = () => schedule(60_000);
	doc.on('update', changed);
	schedule(1_000);
	return () => {
		stopped = true;
		clearTimeout(timer);
		doc.off('update', changed);
	};
}
