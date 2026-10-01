/**
 * CRUD helpers for folders, lists, and items.
 * All mutations operate on the shared Y.Doc.
 */
import * as Y from 'yjs';
import { getFolders, getLists, getItems, getDoc, getMutableDoc, getSpreadsheets, getSheetCells } from './yjsStore.svelte';
import { removeFromAllReports } from './smartFolders.svelte';
import { readFolderCheckboxes, addCheckbox, renameCheckbox, removeCheckbox, orderCheckboxes, replaceFolderCheckboxes, type FolderCheckbox } from './folderCheckboxes';
import { resolveParentLinks, compareOrder, canReparentItems, selectedRoots } from './hierarchy';
import { readItemName, getItemText, initializeItemText, replaceItemText } from './noteText';
import { readReportAssignments, restoreReportAssignments } from './reportAssignments';
import { validateLocations, normalizeLocationTag, type RetailLocation } from './retailLocations';
import { isStartingLocation, type StartingLocation } from './startingLocation';
import { checklistFingerprint, isNearbyChecklistState, NEARBY_CHECKLIST_MEMBERSHIP_ORIGIN, type NearbyChecklistState } from './nearbyChecklist';

export type { FolderCheckbox } from './folderCheckboxes';

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
	favouriteOrder?: number;
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

export const MAX_FOLDER_CHECKBOXES = 8;

export function readFolders(): Folder[] {
	return resolveParentLinks(getFolders(getDoc()).toArray().map(yMapToFolder));
}

function yMapToFolder(m: Y.Map<unknown>): Folder {
	return {
		id: m.get('id') as string,
		name: m.get('name') as string,
		color: (m.get('color') as string) ?? '#6366f1',
		parentId: (m.get('parentId') as string | null) ?? null,
		order: (m.get('order') as number) ?? 0,
		favouriteOrder: (m.get('favouriteOrder') as number | undefined) ?? (m.get('order') as number) ?? 0,
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
		checkboxes: readFolderCheckboxes(m)
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
	const doc = getMutableDoc();
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
	const doc = getMutableDoc();
	const currentTree = patch.parentId !== undefined ? readFolders() : [];
	if (patch.parentId !== undefined && patch.parentId !== null) {
		if (!readFolders().some((folder) => folder.id === patch.parentId) || isDescendant(id, patch.parentId)) return;
	}
	doc.transact(() => {
		const m = findYMap(getFolders(doc), id);
		if (!m) return;
		// Only an explicit user move materializes a recovered tree. Receiving a
		// partial remote update never writes potentially premature cycle repairs.
		materializeCycles(getFolders(doc), currentTree);
		for (const [k, v] of Object.entries(patch)) {
			if (k === 'checkboxes') replaceFolderCheckboxes(m, patch.checkboxes ?? []);
			else m.set(k, v);
		}
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
	const doc = getMutableDoc();
	let newId: string | null = null;
	doc.transact(() => {
		const m = findYMap(getFolders(doc), folderId);
		if (!m) return;
		const current = readFolderCheckboxes(m);
		if (current.length >= MAX_FOLDER_CHECKBOXES) return;
		if (current.some((c) => c.name.toLowerCase() === trimmed.toLowerCase())) return;
		newId = uid();
		addCheckbox(m, { id: newId, name: trimmed });
		m.set('updatedAt', new Date().toISOString());
	});
	return newId;
}

export function renameFolderCheckbox(folderId: string, checkboxId: string, name: string): boolean {
	const trimmed = sanitizeCheckboxName(name);
	if (!trimmed) return false;
	const doc = getMutableDoc();
	let ok = false;
	doc.transact(() => {
		const m = findYMap(getFolders(doc), folderId);
		if (!m) return;
		const current = readFolderCheckboxes(m);
		const idx = current.findIndex((c) => c.id === checkboxId);
		if (idx === -1) return;
		// Reject if another checkbox already has this name (case-insensitive).
		if (current.some((c, i) => i !== idx && c.name.toLowerCase() === trimmed.toLowerCase())) return;
		renameCheckbox(m, checkboxId, trimmed);
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
	const doc = getMutableDoc();
	doc.transact(() => {
		const m = findYMap(getFolders(doc), folderId);
		if (!m) return;
		removeCheckbox(m, checkboxId);
		m.set('updatedAt', new Date().toISOString());
	});
}

export function moveFolderCheckbox(folderId: string, checkboxId: string, direction: 'up' | 'down'): void {
	const doc = getMutableDoc();
	doc.transact(() => {
		const m = findYMap(getFolders(doc), folderId);
		if (!m) return;
		const current = readFolderCheckboxes(m);
		const idx = current.findIndex((c) => c.id === checkboxId);
		if (idx === -1) return;
		const swapWith = direction === 'up' ? idx - 1 : idx + 1;
		if (swapWith < 0 || swapWith >= current.length) return;
		[current[idx], current[swapWith]] = [current[swapWith], current[idx]];
		orderCheckboxes(m, current);
		m.set('updatedAt', new Date().toISOString());
	});
}

export function deleteFolder(id: string) {
	const doc = getMutableDoc();
	doc.transact(() => _deleteFolderInner(id));
}

function _deleteFolderInner(id: string, visited = new Set<string>()) {
	// Cascade: delete child folders recursively, then lists/items
	if (visited.has(id)) return;
	visited.add(id);
	const doc = getMutableDoc();
	const allFolders = readFolders();
	const childIds = allFolders
		.filter((f) => f.parentId === id)
		.map((f) => f.id);
	for (const cid of childIds) _deleteFolderInner(cid, visited);

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
	const children = readFolders().filter((f) => f.parentId === folderId).map((f) => f.id);
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
	favouriteOrder?: number;
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
		favouriteOrder: (m.get('favouriteOrder') as number | undefined) ?? (m.get('order') as number) ?? 0,
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
	const doc = getMutableDoc();
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
	const doc = getMutableDoc();
	doc.transact(() => {
		const m = findYMap(getLists(doc), id);
		if (!m) return;
		const destination = patch.folderId !== undefined && patch.folderId !== m.get('folderId')
			? findYMap(getFolders(doc), patch.folderId)
			: null;
		for (const [k, v] of Object.entries(patch)) m.set(k, v);
		if (destination) m.set('color', (destination.get('color') as string) ?? '#6366f1');
		const keys = Object.keys(patch);
		if (!(keys.length === 1 && keys[0] === 'order')) m.set('updatedAt', new Date().toISOString());
	});
}

function _deleteListInner(id: string) {
	const doc = getMutableDoc();
	// Delete all items in this list
	const allItems = getItems(doc).toArray() as Y.Map<unknown>[];
	const itemIds = allItems
		.filter((i) => i.get('listId') === id)
		.map((i) => i.get('id') as string);
	for (const iid of itemIds) deleteItem(iid);
	removeYMap(getLists(doc), id);
}

export function deleteList(id: string) {
	getMutableDoc().transact(() => {
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
	return resolveParentLinks(getItems(getDoc()).toArray()
		.filter((m) => m.get('listId') === listId)
		.map(yMapToItem)).sort(compareOrder);
}

export function readAllItems(): Item[] {
	const byList = new Map<string, Item[]>();
	for (const item of getItems(getDoc()).toArray().map(yMapToItem)) {
		const items = byList.get(item.listId) ?? [];
		items.push(item);
		byList.set(item.listId, items);
	}
	return [...byList.values()].flatMap(resolveParentLinks);
}

function yMapToItem(m: Y.Map<unknown>): Item {
	const checks: Record<string, boolean> = {};
	// Also recover backups restored by older versions into the wrong key.
	const legacyChecks = m.get('checks');
	if (legacyChecks && typeof legacyChecks === 'object' && !Array.isArray(legacyChecks)) {
		for (const [id, value] of Object.entries(legacyChecks)) checks[id] = value === true;
	}
	m.forEach((value, key) => {
		if (key.startsWith('chk_')) checks[key.slice(4)] = value === true;
	});
	return {
		id: m.get('id') as string,
		listId: m.get('listId') as string,
		name: readItemName(m.doc!, m),
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
	const doc = getMutableDoc();
	if (!findYMap(getLists(doc), listId)) throw new Error('The destination list no longer exists.');
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
			const orders = siblings.map((sib) => (sib.get('order') as number) ?? 0);
			newOrder = orders.length === 0 ? 0 : addPosition === 'top'
				? orders.reduce((min, order) => Math.min(min, order), Infinity) - 1
				: orders.reduce((max, order) => Math.max(max, order), -Infinity) + 1;
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
		initializeItemText(doc, id, name);
	});
	return id;
}

export function getItemYText(doc: Y.Doc, itemId: string, _fallbackText = ''): Y.Text {
	if (doc !== getMutableDoc()) throw new Error('The note is not in the active document.');
	return getItemText(doc, itemId);
}

export function updateItem(id: string, patch: Partial<Omit<Item, 'id' | 'listId' | 'createdAt' | 'updatedAt' | 'checks'>>) {
	const doc = getMutableDoc();
	const m = findYMap(getItems(doc), id);
	if (!m) return;
	const changes = Object.entries(patch).filter(([key, value]) =>
		key === 'name' ? readItemName(doc, m) !== value : m.get(key) !== value);
	if (changes.length === 0) return;
	// Bootstrap legacy text separately so undoing the edit never removes its base.
	if (changes.some(([key]) => key === 'name')) getItemText(doc, id);
	doc.transact(() => {
		for (const [k, v] of changes) {
			m.set(k, v);
			if (k === 'name') replaceItemText(doc, id, v as string);
		}
		const keys = changes.map(([key]) => key);
		if (!(keys.length === 1 && keys[0] === 'order')) m.set('updatedAt', new Date().toISOString());
	});
}

/** Sets a single named checkbox's state on an item. Stored as its own Yjs key
 *  (`chk_<checkboxId>`) rather than a merged blob so concurrent offline edits
 *  to different checkboxes on the same item don't clobber each other. */
export function setItemCheckboxState(itemId: string, checkboxId: string, value: boolean): void {
	const doc = getMutableDoc();
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
	const doc = getMutableDoc();
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
	removeYMap(getItems(getMutableDoc()), id);
}

function _deleteItemCascadeInner(id: string, visited = new Set<string>()) {
	if (visited.has(id)) return;
	visited.add(id);
	const doc = getMutableDoc();
	const children = (getItems(doc).toArray() as Y.Map<unknown>[])
		.filter((m) => m.get('parentId') === id)
		.map((m) => m.get('id') as string);
	for (const cid of children) _deleteItemCascadeInner(cid, visited);
	removeYMap(getItems(doc), id);
}

export function deleteItemCascade(id: string) {
	getMutableDoc().transact(() => _deleteItemCascadeInner(id));
}

export function deleteItemsBatch(ids: string[]): void {
	getMutableDoc().transact(() => { for (const id of ids) _deleteItemCascadeInner(id); });
}

export function setItemsChecked(ids: string[], checked: boolean): void {
	getMutableDoc().transact(() => { for (const id of ids) updateItem(id, { checked }); });
}

export function createItemsBatch(listId: string, names: string[], addPosition: 'top' | 'bottom' = 'bottom'): void {
	const doc = getMutableDoc();
	doc.transact(() => {
		const existing = getItems(doc).toArray().filter(i => i.get('listId') === listId && (i.get('parentId') ?? null) === null);
		
		const orders = existing.map((item) => (item.get('order') as number) ?? 0);
		const baseOrder = orders.length === 0 ? 0 : addPosition === 'top'
			? orders.reduce((min, order) => Math.min(min, order), Infinity) - names.length
			: orders.reduce((max, order) => Math.max(max, order), -Infinity) + 1;
		names.forEach((name, i) => createItem(listId, name, null, null, false, 'bottom', baseOrder + i));
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
	const doc = getMutableDoc();
	validateRecords(exportedItems, 'items');
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
	const doc = getMutableDoc();
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
	const doc = getMutableDoc();
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
	const doc = getMutableDoc();
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
	const doc = getMutableDoc();
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

export function reparentItems(listId: string, ids: string[], targetId: string | null): boolean {
	const doc = getMutableDoc();
	const items = readItems(listId);
	if (!canReparentItems(items, ids, targetId)) return false;
	const roots = selectedRoots(items, ids);
	let order = items.filter((item) => item.parentId === targetId)
		.reduce((max, item) => Math.max(max, item.order), -1) + 1;
	doc.transact(() => {
		materializeCycles(getItems(doc), items);
		for (const id of roots) updateItem(id, { parentId: targetId, order: order++ });
	});
	return true;
}

export function reorderItems(listId: string, fromIndex: number, toIndex: number) {
	const doc = getMutableDoc();
	const items = readItems(listId);
	if (fromIndex < 0 || fromIndex >= items.length || toIndex < 0 || toIndex >= items.length) return;
	const [moved] = items.splice(fromIndex, 1);
	items.splice(toIndex, 0, moved);
	doc.transact(() => items.forEach((item, idx) => updateItem(item.id, { order: idx })));
}

export function reorderSiblings(listId: string, parentId: string | null, fromIdx: number, toIdx: number) {
	const doc = getMutableDoc();
	const siblings = readItems(listId)
		.filter((i) => i.parentId === parentId)
		.sort(compareOrder);
	if (fromIdx < 0 || fromIdx >= siblings.length || toIdx < 0 || toIdx >= siblings.length) return;
	const [moved] = siblings.splice(fromIdx, 1);
	siblings.splice(toIdx, 0, moved);
	doc.transact(() => siblings.forEach((item, idx) => updateItem(item.id, { order: idx })));
}

export function reorderFolders(parentId: string | null, fromIndex: number, toIndex: number, visibleIds?: string[]) {
	const doc = getMutableDoc();
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
	const doc = getMutableDoc();
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
	const doc = getMutableDoc();
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

export function getMaxFavouriteOrder(): number {
	const folders = readFolders().filter((f) => f.favourite);
	const lists = readLists().filter((l) => l.favourite);
	let max = -1;
	for (const f of folders) {
		const fo = f.favouriteOrder ?? 0;
		if (fo > max) max = fo;
	}
	for (const l of lists) {
		const fo = l.favouriteOrder ?? 0;
		if (fo > max) max = fo;
	}
	return max;
}

export function saveFavouritesOrder(items: { id: string; type: 'folder' | 'list' }[]) {
	const doc = getMutableDoc();
	doc.transact(() => {
		items.forEach((item, idx) => {
			if (item.type === 'folder') {
				updateFolder(item.id, { favouriteOrder: idx });
			} else {
				updateList(item.id, { favouriteOrder: idx });
			}
		});
	});
}

export function reorderFavourites(items: { id: string; type: 'folder' | 'list' }[], fromIndex: number, toIndex: number) {
	const doc = getMutableDoc();
	const reordered = [...items];
	const [moved] = reordered.splice(fromIndex, 1);
	reordered.splice(toIndex, 0, moved);

	doc.transact(() => {
		reordered.forEach((item, idx) => {
			if (item.type === 'folder') {
				updateFolder(item.id, { favouriteOrder: idx });
			} else {
				updateList(item.id, { favouriteOrder: idx });
			}
		});
	});
}

/**
 * Returns all non-archived lists in the order the user would encounter them
 * by navigating the folder tree depth-first (respecting each folder's foldersFirst setting).
 */
export function readListsInTreeOrder(folders?: Folder[], lists?: ListMeta[]): ListMeta[] {
	const allFolders = resolveParentLinks(folders ?? readFolders());
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
			if (item._type === 'folder') visit(item.id, visited);
			else result.push(item as unknown as ListMeta);
		}
	}

	visit(null);
	return result;
}

// ─── Internal utilities ───────────────────────────────────────────────────────

function materializeCycles(arr: Y.Array<Y.Map<unknown>>, tree: { id: string; parentId: string | null }[]) {
	const ids = new Set(tree.map((node) => node.id));
	const records = new Map(arr.toArray().map((record) => [record.get('id'), record]));
	for (const node of tree) {
		const record = records.get(node.id);
		const parent = record?.get('parentId') as string | undefined;
		// Missing parents may simply not have synced yet. Only persist cycle
		// breaks, never orphan recovery, during an explicit user move.
		if (record && parent && ids.has(parent) && parent !== node.parentId) record.set('parentId', node.parentId);
	}
}

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
	items: Item[];
	sheets?: SheetMeta[];
	smartFolders?: Record<string, string[]>;
	customLocations?: RetailLocation[];
	startingLocation?: StartingLocation | null;
	nearbyChecklist?: Record<string, NearbyChecklistState>;
	pausedErrandTags?: string[];
}

/** Serialise the entire doc to a plain JS object ready to JSON.stringify. */
export function exportBackup(): BackupFile {
	return {
		version: 1,
		exported: new Date().toISOString(),
		folders: readFolders(),
		lists: readLists(),
		items: readAllItems(),
		sheets: readSheets(),
		smartFolders: readReportAssignments(getDoc()),
		customLocations: readCustomLocations(),
		startingLocation: readStartingLocation(),
		nearbyChecklist: readNearbyChecklist(),
		pausedErrandTags: readPausedErrandTags()
	};
}

/** Yjs transactions do not roll back on an exception. Validate the entire
 * import before clearing or inserting anything, including optional sections. */
function validateRecords(records: unknown, kind: string): asserts records is Record<string, unknown>[] {
	if (!Array.isArray(records)) throw new Error(`Invalid ${kind} in import.`);
	const ids = new Set<string>();
	for (const record of records) {
		if (!record || typeof record !== 'object' || Array.isArray(record) || typeof record.id !== 'string' || !record.id || typeof record.name !== 'string' || ids.has(record.id)) {
			throw new Error(`Invalid or duplicate ${kind} record.`);
		}
		ids.add(record.id);
		if (record.parentId != null && typeof record.parentId !== 'string') throw new Error('Invalid parent id.');
		if (record.checks !== undefined && (!record.checks || typeof record.checks !== 'object' || Array.isArray(record.checks) || Object.values(record.checks).some((value) => typeof value !== 'boolean'))) throw new Error('Invalid checkbox states.');
		if (record.checkboxes !== undefined && (!Array.isArray(record.checkboxes) || record.checkboxes.some((box: FolderCheckbox) => !box || typeof box.id !== 'string' || typeof box.name !== 'string'))) throw new Error('Invalid checkbox definitions.');
		if (record.checkedNames !== undefined && (!Array.isArray(record.checkedNames) || record.checkedNames.some((name: unknown) => typeof name !== 'string'))) throw new Error('Invalid checkbox names.');
		for (const key of ['price', 'qty', 'order', 'favouriteOrder']) {
			if (record[key] != null && (typeof record[key] !== 'number' || !Number.isFinite(record[key]))) throw new Error(`Invalid ${key}.`);
		}
	}
}

/**
 * Restore from a BackupFile.
 * mode='replace' — wipe all existing data first, then insert everything from the backup.
 * mode='merge'   — upsert by ID: update matching records, insert new ones; nothing is deleted.
 */
export function importBackup(backup: BackupFile, mode: 'replace' | 'merge'): void {
	const doc = getMutableDoc();
	if (!backup || backup.version !== 1 || (mode !== 'merge' && mode !== 'replace')) throw new Error('Invalid backup.');
	validateRecords(backup.folders, 'folders');
	validateRecords(backup.lists, 'lists');
	validateRecords(backup.items, 'items');
	validateRecords(backup.sheets ?? [], 'sheets');
	validateLocations(backup.customLocations ?? []);
	if (backup.pausedErrandTags !== undefined && (!Array.isArray(backup.pausedErrandTags) || backup.pausedErrandTags.some(tag => typeof tag !== 'string' || !/^#?\w+$/.test(tag)))) throw new Error('Invalid paused errand tags.');
	if (backup.startingLocation != null && !isStartingLocation(backup.startingLocation)) throw new Error('Invalid starting location.');
	if (backup.nearbyChecklist !== undefined && (!backup.nearbyChecklist || typeof backup.nearbyChecklist !== 'object' || Array.isArray(backup.nearbyChecklist) || Object.entries(backup.nearbyChecklist).some(([id, state]) => !id || !isNearbyChecklistState(state)))) throw new Error('Invalid nearby checklist.');
	if (backup.customLocations?.some(location => !location.id.startsWith('custom-'))) throw new Error('Custom location ids must start with custom-.');
	if (backup.smartFolders != null && (typeof backup.smartFolders !== 'object' || Array.isArray(backup.smartFolders))) throw new Error('Invalid reports.');
	for (const ids of Object.values(backup.smartFolders ?? {})) {
		if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) throw new Error('Invalid report assignments.');
	}
	const fArr = getFolders(doc);
	const lArr = getLists(doc);
	const iArr = getItems(doc);
	const sArr = getSpreadsheets(doc);

	// Undo needs an authoritative pre-import baseline even for legacy notes
	// that have never been opened. Migration itself is not an undo action.
	for (const item of backup.items) {
		if (findYMap(iArr, item.id)) getItemText(doc, item.id);
	}

	doc.transact(() => {
		if (mode === 'replace') {
			if (fArr.length) fArr.delete(0, fArr.length);
			if (lArr.length) lArr.delete(0, lArr.length);
			if (iArr.length) iArr.delete(0, iArr.length);
			for (const key of doc.share.keys()) {
				if (key.startsWith('note_text_')) {
					const text = doc.getText(key);
					text.delete(0, text.length);
				}
				if (key.startsWith('sheet-cells-')) doc.getMap(key).clear();
			}
			doc.getMap('note-text-initialized').clear();
			if (sArr.length) sArr.delete(0, sArr.length);
		}
		function upsert(arr: Y.Array<Y.Map<unknown>>, record: Record<string, unknown>, kind: 'folder' | 'item' | 'other') {
			let m = findYMap(arr, record.id as string);
			if (!m) {
				m = new Y.Map<unknown>();
				arr.push([m]);
			}
			for (const [key, value] of Object.entries(record)) {
				if (key !== 'checks' && key !== 'checkboxes') m.set(key, value);
			}
			if (kind === 'folder' && record.checkboxes !== undefined) replaceFolderCheckboxes(m, record.checkboxes as FolderCheckbox[]);
			if (kind === 'item') {
				if (record.checks !== undefined) {
					m.delete('checks');
					for (const key of [...m.keys()]) if (key.startsWith('chk_')) m.delete(key);
					for (const [id, value] of Object.entries(record.checks as Record<string, boolean>)) m.set(`chk_${id}`, value);
				}
				replaceItemText(doc, record.id as string, record.name as string);
			}
		}
		for (const record of backup.folders) upsert(fArr, record as unknown as Record<string, unknown>, 'folder');
		for (const record of backup.lists) upsert(lArr, record as unknown as Record<string, unknown>, 'other');
		for (const record of backup.items) upsert(iArr, record as unknown as Record<string, unknown>, 'item');
		for (const record of backup.sheets ?? []) upsert(sArr, record as unknown as Record<string, unknown>, 'other');
		restoreReportAssignments(doc, backup.smartFolders ?? {}, mode === 'replace');
		const locations = doc.getMap<RetailLocation>('custom-locations');
		if (mode === 'replace') locations.clear();
		for (const location of backup.customLocations ?? []) locations.set(location.id, { ...location, tags: [...location.tags] });
		const preferences = doc.getMap('nearby-preferences');
		if (backup.startingLocation != null) preferences.set('starting-location', { ...backup.startingLocation });
		else if (mode === 'replace' || backup.startingLocation === null) preferences.delete('starting-location');
		const checklist = doc.getMap<NearbyChecklistState>('nearby-checklist');
		if (mode === 'replace') checklist.clear();
		for (const [id, state] of Object.entries(backup.nearbyChecklist ?? {})) checklist.set(id, { ...state });
		const pausedTags = doc.getMap<boolean>('paused-errand-tags');
		if (mode === 'replace') pausedTags.clear();
		for (const tag of backup.pausedErrandTags ?? []) pausedTags.set(normalizeLocationTag(tag), true);
	});
}

export function readPausedErrandTags(): string[] {
	return [...getDoc().getMap<boolean>('paused-errand-tags')]
		.filter(([tag, paused]) => paused === true && /^\w+$/.test(tag))
		.map(([tag]) => tag).sort();
}

export function setErrandTagPaused(tag: string, paused: boolean): void {
	const normalized = normalizeLocationTag(tag);
	if (!/^\w+$/.test(normalized)) throw new Error('Invalid errand tag.');
	const tags = getMutableDoc().getMap<boolean>('paused-errand-tags');
	if (paused) tags.set(normalized, true);
	else tags.delete(normalized);
}

export function readNearbyChecklist(): Record<string, NearbyChecklistState> {
	return Object.fromEntries([...getDoc().getMap<NearbyChecklistState>('nearby-checklist')].filter(([, state]) => isNearbyChecklistState(state)).map(([id, state]) => [id, { ...state }]));
}

/** Content, metadata, inherited tags and rich-text formatting all count as changes. */
export function nearbyItemFingerprint(item: Item, list: ListMeta, folder: Folder | undefined): string {
	const text = getDoc().share.get(`note_text_${item.id}`);
	const { order: _order, ...content } = item;
	return checklistFingerprint({ item: content, listName: list.name, done: !item.note && isItemDone(item, folder), text: text instanceof Y.Text ? text.toDelta() : item.name });
}

export function rememberNearbyChecklist(entries: { id: string; fingerprint: string }[]): void {
	const doc = getMutableDoc();
	const checklist = doc.getMap<NearbyChecklistState>('nearby-checklist');
	const newEntries = entries.filter(entry => {
		const state = checklist.get(entry.id);
		return !state || (state.dismissed && state.fingerprint !== entry.fingerprint);
	});
	if (!newEntries.length) return;
	doc.transact(() => {
		for (const entry of newEntries) checklist.set(entry.id, { fingerprint: entry.fingerprint, dismissed: false });
	}, NEARBY_CHECKLIST_MEMBERSHIP_ORIGIN);
}

export function dismissNearbyChecklist(entries: { id: string; fingerprint: string }[]): void {
	const doc = getMutableDoc();
	doc.transact(() => {
		const checklist = doc.getMap<NearbyChecklistState>('nearby-checklist');
		for (const entry of entries) checklist.set(entry.id, { fingerprint: entry.fingerprint, dismissed: true });
	});
}

/** Match ListScreen's quick completion toggle, including named folder checkboxes. */
export function setNearbyTodoDone(id: string, done: boolean): void {
	getMutableDoc();
	const item = readAllItems().find(item => item.id === id);
	if (!item || item.note || item.heading) return;
	const list = readLists().find(list => list.id === item.listId);
	const folder = readFolders().find(folder => folder.id === list?.folderId);
	if (list && !isItemDone(item, folder)) rememberNearbyChecklist([{ id, fingerprint: nearbyItemFingerprint(item, list, folder) }]);
	const boxes = folder?.checkboxes ?? [];
	if (boxes.length) setItemCheckboxState(id, boxes[boxes.length - 1].id, done);
	else updateItem(id, { checked: done });
}

export function readCustomLocations(): RetailLocation[] {
	return [...getDoc().getMap<RetailLocation>('custom-locations').values()].map(location => ({ ...location, tags: [...location.tags] }));
}

export function saveCustomLocation(location: RetailLocation): void {
	validateLocations([location]);
	if (!location.id.startsWith('custom-')) throw new Error('Custom location ids must start with custom-.');
	getMutableDoc().getMap<RetailLocation>('custom-locations').set(location.id, {
		...location, name: location.name.trim(), tags: [...new Set(location.tags.map(normalizeLocationTag))]
	});
}

export function deleteCustomLocation(id: string): void {
	getMutableDoc().getMap('custom-locations').delete(id);
}

export function readStartingLocation(): StartingLocation | null {
	const location = getDoc().getMap('nearby-preferences').get('starting-location');
	return isStartingLocation(location) ? location : null;
}

export function saveStartingLocation(location: StartingLocation): void {
	if (!isStartingLocation(location)) throw new Error('Invalid starting location.');
	// A single value keeps coordinates and metadata together when devices update concurrently.
	getMutableDoc().getMap('nearby-preferences').set('starting-location', { ...location });
}

export function clearStartingLocation(): void {
	getMutableDoc().getMap('nearby-preferences').delete('starting-location');
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
	const doc = getMutableDoc();
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
	const doc = getMutableDoc();
	doc.transact(() => {
		const m = findYMap(getSpreadsheets(doc), id);
		if (!m) return;
		for (const [k, v] of Object.entries(patch)) m.set(k, v);
		const keys = Object.keys(patch);
		if (!(keys.length === 1 && keys[0] === 'order')) m.set('updatedAt', new Date().toISOString());
	});
}

export function deleteSheet(id: string) {
	const doc = getMutableDoc();
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
	const doc = getMutableDoc();
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
