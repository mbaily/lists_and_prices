import * as Y from 'yjs';
import { digest } from 'lib0/hash/sha256';

export const NOTE_MIGRATION_ORIGIN = Symbol('note-migration');
export const NOTE_MIRROR_ORIGIN = Symbol('note-name-mirror');
const INITIALIZED = 'note-text-initialized';
const PREFIX = 'note_text_';

function findItem(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
	return doc.getArray<Y.Map<unknown>>('items').toArray().find((item) => item.get('id') === id);
}

export function hasItemText(doc: Y.Doc, id: string): boolean {
	const text = doc.share.get(PREFIX + id);
	return doc.getMap<boolean>(INITIALIZED).has(id) || (text !== undefined && text._start !== null);
}

export function readItemName(doc: Y.Doc, item: Y.Map<unknown>): string {
	const id = item.get('id') as string;
	return hasItemText(doc, id)
		? doc.getText(PREFIX + id).toString().replace(/\n$/, '')
		: (item.get('name') as string) ?? '';
}

/** New items are initialized by their creator, in the item creation transaction. */
export function initializeItemText(doc: Y.Doc, id: string, name: string): Y.Text {
	const text = doc.getText(PREFIX + id);
	if (name) text.insert(0, name);
	doc.getMap<boolean>(INITIALIZED).set(id, true);
	return text;
}

/** Synthetic bootstrap authors occupy the 53-bit range, outside Yjs's random
 * 32-bit client ids. Only the temporary doc uses these ids; the live client id
 * never changes. The same immutable legacy name operation produces the same
 * seed operations on every replica, so replay is idempotent even while offline. */
function bootstrapClientId(key: string): number {
	const hash = digest(new TextEncoder().encode(key));
	let value = hash[0] & 0x0f;
	for (let i = 1; i < 7; i++) value = value * 256 + hash[i];
	return 2 ** 52 + value;
}

export function getItemText(doc: Y.Doc, id: string): Y.Text {
	const item = findItem(doc, id);
	if (!item) throw new Error('The note no longer exists.');
	const text = doc.getText(PREFIX + id);
	if (hasItemText(doc, id)) return text;

	// Replay retained legacy name assignments in order. Using each assignment's
	// immutable Yjs id also handles an older offline replica that has not yet
	// received a later rename. Never seed from a caller's stale display string.
	const versions: { key: string; name: string }[] = [];
	let entry = item._map.get('name');
	while (entry) {
		const name = entry.content.getContent()[0];
		if (typeof name === 'string') versions.unshift({ key: `${entry.id.client}:${entry.id.clock}`, name });
		entry = entry.left ?? undefined;
	}
	const seed = new Y.Doc({ gc: false });
	try {
		const seedText = seed.getText(PREFIX + id);
		for (const version of versions) {
			const clientId = bootstrapClientId(`pnl-note-v1:${id}:${version.key}`);
			// Fail safely rather than ever reuse a synthetic author for two names.
			if (seed.store.clients.has(clientId)) throw new Error('Conflicting note initialization identity.');
			seedText.delete(0, seedText.length);
			const assignment = new Y.Doc({ gc: false });
			try {
				assignment.clientID = clientId;
				if (version.name) assignment.getText(PREFIX + id).insert(0, version.name);
				// Each assignment has root-relative anchors, independent of which
				// older names this replica still retains. Otherwise compacted and
				// non-compacted replicas would give the same ids different origins.
				Y.applyUpdate(seed, Y.encodeStateAsUpdate(assignment), NOTE_MIGRATION_ORIGIN);
			} finally {
				assignment.destroy();
			}
		}
		// Keep remote seed application and local metadata in separate transactions.
		// Mixing them makes Yjs mistake our local writes for a client-id collision.
		Y.applyUpdate(doc, Y.encodeStateAsUpdate(seed), NOTE_MIGRATION_ORIGIN);
		doc.transact(() => doc.getMap<boolean>(INITIALIZED).set(id, true), NOTE_MIGRATION_ORIGIN);
	} finally {
		seed.destroy();
	}
	return text;
}

/** Keep unchanged characters (and their CRDT identities) when editing a name. */
export function replaceItemText(doc: Y.Doc, id: string, value: string): void {
	const text = doc.getText(PREFIX + id);
	const current = text.toString();
	let start = 0;
	while (start < current.length && start < value.length && current[start] === value[start]) start++;
	let end = 0;
	while (end < current.length - start && end < value.length - start && current[current.length - 1 - end] === value[value.length - 1 - end]) end++;
	const removed = current.length - start - end;
	if (removed) text.delete(start, removed);
	const inserted = value.slice(start, value.length - end);
	if (inserted) text.insert(start, inserted);
	doc.getMap<boolean>(INITIALIZED).set(id, true);
}

/** Maintain the legacy name field for older readers/TUI, but never make this
 * derived cache an independent undo action or a source of note text. */
export function observeNoteNames(doc: Y.Doc): () => void {
	const observer = (transaction: Y.Transaction) => {
		if (transaction.origin === NOTE_MIRROR_ORIGIN) return;
		const changed: string[] = [];
		for (const [key, type] of doc.share) {
			if (key.startsWith(PREFIX) && transaction.changed.has(type)) changed.push(key.slice(PREFIX.length));
		}
		if (changed.length === 0) return;
		// A persisted update can contain thousands of texts. Index items once
		// instead of traversing the full Y.Array again for every changed note.
		const itemsById = new Map(doc.getArray<Y.Map<unknown>>('items').toArray()
			.map(item => [item.get('id') as string, item]));
		doc.transact(() => {
			for (const id of changed) {
				const item = itemsById.get(id);
				if (!item) continue;
				const name = readItemName(doc, item);
				if (item.get('name') !== name) {
					item.set('name', name);
					item.set('updatedAt', new Date().toISOString());
				}
			}
		}, NOTE_MIRROR_ORIGIN);
	};
	doc.on('afterTransaction', observer);
	return () => doc.off('afterTransaction', observer);
}
