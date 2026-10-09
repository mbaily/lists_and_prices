import type * as Y from 'yjs';

export interface FolderDefaultItem {
	id: string;
	name: string;
	note: boolean;
}

const NAME = 'default_item_name_';
const NOTE = 'default_item_note_';
const ORDER = 'default_item_order_';
const REMOVED = 'default_item_removed_';

function isDefaultItem(value: unknown): value is FolderDefaultItem {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const item = value as FolderDefaultItem;
	return typeof item.id === 'string' && !!item.id.trim() &&
		typeof item.name === 'string' && !!item.name.trim() && typeof item.note === 'boolean';
}

export function isFolderDefaultItems(value: unknown): value is FolderDefaultItem[] {
	return Array.isArray(value) && value.every(isDefaultItem) &&
		new Set(value.map(item => item.id)).size === value.length;
}

/** Per-item fields let independent edits and additions merge across devices.
 * Plain arrays from backups are a read-only baseline, as with folder checkboxes. */
export function readFolderDefaultItems(folder: Y.Map<unknown>): FolderDefaultItem[] {
	const items = new Map<string, FolderDefaultItem & { order: number }>();
	const baseline = folder.get('defaultItems');
	if (Array.isArray(baseline)) {
		baseline.forEach((item, order) => {
			if (isDefaultItem(item)) items.set(item.id, { ...item, order });
		});
	}
	folder.forEach((value, key) => {
		if (key.startsWith(NAME) && typeof value === 'string' && value.trim()) {
			const id = key.slice(NAME.length);
			if (id) items.set(id, { id, name: value, note: items.get(id)?.note ?? false, order: items.get(id)?.order ?? 0 });
		}
	});
	return [...items.values()]
		.filter(item => folder.get(REMOVED + item.id) !== true)
		.map(item => {
			const order = folder.get(ORDER + item.id);
			const note = folder.get(NOTE + item.id);
			return { ...item, note: typeof note === 'boolean' ? note : item.note,
				order: typeof order === 'number' && Number.isFinite(order) ? order : item.order };
		})
		.sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
		.map(({ id, name, note }) => ({ id, name, note }));
}

export function addDefaultItem(folder: Y.Map<unknown>, item: FolderDefaultItem): void {
	const current = readFolderDefaultItems(folder);
	const max = current.reduce((max, entry, index) => {
		const order = folder.get(ORDER + entry.id);
		return Math.max(max, typeof order === 'number' && Number.isFinite(order) ? order : index);
	}, -1);
	updateDefaultItem(folder, item.id, item);
	folder.set(ORDER + item.id, max + 1);
	folder.set(REMOVED + item.id, false);
}

export function updateDefaultItem(folder: Y.Map<unknown>, id: string, patch: Partial<Pick<FolderDefaultItem, 'name' | 'note'>>): void {
	if (patch.name !== undefined) folder.set(NAME + id, patch.name);
	if (patch.note !== undefined) folder.set(NOTE + id, patch.note);
}

export function removeDefaultItem(folder: Y.Map<unknown>, id: string): void {
	// A tombstone keeps concurrent edits or an older array baseline from reviving it.
	folder.set(REMOVED + id, true);
}

export function orderDefaultItems(folder: Y.Map<unknown>, items: FolderDefaultItem[]): void {
	items.forEach((item, index) => folder.set(ORDER + item.id, index));
}

export function replaceFolderDefaultItems(folder: Y.Map<unknown>, items: FolderDefaultItem[]): void {
	const wanted = new Set(items.map(item => item.id));
	for (const old of readFolderDefaultItems(folder)) {
		if (!wanted.has(old.id)) removeDefaultItem(folder, old.id);
	}
	for (const item of items) {
		updateDefaultItem(folder, item.id, item);
		folder.set(REMOVED + item.id, false);
	}
	orderDefaultItems(folder, items);
}
