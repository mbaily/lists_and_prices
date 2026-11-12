type Snapshot<T> = { value: T; checksum: string; day: string };

// Keep successful responses per service/range and live document, never in synced
// data or browser storage. A different account/document cannot reuse it.
const snapshots = new WeakMap<object, Map<string, Snapshot<unknown>>>();

export function readIncludeCache<T>(scope: object, kind: string, now = new Date()): Snapshot<T> | undefined {
	const snapshot = snapshots.get(scope)?.get(kind);
	return snapshot?.day === now.toDateString() ? snapshot as Snapshot<T> : undefined;
}

export function writeIncludeCache<T>(scope: object, kind: string, value: T, checksum: string, now = new Date()): void {
	let entries = snapshots.get(scope);
	if (!entries) {
		entries = new Map();
		snapshots.set(scope, entries);
	}
	const day = now.toDateString();
	for (const [key, snapshot] of entries) if (snapshot.day !== day) entries.delete(key);
	entries.set(kind, { value, checksum, day });
}
