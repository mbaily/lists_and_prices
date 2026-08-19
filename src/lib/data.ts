/**
 * CRUD helpers for folders, lists, and items.
 * All mutations operate on the shared Y.Doc.
 */
import * as Y from 'yjs';
import { getFolders, getLists, getItems, getDoc, getSpreadsheets, getSheetCells } from './yjsStore.svelte';
import { removeFromAllReports } from './smartFolders.svelte';

function uid(): string {
	return crypto.randomUUID();
}

// ─── Folders ──────────────────────────────────────────────────────────────────

export interface Folder {
	id: string;
	name: string;
	color: string;
	parentId: string | null;
	order: number;
	done: boolean;
	favourite: boolean;
	archived: boolean;
	archivedPrevId: string | null;
	archivedNextId: string | null;
	createdAt: string | null;
	updatedAt: string | null;
	foldersFirst: boolean;
	/** If true, lists in this folder are excluded from global left/right navigation
	 *  and instead navigate only within the folder. */
	localNav: boolean;
	filterView?: 'all' | 'unchecked' | 'checked';
	/** Named checkboxes configured for lists directly in this folder.
	 *  Empty/absent = legacy single-checkbox mode. Order matters: the LAST
	 *  entry is the one that determines whether an item counts as "done". */
	checkboxes?: FolderCheckbox[];
}

export interface FolderCheckbox {
	id: string;
	name: string;
}

export const MAX_FOLDER_CHECKBOXES = 8;

export function readFolders(): Folder[] {
	return (getFolders(getDoc()).toArray() as Y.Map<unknown>[]).map(yMapToFolder);
}

function yMapToFolder(m: Y.Map<unknown>): Folder {
	return {
		id: m.get('id') as string,
		name: m.get('name') as string,
		color: (m.get('color') as string) ?? '#6366f1',
		parentId: (m.get('parentId') as string | null) ?? null,
		order: (m.get('order') as number) ?? 0,
		done: (m.get('done') as boolean) ?? false,
		favourite: (m.get('favourite') as boolean) ?? false,
		archived: (m.get('archived') as boolean) ?? false,
		archivedPrevId: (m.get('archivedPrevId') as string | null) ?? null,
		archivedNextId: (m.get('archivedNextId') as string | null) ?? null,
		createdAt: (m.get('createdAt') as string | null) ?? null,
		updatedAt: (m.get('updatedAt') as string | null) ?? null,
		foldersFirst: (m.get('foldersFirst') as boolean) ?? true,
		localNav: (m.get('localNav') as boolean) ?? false,
		filterView: (m.get('filterView') as 'all' | 'unchecked' | 'checked') ?? 'all',
		checkboxes: (m.get('checkboxes') as FolderCheckbox[] | undefined) ?? undefined
	};
}

export function getSharedOrderExtremes(doc: Y.Doc, parentId: string | null) {
	const folders = (getFolders(doc).toArray() as Y.Map<unknown>[]).filter((f) => f.get('parentId') === parentId);
	const lists = (getLists(doc).toArray() as Y.Map<unknown>[]).filter((l) => l.get('folderId') === parentId);
	const all = [...folders, ...lists];
	if (all.length === 0) return { min: 0, max: -1 };
	let min = Infinity;
	let max = -Infinity;
	for (const m of all) {
		const o = m.get('order') as number ?? 0;
		if (o < min) min = o;
		if (o > max) max = o;
	}
	return { min, max };
}

export function createFolder(name: string, parentId: string | null, color = '#6366f1', addPosition: 'top' | 'bottom' = 'bottom'): string {
	const doc = getDoc();
	const id = uid();
	const now = new Date().toISOString();
	doc.transact(() => {
		const folders = getFolders(doc);
		const extremes = getSharedOrderExtremes(doc, parentId);
		const newOrder = addPosition === 'top' ? extremes.min - 1 : extremes.max + 1;
		
		const m = new Y.Map<unknown>();
		m.set('id', id);
		m.set('name', name);
		m.set('color', color);
		m.set('parentId', parentId);
		m.set('order', newOrder);
		m.set('done', false);
		m.set('favourite', false);
		m.set('archived', false);
		m.set('foldersFirst', true);
		m.set('localNav', false);
		m.set('createdAt', now);
		m.set('updatedAt', now);
		folders.push([m]);
	});
	return id;
}

export function updateFolder(id: string, patch: Partial<Omit<Folder, 'id' | 'createdAt' | 'updatedAt'>>) {
	const doc = getDoc();
	doc.transact(() => {
		const m = findYMap(getFolders(doc), id);
		if (!m) return;
		for (const [k, v] of Object.entries(patch)) m.set(k, v);
		const keys = Object.keys(patch);
		if (!(keys.length === 1 && keys[0] === 'order')) m.set('updatedAt', new Date().toISOString());
	});
}

// ─── Named checkboxes (per folder) ─────────────────────────────────────────────
// Configured on a Folder; applies to lists directly inside it. Order matters —
// the LAST entry determines whether an item counts as "done". Item-level state
// is stored per-checkbox-id directly on the item (see setItemCheckboxState),
// never as a single JSON blob, so concurrent offline edits to different names
// merge safely instead of one overwriting the other.

/** Tabs/newlines would corrupt the TSV export's column alignment, so they're
 *  collapsed to spaces; length is capped as a defensive limit. */
function sanitizeCheckboxName(name: string): string {
	return name.replace(/[\t\r\n]+/g, ' ').trim().slice(0, 40);
}

export function addFolderCheckbox(folderId: string, name: string): string | null {
	const trimmed = sanitizeCheckboxName(name);
	if (!trimmed) return null;
	const doc = getDoc();
	let newId: string | null = null;
	doc.transact(() => {
		const m = findYMap(getFolders(doc), folderId);
		if (!m) return;
		const current = ((m.get('checkboxes') as FolderCheckbox[] | undefined) ?? []).slice();
		if (current.length >= MAX_FOLDER_CHECKBOXES) return;
		if (current.some((c) => c.name.toLowerCase() === trimmed.toLowerCase())) return;
		newId = uid();
		current.push({ id: newId, name: trimmed });
		m.set('checkboxes', current);
		m.set('updatedAt', new Date().toISOString());
	});
	return newId;
}

export function renameFolderCheckbox(folderId: string, checkboxId: string, name: string): boolean {
	const trimmed = sanitizeCheckboxName(name);
	if (!trimmed) return false;
	const doc = getDoc();
	let ok = false;
	doc.transact(() => {
		const m = findYMap(getFolders(doc), folderId);
		if (!m) return;
		const current = ((m.get('checkboxes') as FolderCheckbox[] | undefined) ?? []).slice();
		const idx = current.findIndex((c) => c.id === checkboxId);
		if (idx === -1) return;
		// Reject if another checkbox already has this name (case-insensitive).
		if (current.some((c, i) => i !== idx && c.name.toLowerCase() === trimmed.toLowerCase())) return;
		current[idx] = { ...current[idx], name: trimmed };
		m.set('checkboxes', current);
		m.set('updatedAt', new Date().toISOString());
		ok = true;
	});
	return ok;
}

/** Removes a named checkbox from a folder's config. Per-item checked state for
 *  this id is left in place (orphaned) — harmless, and simply ignored once the
 *  id is no longer configured. Removing the last remaining name reverts the
 *  folder's lists back to the legacy single-checkbox mode. */
export function removeFolderCheckbox(folderId: string, checkboxId: string): void {
	const doc = getDoc();
	doc.transact(() => {
		const m = findYMap(getFolders(doc), folderId);
		if (!m) return;
		const current = ((m.get('checkboxes') as FolderCheckbox[] | undefined) ?? []).slice();
		const next = current.filter((c) => c.id !== checkboxId);
		m.set('checkboxes', next);
		m.set('updatedAt', new Date().toISOString());
	});
}

export function moveFolderCheckbox(folderId: string, checkboxId: string, direction: 'up' | 'down'): void {
	const doc = getDoc();
	doc.transact(() => {
		const m = findYMap(getFolders(doc), folderId);
		if (!m) return;
		const current = ((m.get('checkboxes') as FolderCheckbox[] | undefined) ?? []).slice();
		const idx = current.findIndex((c) => c.id === checkboxId);
		if (idx === -1) return;
		const swapWith = direction === 'up' ? idx - 1 : idx + 1;
		if (swapWith < 0 || swapWith >= current.length) return;
		[current[idx], current[swapWith]] = [current[swapWith], current[idx]];
		m.set('checkboxes', current);
		m.set('updatedAt', new Date().toISOString());
	});
}

export function deleteFolder(id: string) {
	const doc = getDoc();
	doc.transact(() => _deleteFolderInner(id));
}

function _deleteFolderInner(id: string) {
	// Cascade: delete child folders recursively, then lists/items
	const doc = getDoc();
	const allFolders = getFolders(doc).toArray() as Y.Map<unknown>[];
	const childIds = allFolders
		.filter((f) => f.get('parentId') === id)
		.map((f) => f.get('id') as string);
	for (const cid of childIds) _deleteFolderInner(cid);

	// Delete lists in this folder
	const allLists = getLists(doc).toArray() as Y.Map<unknown>[];
	const listIds = allLists
		.filter((l) => l.get('folderId') === id)
		.map((l) => l.get('id') as string);
	for (const lid of listIds) _deleteListInner(lid);

	removeYMap(getFolders(doc), id);
	// Clean up any smart folder report assignments for this folder
	removeFromAllReports(id);
}

export function isDescendant(folderId: string, targetId: string, _visited = new Set<string>()): boolean {
	if (folderId === targetId) return true;
	if (_visited.has(folderId)) return false; // Cycle detected
	_visited.add(folderId);
	const doc = getDoc();
	const all = getFolders(doc).toArray() as Y.Map<unknown>[];
	const children = all.filter((f) => f.get('parentId') === folderId).map((f) => f.get('id') as string);
	return children.some((cid) => isDescendant(cid, targetId, _visited));
}

export function isFolderEffectivelyArchived(id: string, folders: Folder[], visited = new Set<string>()): boolean {
	if (visited.has(id)) return false;
	visited.add(id);
	const f = folders.find((x) => x.id === id);
	if (!f) return false;
	if (f.archived) return true;
	if (f.parentId === null) return false;
	return isFolderEffectivelyArchived(f.parentId, folders, visited);
}

export function isListEffectivelyArchived(list: ListMeta, folders: Folder[]): boolean {
	if (list.archived) return true;
	return isFolderEffectivelyArchived(list.folderId, folders, new Set());
}

// ─── Lists ────────────────────────────────────────────────────────────────────

export type FilterView = 'all' | 'unchecked' | 'checked';

export interface ListMeta {
	id: string;
	name: string;
	color: string;
	folderId: string;
	type: 'plain' | 'priced' | 'divider';
	order: number;
	done: boolean;
	favourite: boolean;
	archived: boolean;
	archivedPrevId: string | null;
	archivedNextId: string | null;
	createdAt: string | null;
	updatedAt: string | null;
	filterView: FilterView;
	defaultIsNote?: boolean;
	journalMode?: boolean;
}

export function readLists(): ListMeta[] {
	return (getLists(getDoc()).toArray() as Y.Map<unknown>[]).map(yMapToList);
}

function yMapToList(m: Y.Map<unknown>): ListMeta {
	return {
		id: m.get('id') as string,
		name: m.get('name') as string,
		color: (m.get('color') as string) ?? '#6366f1',
		folderId: m.get('folderId') as string,
		type: (m.get('type') as 'plain' | 'priced' | 'divider') ?? 'plain',
		order: (m.get('order') as number) ?? 0,
		done: (m.get('done') as boolean) ?? false,
		favourite: (m.get('favourite') as boolean) ?? false,
		archived: (m.get('archived') as boolean) ?? false,
		archivedPrevId: (m.get('archivedPrevId') as string | null) ?? null,
		archivedNextId: (m.get('archivedNextId') as string | null) ?? null,
		createdAt: (m.get('createdAt') as string | null) ?? null,
		updatedAt: (m.get('updatedAt') as string | null) ?? null,
		filterView: (m.get('filterView') as FilterView) ?? 'all',
		defaultIsNote: (m.get('defaultIsNote') as boolean) ?? false,
		journalMode: (m.get('journalMode') as boolean) ?? false
	};
}

export function createList(
	name: string,
	folderId: string,
	type: 'plain' | 'priced' | 'divider',
	color = '#6366f1',
	addPosition: 'top' | 'bottom' = 'bottom',
	isFutureList = false
): string {
	const doc = getDoc();
	const id = uid();
	const now = new Date().toISOString();
	doc.transact(() => {
		const lists = getLists(doc);
		const existing = (lists.toArray() as Y.Map<unknown>[]).filter(
			(l) => l.get('folderId') === folderId
		);
		const extremes = getSharedOrderExtremes(doc, folderId);
		let newOrder = addPosition === 'top' ? extremes.min - 1 : extremes.max + 1;

		if (isFutureList) {
			const divider = existing.find(l => l.get('type') === 'divider');
			if (divider) {
				const dividerOrder = divider.get('order') as number;
				const allFolders = (getFolders(doc).toArray() as Y.Map<unknown>[]).filter((f) => f.get('parentId') === folderId);
				const all = [...allFolders, ...existing];
				
				if (addPosition === 'top') {
					newOrder = dividerOrder;
					for (const sib of all) {
						if ((sib.get('order') as number) >= dividerOrder) {
							sib.set('order', (sib.get('order') as number) + 1);
						}
					}
				} else {
					newOrder = dividerOrder + 1;
					for (const sib of all) {
						if ((sib.get('order') as number) > dividerOrder) {
							sib.set('order', (sib.get('order') as number) + 1);
						}
					}
				}
			}
		}

		const m = new Y.Map<unknown>();
		m.set('id', id);
		m.set('name', name);
		m.set('color', color);
		m.set('folderId', folderId);
		m.set('type', type);
		m.set('order', newOrder);
		m.set('createdAt', now);
		m.set('updatedAt', now);
		m.set('defaultIsNote', false);
		m.set('journalMode', false);
		lists.push([m]);
	});
	return id;
}

export function updateList(id: string, patch: Partial<Omit<ListMeta, 'id' | 'createdAt' | 'updatedAt'>>) {
	const doc = getDoc();
	doc.transact(() => {
		const m = findYMap(getLists(doc), id);
		if (!m) return;
		for (const [k, v] of Object.entries(patch)) m.set(k, v);
		const keys = Object.keys(patch);
		if (!(keys.length === 1 && keys[0] === 'order')) m.set('updatedAt', new Date().toISOString());
	});
}

function _deleteListInner(id: string) {
	const doc = getDoc();
	// Delete all items in this list
	const allItems = getItems(doc).toArray() as Y.Map<unknown>[];
	const itemIds = allItems
		.filter((i) => i.get('listId') === id)
		.map((i) => i.get('id') as string);
	for (const iid of itemIds) deleteItem(iid);
	removeYMap(getLists(doc), id);
}

export function deleteList(id: string) {
	getDoc().transact(() => {
		_deleteListInner(id);
		removeFromAllReports(id);
	});
}

// ─── Items ────────────────────────────────────────────────────────────────────

export interface Item {
	id: string;
	listId: string;
	name: string;
	price: number | null;
	qty: number | null;
	checked: boolean;
	order: number;
	heading: boolean;
	parentId: string | null;
	note: boolean;
	pinned: boolean;
	fullScreen?: boolean;
	createdAt: string | null;
	updatedAt: string | null;
	/** Per-named-checkbox state, keyed by FolderCheckbox.id. Only meaningful
	 *  when the item's list's folder has `checkboxes` configured. */
	checks: Record<string, boolean>;
}

export function readItems(listId: string): Item[] {
	return (getItems(getDoc()).toArray() as Y.Map<unknown>[])
		.filter((m) => m.get('listId') === listId)
		.map(yMapToItem)
		.sort((a, b) => a.order - b.order);
}

export function readAllItems(): Item[] {
	return (getItems(getDoc()).toArray() as Y.Map<unknown>[]).map(yMapToItem);
}

function yMapToItem(m: Y.Map<unknown>): Item {
	const checks: Record<string, boolean> = {};
	m.forEach((value, key) => {
		if (key.startsWith('chk_')) checks[key.slice(4)] = value === true;
	});
	return {
		id: m.get('id') as string,
		listId: m.get('listId') as string,
		name: m.get('name') as string,
		price: (m.get('price') as number | null) ?? null,
		qty: (m.get('qty') as number | null) ?? null,
		checked: (m.get('checked') as boolean) ?? false,
		order: (m.get('order') as number) ?? 0,
		heading: (m.get('heading') as boolean) ?? false,
		parentId: (m.get('parentId') as string | null) ?? null,
		note: (m.get('note') as boolean) ?? false,
		pinned: (m.get('pinned') as boolean) ?? false,
		fullScreen: (m.get('fullScreen') as boolean) ?? false,
		createdAt: (m.get('createdAt') as string | null) ?? null,
		updatedAt: (m.get('updatedAt') as string | null) ?? null,
		checks
	};
}

export function createItem(listId: string, name: string, price: number | null = null, parentId: string | null = null, note = false, addPosition: 'top' | 'bottom' = 'bottom', explicitOrder?: number): string {
	const doc = getDoc();
	const id = uid();
	const now = new Date().toISOString();
	doc.transact(() => {
		const items = getItems(doc);
		let newOrder = explicitOrder;
		if (newOrder === undefined) {
			const existing = (items.toArray() as Y.Map<unknown>[]).filter(
				(i) => i.get('listId') === listId
			);
			// Order within siblings (same parentId)
			const siblings = existing.filter((i) => (i.get('parentId') ?? null) === parentId);
			newOrder = addPosition === 'top' ? -1 : siblings.length;
			if (addPosition === 'top') {
				for (const sib of siblings) sib.set('order', (sib.get('order') as number ?? 0) + 1);
			}
		}
		const m = new Y.Map<unknown>();
		m.set('id', id);
		m.set('listId', listId);
		m.set('name', name);
		m.set('price', price);
		m.set('checked', false);
		m.set('order', newOrder);
		m.set('createdAt', now);
		m.set('updatedAt', now);
		if (parentId !== null) m.set('parentId', parentId);
		if (note) m.set('note', note);
		items.push([m]);
	});
	return id;
}

export function updateItem(id: string, patch: Partial<Omit<Item, 'id' | 'listId' | 'createdAt' | 'updatedAt' | 'checks'>>) {
	const doc = getDoc();
	doc.transact(() => {
		const m = findYMap(getItems(doc), id);
		if (!m) return;
		for (const [k, v] of Object.entries(patch)) m.set(k, v);
		const keys = Object.keys(patch);
		if (!(keys.length === 1 && keys[0] === 'order')) m.set('updatedAt', new Date().toISOString());
	});
}

/** Sets a single named checkbox's state on an item. Stored as its own Yjs key
 *  (`chk_<checkboxId>`) rather than a merged blob so concurrent offline edits
 *  to different checkboxes on the same item don't clobber each other. */
export function setItemCheckboxState(itemId: string, checkboxId: string, value: boolean): void {
	const doc = getDoc();
	doc.transact(() => {
		const m = findYMap(getItems(doc), itemId);
		if (!m) return;
		m.set(`chk_${checkboxId}`, value);
		m.set('updatedAt', new Date().toISOString());
	});
}

/** Clears (sets false) the given named checkboxes across a batch of items —
 *  used for bulk "uncheck" actions on lists using named checkboxes. */
export function clearItemCheckboxes(itemIds: string[], checkboxIds: string[]): void {
	const doc = getDoc();
	doc.transact(() => {
		for (const itemId of itemIds) {
			const m = findYMap(getItems(doc), itemId);
			if (!m) continue;
			for (const cid of checkboxIds) m.set(`chk_${cid}`, false);
			m.set('updatedAt', new Date().toISOString());
		}
	});
}

/** Whether an item counts as "done". For folders with named checkboxes
 *  configured, that's whether the LAST configured checkbox is checked;
 *  otherwise falls back to the legacy single `checked` boolean. */
export function isItemDone(item: Item, folder: Folder | null | undefined): boolean {
	const boxes = folder?.checkboxes;
	if (boxes && boxes.length > 0) {
		return !!item.checks[boxes[boxes.length - 1].id];
	}
	return item.checked;
}

export function deleteItem(id: string) {
	removeYMap(getItems(getDoc()), id);
}

function _deleteItemCascadeInner(id: string) {
	const doc = getDoc();
	const children = (getItems(doc).toArray() as Y.Map<unknown>[])
		.filter((m) => m.get('parentId') === id)
		.map((m) => m.get('id') as string);
	for (const cid of children) _deleteItemCascadeInner(cid);
	removeYMap(getItems(doc), id);
}

export function deleteItemCascade(id: string) {
	getDoc().transact(() => _deleteItemCascadeInner(id));
}

export function deleteItemsBatch(ids: string[]): void {
	getDoc().transact(() => { for (const id of ids) _deleteItemCascadeInner(id); });
}

export function setItemsChecked(ids: string[], checked: boolean): void {
	getDoc().transact(() => { for (const id of ids) updateItem(id, { checked }); });
}

export function createItemsBatch(listId: string, names: string[], addPosition: 'top' | 'bottom' = 'bottom'): void {
	const doc = getDoc();
	doc.transact(() => {
		const existing = getItems(doc).toArray().filter(i => i.get('listId') === listId && (i.get('parentId') ?? null) === null);
		
		if (addPosition === 'top') {
			for (const e of existing) {
				const current = e.get('order') as number ?? 0;
				e.set('order', current + names.length);
			}
			names.forEach((name, i) => createItem(listId, name, null, null, false, 'bottom', i));
		} else {
			const baseOrder = existing.length;
			names.forEach((name, i) => createItem(listId, name, null, null, false, 'bottom', baseOrder + i));
		}
	});
}

export interface ExportedItem {
	id: string;
	name: string;
	price?: number | null;
	qty?: number | null;
	checked?: boolean;
	/** Names (not ids) of named checkboxes checked on this item — portable
	 *  across devices/folders since checkbox ids aren't meaningful outside
	 *  their originating folder. Only present when the source folder had
	 *  named checkboxes configured. */
	checkedNames?: string[];
	heading?: boolean;
	note?: boolean;
	pinned?: boolean;
	parentId?: string | null;
}

/** Import items from a JSON export, preserving all attributes and hierarchy.
 *  Items must be in tree order (parents before their children). */
export function createItemsFromExport(listId: string, exportedItems: ExportedItem[]): void {
	const doc = getDoc();
	const idMap = new Map<string, string>(); // old id → new id
	const list = readLists().find((l) => l.id === listId);
	const folder = list ? readFolders().find((f) => f.id === list.folderId) : undefined;
	const checkboxes = folder?.checkboxes ?? [];
	doc.transact(() => {
		for (const ex of exportedItems) {
			const resolvedParentId = ex.parentId ? (idMap.get(ex.parentId) ?? null) : null;
			const newId = createItem(listId, ex.name, ex.price ?? null, resolvedParentId, ex.note ?? false, 'bottom');
			idMap.set(ex.id, newId);
			const patch: Partial<Omit<Item, 'id' | 'listId' | 'createdAt' | 'updatedAt' | 'checks'>> = {};
			if (ex.qty != null) patch.qty = ex.qty;
			if (ex.checked) patch.checked = true;
			if (ex.heading) patch.heading = true;
			if (ex.pinned) patch.pinned = true;
			if (Object.keys(patch).length > 0) updateItem(newId, patch);
			if (ex.checkedNames && ex.checkedNames.length > 0 && checkboxes.length > 0) {
				for (const name of ex.checkedNames) {
					const box = checkboxes.find((c) => c.name.toLowerCase() === name.toLowerCase());
					if (box) setItemCheckboxState(newId, box.id, true);
				}
			} else if (ex.checked && checkboxes.length > 0) {
				// Legacy single-checkbox export ("checked": true) landing in a list
				// that now has named checkboxes — treat it as fully done rather than
				// silently showing every chip unchecked.
				for (const box of checkboxes) setItemCheckboxState(newId, box.id, true);
			}
		}
	});
}

export function listTotal(listId: string): number {
	return Math.round(
		readItems(listId)
			.filter((i) => !i.heading && !i.note)
			.reduce((s, i) => s + Math.round((i.price ?? 0) * (i.qty ?? 1) * 100), 0)
	) / 100;
}

// ─── Archive helpers ──────────────────────────────────────────────────────────

function computeInsertIndex(visible: { id: string }[], prevId: string | null, nextId: string | null): number {
	if (prevId) {
		const idx = visible.findIndex((v) => v.id === prevId);
		if (idx !== -1) return idx + 1;
	}
	if (nextId) {
		const idx = visible.findIndex((v) => v.id === nextId);
		if (idx !== -1) return idx;
	}
	if (!prevId) return 0; // was the first sibling; if neighbours gone, restore to front
	return visible.length; // was the last sibling; append
}

export function archiveList(id: string) {
	const doc = getDoc();
	doc.transact(() => {
		const list = readLists().find((l) => l.id === id);
		if (!list) return;
		const allSiblings = readLists()
			.filter((l) => l.folderId === list.folderId && !l.archived)
			.sort((a, b) => a.order - b.order);
		const idx = allSiblings.findIndex((l) => l.id === id);
		// If idx === -1, it's already archived (or not found), so skip
		if (idx === -1) return;
		const prevId = idx > 0 ? allSiblings[idx - 1].id : null;
		const nextId = idx < allSiblings.length - 1 ? allSiblings[idx + 1].id : null;
		updateList(id, { archived: true, archivedPrevId: prevId, archivedNextId: nextId });
	});
}

export function unarchiveList(id: string) {
	const doc = getDoc();
	const list = readLists().find((l) => l.id === id);
	if (!list) return;
	const visible = readLists()
		.filter((l) => l.folderId === list.folderId && !l.archived)
		.sort((a, b) => a.order - b.order);
	const insertIdx = computeInsertIndex(visible, list.archivedPrevId, list.archivedNextId);
	const updated = [...visible];
	updated.splice(insertIdx, 0, list);
	doc.transact(() => {
		updated.forEach((l, i) => {
			if (l.id === id) {
				updateList(id, { archived: false, order: i, archivedPrevId: null, archivedNextId: null });
			} else if (l.order !== i) {
				updateList(l.id, { order: i });
			}
		});
	});
}

export function archiveFolder(id: string) {
	const doc = getDoc();
	doc.transact(() => {
		const allFolders = readFolders();
		const folder = allFolders.find((f) => f.id === id);
		if (!folder) return;
		const allSiblings = allFolders
			.filter((f) => f.parentId === folder.parentId && !f.archived)
			.sort((a, b) => a.order - b.order);
		const idx = allSiblings.findIndex((f) => f.id === id);
		// If idx === -1, it's already archived (or not found), so skip
		if (idx === -1) return;
		const prevId = idx > 0 ? allSiblings[idx - 1].id : null;
		const nextId = idx < allSiblings.length - 1 ? allSiblings[idx + 1].id : null;
		updateFolder(id, { archived: true, archivedPrevId: prevId, archivedNextId: nextId });
	});
}

export function unarchiveFolder(id: string) {
	const doc = getDoc();
	const folder = readFolders().find((f) => f.id === id);
	if (!folder) return;
	const visible = readFolders()
		.filter((f) => f.parentId === folder.parentId && !f.archived)
		.sort((a, b) => a.order - b.order);
	const insertIdx = computeInsertIndex(visible, folder.archivedPrevId, folder.archivedNextId);
	const updated = [...visible];
	updated.splice(insertIdx, 0, folder);
	doc.transact(() => {
		updated.forEach((f, i) => {
			if (f.id === id) {
				updateFolder(id, { archived: false, order: i, archivedPrevId: null, archivedNextId: null });
			} else if (f.order !== i) {
				updateFolder(f.id, { order: i });
			}
		});
	});
}

// ─── Reorder helpers ──────────────────────────────────────────────────────────

export function reorderItems(listId: string, fromIndex: number, toIndex: number) {
	const doc = getDoc();
	const items = readItems(listId);
	const [moved] = items.splice(fromIndex, 1);
	items.splice(toIndex, 0, moved);
	doc.transact(() => items.forEach((item, idx) => updateItem(item.id, { order: idx })));
}

export function reorderSiblings(listId: string, parentId: string | null, fromIdx: number, toIdx: number) {
	const doc = getDoc();
	const siblings = readItems(listId)
		.filter((i) => i.parentId === parentId)
		.sort((a, b) => a.order - b.order);
	const [moved] = siblings.splice(fromIdx, 1);
	siblings.splice(toIdx, 0, moved);
	doc.transact(() => siblings.forEach((item, idx) => updateItem(item.id, { order: idx })));
}

export function reorderFolders(parentId: string | null, fromIndex: number, toIndex: number, visibleIds?: string[]) {
	const doc = getDoc();
	const all = readFolders().filter((f) => f.parentId === parentId).sort((a, b) => a.order - b.order);

	if (visibleIds && visibleIds.length > 0) {
		const draggedId = visibleIds[fromIndex];
		const draggedItemIndex = all.findIndex((f) => f.id === draggedId);
		if (draggedItemIndex === -1) return;

		const newVisible = [...visibleIds];
		const [movedId] = newVisible.splice(fromIndex, 1);
		newVisible.splice(toIndex, 0, movedId);

		const prevVisibleId = toIndex > 0 ? newVisible[toIndex - 1] : null;
		const nextVisibleId = toIndex < newVisible.length - 1 ? newVisible[toIndex + 1] : null;

		const [moved] = all.splice(draggedItemIndex, 1);

		let insertIndex = all.length;
		if (nextVisibleId) {
			const nextIdx = all.findIndex((f) => f.id === nextVisibleId);
			insertIndex = nextIdx !== -1 ? nextIdx : all.length;
		} else if (prevVisibleId) {
			const prevIdx = all.findIndex((f) => f.id === prevVisibleId);
			insertIndex = prevIdx !== -1 ? prevIdx + 1 : all.length;
		}

		all.splice(insertIndex, 0, moved);
	} else {
		const [moved] = all.splice(fromIndex, 1);
		all.splice(toIndex, 0, moved);
	}

	doc.transact(() => all.forEach((f, idx) => updateFolder(f.id, { order: idx })));
}

export function reorderMixedItems(parentId: string | null, fromIndex: number, toIndex: number, visibleItems?: {id: string, type: string}[]) {
	const doc = getDoc();
	const folders = readFolders().filter((f) => f.parentId === parentId).map((f) => ({ ...f, _type: 'folder' }));
	const lists = readLists().filter((l) => l.folderId === parentId).map((l) => ({ ...l, _type: 'list' }));
	const all = [...folders, ...lists].sort((a, b) => a.order - b.order);

	if (visibleItems && visibleItems.length > 0) {
		const draggedId = visibleItems[fromIndex].id;
		const draggedItemIndex = all.findIndex((i) => i.id === draggedId);
		if (draggedItemIndex === -1) return;

		const newVisible = [...visibleItems];
		const [movedId] = newVisible.splice(fromIndex, 1);
		newVisible.splice(toIndex, 0, movedId);

		const prevVisibleId = toIndex > 0 ? newVisible[toIndex - 1].id : null;
		const nextVisibleId = toIndex < newVisible.length - 1 ? newVisible[toIndex + 1].id : null;

		const [moved] = all.splice(draggedItemIndex, 1);

		let insertIndex = all.length;
		if (nextVisibleId) {
			const nextIdx = all.findIndex((i) => i.id === nextVisibleId);
			insertIndex = nextIdx !== -1 ? nextIdx : all.length;
		} else if (prevVisibleId) {
			const prevIdx = all.findIndex((i) => i.id === prevVisibleId);
			insertIndex = prevIdx !== -1 ? prevIdx + 1 : all.length;
		}

		all.splice(insertIndex, 0, moved);
	} else {
		const [moved] = all.splice(fromIndex, 1);
		all.splice(toIndex, 0, moved);
	}

	doc.transact(() => {
		all.forEach((item, idx) => {
			if (item._type === 'folder') {
				updateFolder(item.id, { order: idx });
			} else {
				updateList(item.id, { order: idx });
			}
		});
	});
}

export function reorderLists(folderId: string, fromIndex: number, toIndex: number, visibleIds?: string[]) {
	const doc = getDoc();
	const all = readLists().filter((l) => l.folderId === folderId).sort((a, b) => a.order - b.order);

	if (visibleIds && visibleIds.length > 0) {
		const draggedId = visibleIds[fromIndex];
		const draggedItemIndex = all.findIndex((l) => l.id === draggedId);
		if (draggedItemIndex === -1) return;

		const newVisible = [...visibleIds];
		const [movedId] = newVisible.splice(fromIndex, 1);
		newVisible.splice(toIndex, 0, movedId);

		const prevVisibleId = toIndex > 0 ? newVisible[toIndex - 1] : null;
		const nextVisibleId = toIndex < newVisible.length - 1 ? newVisible[toIndex + 1] : null;

		const [moved] = all.splice(draggedItemIndex, 1);

		let insertIndex = all.length;
		if (nextVisibleId) {
			const nextIdx = all.findIndex((l) => l.id === nextVisibleId);
			insertIndex = nextIdx !== -1 ? nextIdx : all.length;
		} else if (prevVisibleId) {
			const prevIdx = all.findIndex((l) => l.id === prevVisibleId);
			insertIndex = prevIdx !== -1 ? prevIdx + 1 : all.length;
		}

		all.splice(insertIndex, 0, moved);
	} else {
		const [moved] = all.splice(fromIndex, 1);
		all.splice(toIndex, 0, moved);
	}

	doc.transact(() => all.forEach((l, idx) => updateList(l.id, { order: idx })));
}

/**
 * Returns all non-archived lists in the order the user would encounter them
 * by navigating the folder tree depth-first (respecting each folder's foldersFirst setting).
 */
export function readListsInTreeOrder(folders?: Folder[], lists?: ListMeta[]): ListMeta[] {
	const allFolders = folders ?? readFolders();
	const allLists = lists ?? readLists();
	const result: ListMeta[] = [];

	function visit(parentId: string | null, visited = new Set<string>()) {
		if (parentId !== null) {
			if (visited.has(parentId)) return;
			visited.add(parentId);
		}

		const folder = parentId === null ? null : allFolders.find((f) => f.id === parentId);
		if (folder?.archived) return;

		const childFolders = allFolders
			.filter((f) => f.parentId === parentId && !isFolderEffectivelyArchived(f.id, allFolders))
			.map((f) => ({ ...f, _type: 'folder' }));
		const childLists = allLists
			.filter((l) => l.folderId === parentId && !isListEffectivelyArchived(l, allFolders) && !l.done && !folder?.localNav)
			.map((l) => ({ ...l, _type: 'list' }));
		const mixed = [...childFolders, ...childLists].sort((a, b) => a.order - b.order);
		for (const item of mixed) {
			if (item._type === 'folder') visit(item.id);
			else result.push(item as unknown as ListMeta);
		}
	}

	visit(null);
	return result;
}

// ─── Internal utilities ───────────────────────────────────────────────────────

function findYMap(arr: Y.Array<Y.Map<unknown>>, id: string): Y.Map<unknown> | null {
	for (const m of arr.toArray() as Y.Map<unknown>[]) {
		if (m.get('id') === id) return m;
	}
	return null;
}

function removeYMap(arr: Y.Array<Y.Map<unknown>>, id: string) {
	const maps = arr.toArray() as Y.Map<unknown>[];
	const idx = maps.findIndex((m) => m.get('id') === id);
	if (idx !== -1) arr.delete(idx, 1);
}

// ─── Backup / Restore ─────────────────────────────────────────────────────────

export interface BackupFile {
	version: number;
	exported: string; // ISO timestamp
	folders: Folder[];
	lists: ListMeta[];
	items: ReturnType<typeof _readAllItems>;
	sheets?: SheetMeta[];
	smartFolders?: Record<string, string[]>;
}

function _readAllItems() {
	return (getItems(getDoc()).toArray() as Y.Map<unknown>[]).map(yMapToItem);
}

function _readSmartFolders(): Record<string, string[]> {
	try {
		const m = getDoc().getMap<string>('smart-folders');
		const out: Record<string, string[]> = {};
		m.forEach((val, key) => { try { out[key] = JSON.parse(val); } catch { /* skip */ } });
		return out;
	} catch { return {}; }
}

/** Serialise the entire doc to a plain JS object ready to JSON.stringify. */
export function exportBackup(): BackupFile {
	return {
		version: 1,
		exported: new Date().toISOString(),
		folders: readFolders(),
		lists: readLists(),
		items: _readAllItems(),
		sheets: readSheets(),
		smartFolders: _readSmartFolders()
	};
}

/**
 * Restore from a BackupFile.
 * mode='replace' — wipe all existing data first, then insert everything from the backup.
 * mode='merge'   — upsert by ID: update matching records, insert new ones; nothing is deleted.
 */
export function importBackup(backup: BackupFile, mode: 'replace' | 'merge'): void {
	const doc = getDoc();
	const fArr = getFolders(doc);
	const lArr = getLists(doc);
	const iArr = getItems(doc);
	const sArr = getSpreadsheets(doc);
	const sfMap = doc.getMap<string>('smart-folders');

	doc.transact(() => {
		if (mode === 'replace') {
			// Clear all arrays and the smart-folders map
			if (fArr.length) fArr.delete(0, fArr.length);
			if (lArr.length) lArr.delete(0, lArr.length);
			if (iArr.length) iArr.delete(0, iArr.length);
			// Clear cell data for every existing sheet before wiping the metadata array
			for (let i = 0; i < sArr.length; i++) {
				const m = sArr.get(i) as Y.Map<unknown>;
				const id = m?.get('id') as string | undefined;
				if (id) getSheetCells(doc, id).clear();
			}
			if (sArr.length) sArr.delete(0, sArr.length);
			sfMap.forEach((_, key) => sfMap.delete(key));

			// Insert folders
			for (const f of backup.folders) {
				if (typeof f !== 'object' || f === null) continue;
				const m = new Y.Map<unknown>();
				for (const [k, v] of Object.entries(f)) m.set(k, v);
				fArr.push([m]);
			}
			// Insert lists
			for (const l of backup.lists) {
				if (typeof l !== 'object' || l === null) continue;
				const m = new Y.Map<unknown>();
				for (const [k, v] of Object.entries(l)) m.set(k, v);
				lArr.push([m]);
			}
			// Insert items
			for (const i of backup.items) {
				if (typeof i !== 'object' || i === null) continue;
				const m = new Y.Map<unknown>();
				for (const [k, v] of Object.entries(i)) m.set(k, v);
				iArr.push([m]);
			}
			// Insert sheets (metadata only — cell data is not backed up)
			for (const s of (backup.sheets ?? [])) {
				if (typeof s !== 'object' || s === null) continue;
				const m = new Y.Map<unknown>();
				for (const [k, v] of Object.entries(s)) m.set(k, v);
				sArr.push([m]);
			}
			// Restore smart folder report assignments
			for (const [name, ids] of Object.entries(backup.smartFolders ?? {})) {
				sfMap.set(name, JSON.stringify(ids));
			}
		} else {
			// Merge: upsert each record by id
			function upsert(arr: Y.Array<Y.Map<unknown>>, record: Record<string, unknown>) {
				if (typeof record !== 'object' || record === null) return;
				const existing = findYMap(arr, record.id as string);
				if (existing) {
					for (const [k, v] of Object.entries(record)) existing.set(k, v);
				} else {
					const m = new Y.Map<unknown>();
					for (const [k, v] of Object.entries(record)) m.set(k, v);
					arr.push([m]);
				}
			}
			for (const f of backup.folders) upsert(fArr, f as unknown as Record<string, unknown>);
			for (const l of backup.lists) upsert(lArr, l as unknown as Record<string, unknown>);
			for (const i of backup.items) upsert(iArr, i as unknown as Record<string, unknown>);
			for (const s of (backup.sheets ?? [])) upsert(sArr, s as unknown as Record<string, unknown>);
			// Merge smart folder report assignments (union of existing + backup)
			for (const [name, ids] of Object.entries(backup.smartFolders ?? {})) {
				if (!Array.isArray(ids)) continue;
				const existing: string[] = (() => { try { return JSON.parse(sfMap.get(name) ?? '[]'); } catch { return []; } })();
				const merged = [...new Set([...existing, ...ids])];
				sfMap.set(name, JSON.stringify(merged));
			}
		}
	});
}
// ─── Spreadsheets ─────────────────────────────────────────────────────────────

export interface SheetMeta {
	id: string;
	name: string;
	folderId: string | null;
	order: number;
	createdAt: string | null;
	updatedAt: string | null;
}

export function readSheets(folderId?: string): SheetMeta[] {
	const all = (getSpreadsheets(getDoc()).toArray() as Y.Map<unknown>[]).map(yMapToSheet);
	return folderId !== undefined ? all.filter((s) => s.folderId === folderId) : all;
}

function yMapToSheet(m: Y.Map<unknown>): SheetMeta {
	return {
		id: m.get('id') as string,
		name: m.get('name') as string,
		folderId: (m.get('folderId') as string | null) ?? null,
		order: (m.get('order') as number) ?? 0,
		createdAt: (m.get('createdAt') as string | null) ?? null,
		updatedAt: (m.get('updatedAt') as string | null) ?? null
	};
}

export function createSheet(name: string, folderId: string | null): string {
	const doc = getDoc();
	const sheets = getSpreadsheets(doc);
	const existing = (sheets.toArray() as Y.Map<unknown>[]).filter((s) => s.get('folderId') === folderId);
	const m = new Y.Map<unknown>();
	const id = uid();
	const now = new Date().toISOString();
	m.set('id', id);
	m.set('name', name);
	m.set('folderId', folderId);
	m.set('order', existing.length);
	m.set('createdAt', now);
	m.set('updatedAt', now);
	sheets.push([m]);
	return id;
}

export function updateSheet(id: string, patch: Partial<Omit<SheetMeta, 'id' | 'createdAt' | 'updatedAt'>>) {
	const doc = getDoc();
	doc.transact(() => {
		const m = findYMap(getSpreadsheets(doc), id);
		if (!m) return;
		for (const [k, v] of Object.entries(patch)) m.set(k, v);
		const keys = Object.keys(patch);
		if (!(keys.length === 1 && keys[0] === 'order')) m.set('updatedAt', new Date().toISOString());
	});
}

export function deleteSheet(id: string) {
	const doc = getDoc();
	doc.transact(() => {
		// Delete cell data for this sheet
		const cells = getSheetCells(doc, id);
		cells.clear();
		removeYMap(getSpreadsheets(doc), id);
	});
}

/** Read all cell values for a sheet as a plain Record. */
export function readCells(sheetId: string): Record<string, string> {
	const cells = getSheetCells(getDoc(), sheetId);
	const result: Record<string, string> = {};
	cells.forEach((v, k) => { result[k] = v; });
	return result;
}

/** Set a single cell value.  key = "R,C" (0-based). Empty string clears the cell. */
export function setCell(sheetId: string, row: number, col: number, value: string) {
	const doc = getDoc();
	const cells = getSheetCells(doc, sheetId);
	const key = `${row},${col}`;
	doc.transact(() => {
		if (value === '') {
			cells.delete(key);
		} else {
			cells.set(key, value);
		}
		// Bump sheet updatedAt
		const m = findYMap(getSpreadsheets(doc), sheetId);
		if (m) m.set('updatedAt', new Date().toISOString());
	});
}