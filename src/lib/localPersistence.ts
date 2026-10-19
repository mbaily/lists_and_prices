import * as Y from 'yjs';
import { Observable } from 'lib0/observable';

/** Uses the existing y-indexeddb database/stores without a migration or reset.
 * Unlike its fire-and-forget writes, saved events mean a transaction committed. */
export class LocalPersistence extends Observable<'synced' | 'saving' | 'saved' | 'error'> {
	db: IDBDatabase | null = null;
	synced = false;
	lastSyncAt: number | null = null;
	pendingSync = true;
	readonly whenSynced: Promise<void>;
	private updates: Uint8Array[] = [];
	private writing: Promise<void> | null = null;
	private stopped = false;
	private revision = 0;
	private lastKey: IDBValidKey | undefined;

	constructor(readonly name: string, readonly doc: Y.Doc) {
		super();
		const initial = Y.encodeStateAsUpdate(doc);
		if (initial.length > 2) this.updates.push(initial);
		doc.on('update', this.changed);
		this.whenSynced = this.load();
		// Consumers receive the error event; also handle failures before they await.
		void this.whenSynced.catch(error => this.emit('error', [error]));
	}

	private changed = (update: Uint8Array, origin: unknown) => {
		if (origin === this || this.stopped) return;
		this.revision++;
		this.pendingSync = true;
		this.updates.push(update);
		this.emit('saving', []);
		if (this.synced) void this.flush().catch(() => {});
	};

	private async load() {
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			const request = indexedDB.open(this.name);
			request.onupgradeneeded = () => {
				request.result.createObjectStore('updates', { autoIncrement: true });
				request.result.createObjectStore('custom');
			};
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
			request.onblocked = () => reject(new Error('Local storage is blocked by another app window. Close it and retry.'));
		});
		this.db = db;
		db.onversionchange = () => {
			db.close();
			this.emit('error', [new Error('Local storage changed in another window. Reopen the app.')]);
		};
		await this.readStoredUpdates();
		await this.writePending();
		if (this.stopped) return;
		this.synced = true;
		this.emit('synced', []);
	}

	private readStoredUpdates() {
		const revision = this.revision;
		return new Promise<void>((resolve, reject) => {
			const db = this.db!;
			const tx = db.transaction(['updates', 'custom'], 'readonly');
			// Compaction preserves the key counter. Its replacement snapshot is a
			// newer record, so reading after the known key also handles compaction.
			const range = this.lastKey === undefined ? undefined : IDBKeyRange.lowerBound(this.lastKey, true);
			const read = tx.objectStore('updates').getAll(range);
			const last = tx.objectStore('updates').openKeyCursor(null, 'prev');
			const lastSync = tx.objectStore('custom').get('lastSyncAt');
			const pending = tx.objectStore('custom').get('pendingSync');
			const confirmedKey = tx.objectStore('custom').get('syncedThroughKey');
			read.onsuccess = () => {
				try {
					if (!this.stopped) Y.transact(this.doc, () => {
						for (const update of read.result) Y.applyUpdate(this.doc, update, this);
					}, this);
				} catch (error) { tx.abort(); reject(error); }
			};
			tx.oncomplete = () => {
				this.lastKey = last.result?.key;
				this.lastSyncAt = typeof lastSync.result === 'number' ? lastSync.result : null;
				this.pendingSync = this.revision !== revision || this.updates.length > 0 || pending.result !== false || confirmedKey.result !== this.lastKey;
				resolve();
			};
			tx.onabort = () => reject(tx.error ?? new Error('Could not load local data.'));
		});
	}

	async refresh() {
		try {
			await this.flush();
			await this.readStoredUpdates();
			await this.flush();
		} catch (error) { this.emit('error', [error]); throw error; }
	}

	private writePending(): Promise<void> {
		if (this.writing) return this.writing;
		this.writing = (async () => {
			while (this.updates.length) {
				const batch = this.updates.splice(0);
				try {
					await new Promise<void>((resolve, reject) => {
						const tx = this.db!.transaction(['updates', 'custom'], 'readwrite', { durability: 'strict' });
						try {
							const last = tx.objectStore('updates').openKeyCursor(null, 'prev');
							tx.oncomplete = () => {
								// An intervening writer is included by refresh() before sync.
								if (last.result?.key !== this.lastKey) this.lastKey = undefined;
								else this.lastKey = added.result;
								resolve();
							};
							tx.onabort = () => reject(tx.error ?? new Error('Saving local data was interrupted.'));
							const added = tx.objectStore('updates').add(Y.mergeUpdates(batch));
							tx.objectStore('custom').put(this.pendingSync, 'pendingSync');
						} catch (error) { tx.abort(); reject(error); }
					});
				} catch (error) {
					this.updates.unshift(...batch);
					this.pendingSync = true;
					this.emit('error', [error]);
					throw error;
				}
			}
		})().finally(() => { this.writing = null; });
		return this.writing;
	}

	async flush(): Promise<void> {
		await this.whenSynced;
		do { await this.writePending(); } while (this.updates.length);
		this.emit('saved', []);
	}

	/** The metadata commits after all data writes, and never acknowledges edits
	 * made while the server exchange was in progress. */
	async markSynced(at: number, revision: number): Promise<boolean> {
		await this.flush();
		if (revision !== this.revision) return false;
		let confirmed = false;
		await new Promise<void>((resolve, reject) => {
			const tx = this.db!.transaction(['updates', 'custom'], 'readwrite', { durability: 'strict' });
			tx.oncomplete = () => resolve();
			tx.onabort = () => reject(tx.error ?? new Error('Could not save sync confirmation.'));
			const last = tx.objectStore('updates').openKeyCursor(null, 'prev');
			last.onsuccess = () => {
				if (last.result?.key !== this.lastKey) return;
				confirmed = true;
				tx.objectStore('custom').put(at, 'lastSyncAt');
				tx.objectStore('custom').put(false, 'pendingSync');
				tx.objectStore('custom').put(this.lastKey, 'syncedThroughKey');
			};
		});
		if (!confirmed) return false;
		this.lastSyncAt = at;
		this.pendingSync = revision !== this.revision;
		return !this.pendingSync;
	}

	get currentRevision() { return this.revision; }

	async destroy() {
		this.stopped = true;
		this.doc.off('update', this.changed);
		try { await this.flush(); } finally { this.db?.close(); }
	}
}
