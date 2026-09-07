import type * as Y from 'yjs';

export interface FolderCheckbox {
	id: string;
	name: string;
}

const NAME = 'checkbox_name_';
const ORDER = 'checkbox_order_';
const REMOVED = 'checkbox_removed_';

/** Legacy arrays remain a read-only baseline. Per-id fields override that
 * baseline, avoiding a competing migration of a nested Y.Map on two devices. */
export function readFolderCheckboxes(folder: Y.Map<unknown>): FolderCheckbox[] {
	const boxes = new Map<string, FolderCheckbox & { order: number }>();
	const legacy = folder.get('checkboxes');
	if (Array.isArray(legacy)) {
		legacy.forEach((box, order) => {
			if (box && typeof box.id === 'string' && typeof box.name === 'string') boxes.set(box.id, { ...box, order });
		});
	}
	folder.forEach((value, key) => {
		if (key.startsWith(NAME) && typeof value === 'string') {
			const id = key.slice(NAME.length);
			boxes.set(id, { id, name: value, order: boxes.get(id)?.order ?? 0 });
		}
	});
	return [...boxes.values()]
		.filter((box) => folder.get(REMOVED + box.id) !== true)
		.map((box) => ({ ...box, order: (folder.get(ORDER + box.id) as number | undefined) ?? box.order }))
		.sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
		.map(({ id, name }) => ({ id, name }));
}

export function addCheckbox(folder: Y.Map<unknown>, box: FolderCheckbox): void {
	const current = readFolderCheckboxes(folder);
	const max = current.reduce((value, entry, idx) => Math.max(value, (folder.get(ORDER + entry.id) as number | undefined) ?? idx), -1);
	folder.set(NAME + box.id, box.name);
	folder.set(ORDER + box.id, max + 1);
	folder.set(REMOVED + box.id, false);
}

export function renameCheckbox(folder: Y.Map<unknown>, id: string, name: string): void {
	folder.set(NAME + id, name);
}

export function removeCheckbox(folder: Y.Map<unknown>, id: string): void {
	// Keep a tombstone so an offline legacy baseline cannot resurrect this name.
	folder.set(REMOVED + id, true);
}

export function orderCheckboxes(folder: Y.Map<unknown>, boxes: FolderCheckbox[]): void {
	boxes.forEach((box, idx) => folder.set(ORDER + box.id, idx));
}

/** Explicit restore/replacement, not used for interactive rename/add/remove. */
export function replaceFolderCheckboxes(folder: Y.Map<unknown>, boxes: FolderCheckbox[]): void {
	const wanted = new Set(boxes.map((box) => box.id));
	for (const old of readFolderCheckboxes(folder)) {
		if (!wanted.has(old.id)) removeCheckbox(folder, old.id);
	}
	for (const box of boxes) {
		folder.set(NAME + box.id, box.name);
		folder.set(REMOVED + box.id, false);
	}
	orderCheckboxes(folder, boxes);
}