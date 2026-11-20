/**
 * CRUD helpers for folders, lists, and items.
 * All mutations operate on the shared Y.Doc.
 */
import * as Y from 'yjs';
import { getFolders, getLists, getItems, getListFolders, getDoc, getMutableDoc, getSpreadsheets, getSheetCells } from './yjsStore.svelte';
import { removeFromAllReports } from './smartFolders.svelte';
import { readFolderCheckboxes, addCheckbox, renameCheckbox, removeCheckbox, orderCheckboxes, replaceFolderCheckboxes, type FolderCheckbox } from './folderCheckboxes';
import { readFolderDefaultItems, isFolderDefaultItems, addDefaultItem, updateDefaultItem, removeDefaultItem, orderDefaultItems, replaceFolderDefaultItems, type FolderDefaultItem } from './folderDefaultItems';
import { resolveParentLinks, compareOrder, getInsertionOrder } from './hierarchy';
import { planItemMove, planListEntryMove, type ItemMoveDestination } from './itemMove';
import { listFolderDescendants } from './listFolders';
import { readItemName, getItemText, hasItemText, initializeItemText, replaceItemText, readItemRichText, replaceItemRichText, type RichTextOperation } from './noteText';
import { validateRecords, orderParentFirst, isRecord, MAX_BACKUP_BYTES } from './jsonImport';
import { readReportAssignments, restoreReportAssignments } from './reportAssignments';
import { validateLocations, normalizeLocationTag, type RetailLocation } from './retailLocations';
import { isStartingLocation, type StartingLocation } from './startingLocation';
import { defaultHotSuburbIds, isHotSuburbIds } from './hotSuburbs';
import { checklistFingerprint, isNearbyChecklistState, NEARBY_CHECKLIST_MEMBERSHIP_ORIGIN, type NearbyChecklistState } from './nearbyChecklist';
import { importNameKey } from './importText';
import { isIncludedErrandId } from './includeEntries';
import { readRequest as readDokuWikiRequest, readStatus as readDokuWikiStatus, type DokuWikiRequest, type DokuWikiStatus } from './dokuwikiWriter';

export type { FolderCheckbox } from './folderCheckboxes';
export type { FolderDefaultItem } from './folderDefaultItems';

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
	favouriteParentId?: string | null;
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
	/** Templates copied into new lists directly inside this folder. */
	defaultItems?: FolderDefaultItem[];
}

export const MAX_FOLDER_CHECKBOXES = 8;

export function readFolders(): Folder[] {
	return resolveParentLinks(getFolders(getDoc()).toArray().map(yMapToFolder));
}

function yMapToFolder(m: Y.Map<unknown>): Folder {
	const favouriteParentId = m.get('favouriteParentId') as string | null | undefined;
	return {
		id: m.get('id') as string,
		name: m.get('name') as string,
		color: (m.get('color') as string) ?? '#6366f1',
		parentId: (m.get('parentId') as string | null) ?? null,
		order: (m.get('order') as number) ?? 0,
		favouriteOrder: (m.get('favouriteOrder') as number | undefined) ?? (m.get('order') as number) ?? 0,
		...(favouriteParentId !== undefined ? { favouriteParentId } : {}),
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
		checkboxes: readFolderCheckboxes(m),
		defaultItems: readFolderDefaultItems(m)
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

export function updateFolder(id: string, patch: Partial<Omit<Folder, 'id' | 'createdAt' | 'updatedAt'>>, options: { colorChildren?: boolean } = {}) {
	const doc = getMutableDoc();
	if (patch.defaultItems !== undefined && !isFolderDefaultItems(patch.defaultItems)) throw new Error('Invalid default items.');
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
			else if (k === 'defaultItems') replaceFolderDefaultItems(m, patch.defaultItems ?? []);
			else m.set(k, v);
		}
		const keys = Object.keys(patch);
		if (!(keys.length === 1 && keys[0] === 'order')) m.set('updatedAt', new Date().toISOString());
		if (options.colorChildren && patch.color !== undefined) {
			const now = new Date().toISOString();
			const children = [
				...getFolders(doc).toArray().filter((folder) => folder.get('parentId') === id),
				...getLists(doc).toArray().filter((list) => list.get('folderId') === id)
			];
			for (const child of children) {
				child.set('color', patch.color);
				child.set('updatedAt', now);
			}
		}
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

// ─── Default items (per folder) ────────────────────────────────────────────────

export function addFolderDefaultItem(folderId: string, name: string, note = false): string | null {
	const doc = getMutableDoc();
	const trimmed = name.trim();
	if (!trimmed || typeof note !== 'boolean') return null;
	const folder = findYMap(getFolders(doc), folderId);
	if (!folder) return null;
	const id = uid();
	doc.transact(() => {
		addDefaultItem(folder, { id, name: trimmed, note });
		folder.set('updatedAt', new Date().toISOString());
	});
	return id;
}

export function updateFolderDefaultItem(folderId: string, id: string, patch: Partial<Pick<FolderDefaultItem, 'name' | 'note'>>): boolean {
	const doc = getMutableDoc();
	if (patch.name !== undefined && !patch.name.trim()) return false;
	if (patch.note !== undefined && typeof patch.note !== 'boolean') return false;
	const folder = findYMap(getFolders(doc), folderId);
	const current = folder && readFolderDefaultItems(folder).find(item => item.id === id);
	if (!folder || !current) return false;
	const changes: Partial<Pick<FolderDefaultItem, 'name' | 'note'>> = {};
	if (patch.name !== undefined && patch.name.trim() !== current.name) changes.name = patch.name.trim();
	if (patch.note !== undefined && patch.note !== current.note) changes.note = patch.note;
	if (Object.keys(changes).length) doc.transact(() => {
		updateDefaultItem(folder, id, changes);
		folder.set('updatedAt', new Date().toISOString());
	});
	return true;
}

export function removeFolderDefaultItem(folderId: string, id: string): void {
	const doc = getMutableDoc();
	const folder = findYMap(getFolders(doc), folderId);
	if (!folder || !readFolderDefaultItems(folder).some(item => item.id === id)) return;
	doc.transact(() => {
		removeDefaultItem(folder, id);
		folder.set('updatedAt', new Date().toISOString());
	});
}

export function moveFolderDefaultItem(folderId: string, id: string, direction: 'up' | 'down'): void {
	const doc = getMutableDoc();
	const folder = findYMap(getFolders(doc), folderId);
	if (!folder) return;
	const current = readFolderDefaultItems(folder);
	const index = current.findIndex(item => item.id === id);
	const target = direction === 'up' ? index - 1 : index + 1;
	if (index < 0 || target < 0 || target >= current.length) return;
	[current[index], current[target]] = [current[target], current[index]];
	doc.transact(() => {
		orderDefaultItems(folder, current);
		folder.set('updatedAt', new Date().toISOString());
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
	favouriteParentId?: string | null;
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
	const favouriteParentId = m.get('favouriteParentId') as string | null | undefined;
	return {
		id: m.get('id') as string,
		name: m.get('name') as string,
		color: (m.get('color') as string) ?? '#6366f1',
		folderId: m.get('folderId') as string,
		type: (m.get('type') as 'plain' | 'priced' | 'divider') ?? 'plain',
		order: (m.get('order') as number) ?? 0,
		favouriteOrder: (m.get('favouriteOrder') as number | undefined) ?? (m.get('order') as number) ?? 0,
		...(favouriteParentId !== undefined ? { favouriteParentId } : {}),
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
	folderId: string | null,
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
		const folder = folderId ? findYMap(getFolders(doc), folderId) : null;
		if (folder && type !== 'divider') {
			readFolderDefaultItems(folder).forEach((item, index) => {
				createItem(id, item.name, null, null, item.note, 'bottom', index);
			});
		}
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
	deleteListFolderRecords(doc, new Set(readListFolders(id).map(folder => folder.id)));
	removeYMap(getLists(doc), id);
}

export function deleteList(id: string) {
	getMutableDoc().transact(() => {
		_deleteListInner(id);
		removeFromAllReports(id);
	});
}

// ─── Items ────────────────────────────────────────────────────────────────────

export interface ListFolder {
	id: string;
	listId: string;
	parentId: string | null;
	name: string;
	order: number;
	filterView: FilterView;
	createdAt: string | null;
	updatedAt: string | null;
}

export function readListFolders(listId?: string): ListFolder[] {
	const byList = new Map<string, ListFolder[]>();
	for (const record of getListFolders(getDoc()).toArray()) {
		const owner = record.get('listId') as string;
		if (listId !== undefined && owner !== listId) continue;
		const folders = byList.get(owner) ?? [];
		folders.push({
			id: record.get('id') as string,
			listId: owner,
			parentId: (record.get('parentId') as string | undefined) ?? null,
			name: record.get('name') as string,
			order: (record.get('order') as number | undefined) ?? 0,
			filterView: (record.get('filterView') as FilterView | undefined) ?? 'all',
			createdAt: (record.get('createdAt') as string | undefined) ?? null,
			updatedAt: (record.get('updatedAt') as string | undefined) ?? null
		});
		byList.set(owner, folders);
	}
	return [...byList.values()].flatMap(resolveParentLinks).sort(compareOrder);
}

/** Callers use this for root-level items and folders, which share an order. */
function listRootEntries(listId: string, listFolderId: string | null) {
	return [
		...readItems(listId, listFolderId).filter(item => item.parentId === null),
		...readListFolders(listId).filter(folder => folder.parentId === listFolderId)
	];
}

function requireListFolder(doc: Y.Doc, listId: string, listFolderId: string | null) {
	if (listFolderId !== null && findYMap(getListFolders(doc), listFolderId)?.get('listId') !== listId) {
		throw new Error('The destination folder no longer exists in this list.');
	}
}

export function createListFolder(listId: string, name: string, parentId: string | null = null, position: 'top' | 'bottom' = 'bottom', explicitOrder?: number): string {
	const doc = getMutableDoc();
	const list = findYMap(getLists(doc), listId);
	if (!list || list.get('type') === 'divider') throw new Error('The destination list does not accept folders.');
	requireListFolder(doc, listId, parentId);
	if (!name.trim()) throw new Error('Enter a folder name.');
	const id = uid();
	const now = new Date().toISOString();
	const order = explicitOrder ?? getInsertionOrder(listRootEntries(listId, parentId), position);
	const record = new Y.Map<unknown>();
	for (const [key, value] of Object.entries({ id, listId, parentId, name: name.trim(), order, createdAt: now, updatedAt: now })) record.set(key, value);
	getListFolders(doc).push([record]);
	return id;
}

export function updateListFolder(id: string, patch: Partial<Pick<ListFolder, 'name' | 'filterView' | 'order'>>) {
	const doc = getMutableDoc();
	const record = findYMap(getListFolders(doc), id);
	if (!record || (patch.name !== undefined && !patch.name.trim())) return;
	doc.transact(() => {
		for (const [key, value] of Object.entries(patch)) record.set(key, value);
		if (patch.name !== undefined) record.set('updatedAt', new Date().toISOString());
	});
}

function deleteListFolderRecords(doc: Y.Doc, ids: Set<string>) {
	const records = getListFolders(doc);
	const entries = records.toArray();
	for (let index = entries.length - 1; index >= 0; index--) {
		if (ids.has(entries[index].get('id') as string)) records.delete(index);
	}
}

export function deleteListEntries(listId: string, ids: string[]) {
	const doc = getMutableDoc();
	const folderIds = listFolderDescendants(readListFolders(listId), ids);
	const items = readItems(listId);
	const selected = new Set(ids);
	const itemIds = items.filter(item => selected.has(item.id) || (item.listFolderId && folderIds.has(item.listFolderId))).map(item => item.id);
	doc.transact(() => {
		deleteItemsBatch(itemIds);
		deleteListFolderRecords(doc, folderIds);
	});
}

export interface Item {
	id: string;
	listId: string;
	listFolderId?: string | null;
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
	/** DokuWiki writer request (client) and outcome (server); see dokuwikiWriter.ts. */
	dokuwiki?: DokuWikiRequest | null;
	dokuwikiStatus?: DokuWikiStatus | null;
}

export function readItems(listId: string, listFolderId?: string | null): Item[] {
	const folders = new Set(readListFolders(listId).map(folder => folder.id));
	const items = resolveItemLocations(getItems(getDoc()).toArray()
		.filter((m) => m.get('listId') === listId)
		.map(yMapToItem), folders);
	return (listFolderId === undefined ? items : items.filter(item => (item.listFolderId ?? null) === listFolderId)).sort(compareOrder);
}

export function readAllItems(): Item[] {
	const byList = new Map<string, Item[]>();
	const foldersByList = new Map<string, Set<string>>();
	for (const folder of readListFolders()) {
		const ids = foldersByList.get(folder.listId) ?? new Set<string>();
		ids.add(folder.id);
		foldersByList.set(folder.listId, ids);
	}
	for (const item of getItems(getDoc()).toArray().map(yMapToItem)) {
		const items = byList.get(item.listId) ?? [];
		items.push(item);
		byList.set(item.listId, items);
	}
	return [...byList].flatMap(([listId, items]) => resolveItemLocations(items, foldersByList.get(listId)));
}

function resolveItemLocations(items: Item[], folders?: Set<string>): Item[] {
	// Resolve task ancestry first. If concurrent changes leave a child with an
	// older location, its still-valid parent determines where it is shown.
	const ordered = orderParentFirst(resolveParentLinks(items));
	const orderedById = new Map(ordered.map(item => [item.id, item]));
	const locations = new Map<string, string | null>();
	for (const item of ordered) {
		const location = item.parentId !== null ? locations.get(item.parentId) ?? null
			: item.listFolderId && folders?.has(item.listFolderId) ? item.listFolderId : null;
		locations.set(item.id, location);
	}
	return items.map(item => {
		const resolved = orderedById.get(item.id)!;
		return { ...resolved, listFolderId: locations.get(item.id) ?? null };
	});
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
		listFolderId: (m.get('listFolderId') as string | undefined) ?? null,
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
		checks,
		dokuwiki: readDokuWikiRequest(m),
		dokuwikiStatus: readDokuWikiStatus(m)
	};
}

export function createItem(listId: string, name: string, price: number | null = null, parentId: string | null = null, note = false, addPosition: 'top' | 'bottom' = 'bottom', explicitOrder?: number, listFolderId: string | null = null): string {
	const doc = getMutableDoc();
	if (!findYMap(getLists(doc), listId)) throw new Error('The destination list no longer exists.');
	if (parentId !== null) {
		const parent = readItems(listId).find(item => item.id === parentId);
		// A parent at the list root has a null folder, which must win.
		if (parent) listFolderId = parent.listFolderId ?? null;
	}
	requireListFolder(doc, listId, listFolderId);
	const id = uid();
	const now = new Date().toISOString();
	doc.transact(() => {
		const items = getItems(doc);
		const newOrder = explicitOrder ?? getInsertionOrder(parentId === null
			? listRootEntries(listId, listFolderId)
			: readItems(listId, listFolderId).filter(item => item.parentId === parentId), addPosition);
		const m = new Y.Map<unknown>();
		m.set('id', id);
		m.set('listId', listId);
		if (listFolderId !== null) m.set('listFolderId', listFolderId);
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

export function createItemsBatch(listId: string, names: string[], addPosition: 'top' | 'bottom' = 'bottom', listFolderId: string | null = null): void {
	const doc = getMutableDoc();
	doc.transact(() => {
		const baseOrder = getInsertionOrder(listRootEntries(listId, listFolderId), addPosition, names.length);
		names.forEach((name, i) => createItem(listId, name, null, null, false, 'bottom', baseOrder + i, listFolderId));
	});
}

export interface ExportedItem {
	id: string;
	name: string;
	folder?: boolean;
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
	fullScreen?: boolean;
	richText?: RichTextOperation[];
	parentId?: string | null;
}

/** Import exported items or parsed clipboard todos, preserving attributes and
 * hierarchy even when children appear before their parents. */
export function createItemsFromExport(listId: string, exportedItems: ExportedItem[], options: { addPosition?: 'top' | 'bottom'; skipExisting?: boolean; listFolderId?: string | null } = {}): void {
	const doc = getMutableDoc();
	validateRecords(exportedItems, 'clipboardItems');
	const listFolderId = options.listFolderId ?? null;
	requireListFolder(doc, listId, listFolderId);
	const exportedById = new Map(exportedItems.map(item => [item.id, item]));
	if (exportedItems.some(item => item.folder && item.parentId && exportedById.has(item.parentId) && !exportedById.get(item.parentId)?.folder)) {
		throw new Error('A folder must belong to a list or another folder.');
	}
	const idMap = new Map<string, string>(); // old id → new id
	const existing = readItems(listId, listFolderId);
	const existingNames = new Map<string, string>();
	if (options.skipExisting) {
		for (const item of existing) {
			const key = importNameKey(item.name);
			if (!existingNames.has(key)) existingNames.set(key, item.id);
		}
		// Children of a skipped duplicate still belong to the existing parent.
		for (const ex of exportedItems) {
			if (ex.folder || (ex.parentId && exportedById.get(ex.parentId)?.folder)) continue;
			const existingId = existingNames.get(importNameKey(ex.name));
			if (existingId) idMap.set(ex.id, existingId);
		}
	}
	const nextOrders = new Map<string | null, number>();
	const list = readLists().find((l) => l.id === listId);
	if (!list) throw new Error('The destination list no longer exists.');
	if (list.type === 'divider' && exportedItems.some(item => item.folder)) throw new Error('The destination list does not accept folders.');
	const folder = list ? readFolders().find((f) => f.id === list.folderId) : undefined;
	const checkboxes = folder?.checkboxes ?? [];
	doc.transact(() => {
		for (const ex of orderParentFirst<ExportedItem>(exportedItems)) {
			if (idMap.has(ex.id)) continue;
			const mappedParent = ex.parentId ? (idMap.get(ex.parentId) ?? null) : null;
			const parentIsFolder = Boolean(ex.parentId && exportedById.get(ex.parentId)?.folder);
			const resolvedParentId = parentIsFolder ? null : mappedParent;
			const destinationFolderId = parentIsFolder ? mappedParent : listFolderId;
			let order: number | undefined;
			if (options.addPosition === 'top') {
				const destination = resolvedParentId ?? destinationFolderId;
				order = nextOrders.get(destination);
				if (order === undefined) {
					const siblings = resolvedParentId === null ? listRootEntries(listId, destinationFolderId)
						: existing.filter(item => item.parentId === resolvedParentId);
					order = getInsertionOrder(siblings, 'top', exportedItems.length);
				}
				nextOrders.set(destination, order + 1);
			}
			if (ex.folder) {
				idMap.set(ex.id, createListFolder(listId, ex.name, destinationFolderId, 'bottom', order));
				continue;
			}
			const newId = createItem(listId, ex.name, ex.price ?? null, resolvedParentId, ex.note ?? false, 'bottom', order, destinationFolderId);
			idMap.set(ex.id, newId);
			const patch: Partial<Omit<Item, 'id' | 'listId' | 'createdAt' | 'updatedAt' | 'checks'>> = {};
			if (ex.qty != null) patch.qty = ex.qty;
			if (ex.checked) patch.checked = true;
			if (ex.heading) patch.heading = true;
			if (ex.pinned) patch.pinned = true;
			if (ex.fullScreen) patch.fullScreen = true;
			if (Object.keys(patch).length > 0) updateItem(newId, patch);
			if (ex.richText !== undefined) replaceItemRichText(doc, newId, ex.name, ex.richText);
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
		readItems(listId, null)
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

/** Move existing records, including descendants, while retaining IDs and note texts. */
export function moveItemsToDestination(sourceListId: string, ids: string[], destination: ItemMoveDestination, addPosition: 'top' | 'bottom' = 'bottom'): boolean {
	return moveListEntries(sourceListId, ids, destination, addPosition, false);
}

function moveListEntries(sourceListId: string, ids: string[], destination: ItemMoveDestination, addPosition: 'top' | 'bottom', allowArchived: boolean): boolean {
	const doc = getMutableDoc();
	const lists = readLists();
	const folders = readFolders();
	const sourceList = lists.find((list) => list.id === sourceListId);
	const targetList = lists.find((list) => list.id === destination.listId);
	if (!sourceList || !targetList || targetList.type === 'divider' || (!allowArchived && isListEffectivelyArchived(targetList, folders))) return false;
	const sourceFolder = folders.find((folder) => folder.id === sourceList.folderId);
	const targetFolder = folders.find((folder) => folder.id === targetList.folderId);
	const crossList = sourceListId !== destination.listId;
	const source = readItems(sourceListId);
	const sourceById = new Map(source.map((item) => [item.id, item]));
	const target = crossList ? readItems(destination.listId) : source;
	const sourceListFolders = readListFolders(sourceListId);
	const targetListFolders = crossList ? readListFolders(destination.listId) : sourceListFolders;
	const plan = planListEntryMove(source, target, sourceListFolders, targetListFolders, ids, destination);
	if (!plan || !plan.roots.length) return false;
	const records = new Map(getItems(doc).toArray().map((item) => [item.get('id') as string, item]));
	const folderRecords = new Map(getListFolders(doc).toArray().map((folder) => [folder.get('id') as string, folder]));
	const moving = new Set([...plan.movedItemIds, ...plan.movedFolderIds]);
	const siblings = destination.parentId === null
		? listRootEntries(destination.listId, plan.targetFolderId)
		: target.filter((item) => item.parentId === destination.parentId);
	let order = getInsertionOrder(siblings.filter((entry) => !moving.has(entry.id)), addPosition, plan.roots.length);
	const now = new Date().toISOString();
	const remapChecks = sourceList.folderId !== targetList.folderId;
	doc.transact(() => {
		materializeCycles(getItems(doc), source);
		if (crossList) materializeCycles(getItems(doc), target);
		const relocate = (id: string, listFolderId: string | null) => {
			const record = records.get(id)!;
			if (record.get('listId') !== destination.listId) record.set('listId', destination.listId);
			if ((record.get('listFolderId') ?? null) !== listFolderId) {
				if (listFolderId === null) record.delete('listFolderId');
				else record.set('listFolderId', listFolderId);
			}
			if (crossList) record.set('updatedAt', now);
			const item = sourceById.get(id)!;
			if (remapChecks && !item.note && !item.heading) {
				const done = isItemDone(item, sourceFolder);
				record.set('checked', done);
				for (const checkbox of targetFolder?.checkboxes ?? []) {
					const matching = sourceFolder?.checkboxes?.find((entry) => entry.name.toLowerCase() === checkbox.name.toLowerCase());
					record.set(`chk_${checkbox.id}`, matching ? !!item.checks[matching.id] : done);
				}
			}
		};
		for (const id of plan.movedItemIds) relocate(id, plan.targetFolderId);
		// Items inside moved folders keep their own folder membership.
		for (const item of plan.travellingItems) relocate(item.id, item.listFolderId ?? null);
		for (const id of plan.movedFolderIds) {
			const record = folderRecords.get(id)!;
			if (record.get('listId') !== destination.listId) {
				record.set('listId', destination.listId);
				record.set('updatedAt', now);
			}
		}
		for (const id of plan.roots) {
			const folder = folderRecords.get(id);
			if (plan.movedFolderIds.has(id) && folder) {
				folder.set('parentId', plan.targetFolderId);
				folder.set('order', order++);
				folder.set('updatedAt', now);
				continue;
			}
			const record = records.get(id)!;
			record.set('parentId', destination.parentId);
			record.set('order', order++);
			record.set('updatedAt', now);
		}
	});
	return true;
}

/** Move items to another list, recreating the folders that hold them below
 * baseFolderId. Matching folder names at the destination are reused. Source
 * folders below baseFolderId left empty by the move are deleted. */
export function moveItemsKeepingFolders(sourceListId: string, ids: string[], targetListId: string, baseFolderId: string | null, addPosition: 'top' | 'bottom' = 'bottom'): boolean {
	const lists = readLists();
	const target = lists.find((list) => list.id === targetListId);
	if (!target || target.type === 'divider' || isListEffectivelyArchived(target, readFolders()) || sourceListId === targetListId) return false;
	const source = new Map(readItems(sourceListId).map((item) => [item.id, item]));
	const folders = new Map(readListFolders(sourceListId).map((folder) => [folder.id, folder]));
	const groups = new Map<string | null, string[]>();
	for (const id of ids) {
		const item = source.get(id);
		if (!item) return false;
		const folderId = item.listFolderId ?? null;
		groups.set(folderId, [...groups.get(folderId) ?? [], id]);
	}
	// Validate ancestry before writing: Yjs transactions do not roll back.
	for (const folderId of groups.keys()) {
		const visited = new Set<string>();
		for (let id = folderId; id !== baseFolderId; id = folders.get(id)!.parentId) {
			if (id === null || !folders.has(id) || visited.has(id)) return false;
			visited.add(id);
		}
	}
	let moved = true;
	getMutableDoc().transact(() => {
		const created = new Map<string | null, string | null>([[baseFolderId, null]]);
		const ensure = (folderId: string | null): string | null => {
			if (created.has(folderId)) return created.get(folderId)!;
			const folder = folders.get(folderId!)!;
			const parentId = ensure(folder.parentId);
			const key = folder.name.trim().toLowerCase();
			const existing = readListFolders(targetListId).find((entry) => entry.parentId === parentId && entry.name.trim().toLowerCase() === key);
			const id = existing?.id ?? createListFolder(targetListId, folder.name, parentId, addPosition);
			created.set(folderId, id);
			return id;
		};
		for (const [folderId, groupIds] of groups) {
			const destination = { listId: targetListId, parentId: null, listFolderId: ensure(folderId) };
			if (!moveItemsToDestination(sourceListId, groupIds, destination, addPosition)) moved = false;
		}
		if (!moved) return;
		// Like a filesystem move: a source folder below baseFolderId that held
		// only moved entries is now empty and goes too, deepest first.
		const depth = (folderId: string) => {
			let count = 0;
			for (let id: string | null = folderId; id !== baseFolderId; id = folders.get(id!)!.parentId) count++;
			return count;
		};
		const emptied = new Set<string>();
		for (const folderId of groups.keys()) {
			for (let id = folderId; id !== baseFolderId; id = folders.get(id!)!.parentId) emptied.add(id!);
		}
		for (const folderId of [...emptied].sort((a, b) => depth(b) - depth(a))) {
			const hasItems = readItems(sourceListId, folderId).length > 0;
			const hasFolders = readListFolders(sourceListId).some((folder) => folder.parentId === folderId);
			if (!hasItems && !hasFolders) deleteListFolderRecords(getMutableDoc(), new Set([folderId]));
		}
	});
	return moved;
}

/** Reparent within one list. A null target means the root of the given view. */
export function reparentItems(listId: string, ids: string[], targetId: string | null, addPosition: 'top' | 'bottom' = 'bottom', listFolderId: string | null = null): boolean {
	return moveListEntries(listId, ids, { listId, parentId: targetId, listFolderId }, addPosition, true);
}

export function reorderItems(listId: string, fromIndex: number, toIndex: number) {
	const doc = getMutableDoc();
	const items = readItems(listId);
	if (fromIndex < 0 || fromIndex >= items.length || toIndex < 0 || toIndex >= items.length) return;
	const [moved] = items.splice(fromIndex, 1);
	items.splice(toIndex, 0, moved);
	doc.transact(() => items.forEach((item, idx) => updateItem(item.id, { order: idx })));
}

/** Root siblings of a view include its folders, which share item order. */
export function reorderSiblings(listId: string, parentId: string | null, fromIdx: number, toIdx: number, listFolderId: string | null = null) {
	const doc = getMutableDoc();
	const siblings: { id: string; order: number }[] = (parentId === null
		? listRootEntries(listId, listFolderId)
		: readItems(listId).filter((i) => i.parentId === parentId)).sort(compareOrder);
	if (fromIdx < 0 || fromIdx >= siblings.length || toIdx < 0 || toIdx >= siblings.length) return;
	const [moved] = siblings.splice(fromIdx, 1);
	siblings.splice(toIdx, 0, moved);
	const folderRecords = new Map(getListFolders(doc).toArray().map((record) => [record.get('id') as string, record]));
	doc.transact(() => siblings.forEach((entry, idx) => {
		const folder = folderRecords.get(entry.id);
		if (folder) { if (folder.get('order') !== idx) folder.set('order', idx); }
		else updateItem(entry.id, { order: idx });
	}));
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

export interface FavouriteFolder {
	id: string;
	name: string;
	parentId: string | null;
	order: number;
}

type FavouriteShortcut = { type: 'folder'; item: Folder } | { type: 'list'; item: ListMeta };
export type FavouriteEntry = (FavouriteShortcut | { type: 'favourites-folder'; item: FavouriteFolder }) & {
	parentId: string | null;
	order: number;
};
type FavouriteRef = { type: FavouriteEntry['type']; id: string };

function getFavouriteFolders(doc: Y.Doc): Y.Array<Y.Map<unknown>> {
	return doc.getArray('favourite-folders');
}

export function readFavouriteFolders(): FavouriteFolder[] {
	return resolveParentLinks(getFavouriteFolders(getDoc()).toArray().map(record => ({
		id: record.get('id') as string,
		name: record.get('name') as string,
		parentId: (record.get('parentId') as string | null) ?? null,
		order: (record.get('order') as number) ?? 0
	})));
}

export function favouriteKey({ type, id }: FavouriteRef): string {
	return type + ':' + id;
}

function collectFavouriteEntries(
	folders: Folder[],
	lists: ListMeta[],
	groups: FavouriteFolder[],
	include: (shortcut: FavouriteShortcut) => boolean
): FavouriteEntry[] {
	const groupIds = new Set(groups.map(group => group.id));
	const shortcuts: FavouriteShortcut[] = [
		...folders.map(item => ({ type: 'folder' as const, item })),
		...lists.map(item => ({ type: 'list' as const, item }))
	];
	return [
		...shortcuts.filter(include).map(shortcut => ({
			...shortcut,
			parentId: shortcut.item.favouriteParentId && groupIds.has(shortcut.item.favouriteParentId) ? shortcut.item.favouriteParentId : null,
			order: shortcut.item.favouriteOrder ?? shortcut.item.order
		})),
		...groups.map(item => ({ type: 'favourites-folder' as const, item, parentId: item.parentId, order: item.order }))
	].sort((a, b) => a.order - b.order);
}

export function buildFavouriteEntries(
	folders: Folder[],
	lists: ListMeta[],
	groups: FavouriteFolder[],
	retained?: ReadonlySet<string>
): FavouriteEntry[] {
	return collectFavouriteEntries(folders, lists, groups, ({ type, item }) =>
		(item.favourite || retained?.has(favouriteKey({ type, id: item.id })) === true) &&
		(type === 'folder' ? !isFolderEffectivelyArchived(item.id, folders) : !isListEffectivelyArchived(item, folders))
	);
}

/** Elide the grouping folders when navigating directly between starred lists. */
export function favouriteShortcutsInTreeOrder(entries: FavouriteEntry[]): FavouriteEntry[] {
	const children = new Map<string | null, FavouriteEntry[]>();
	for (const entry of entries) {
		const siblings = children.get(entry.parentId) ?? [];
		siblings.push(entry);
		children.set(entry.parentId, siblings);
	}
	const result: FavouriteEntry[] = [];
	const stack = [...(children.get(null) ?? [])].reverse();
	while (stack.length > 0) {
		const entry = stack.pop()!;
		if (entry.type === 'favourites-folder') {
			const siblings = children.get(entry.item.id) ?? [];
			for (let i = siblings.length - 1; i >= 0; i--) stack.push(siblings[i]);
		} else {
			result.push(entry);
		}
	}
	return result;
}

export function favouritePath(name: string, parentId: string | null, folders: { id: string; name: string; parentId: string | null }[]): string {
	const names = [name];
	const visited = new Set<string>();
	while (parentId !== null && !visited.has(parentId)) {
		visited.add(parentId);
		const parent = folders.find(folder => folder.id === parentId);
		if (!parent) break;
		names.push(parent.name);
		parentId = parent.parentId;
	}
	return names.reverse().join(' › ');
}

function storedFavouriteEntries(groups = readFavouriteFolders(), retained?: ReadonlySet<string>): FavouriteEntry[] {
	return collectFavouriteEntries(readFolders(), readLists(), groups, ({ type, item }) =>
		item.favourite || item.favouriteParentId != null || retained?.has(favouriteKey({ type, id: item.id })) === true
	);
}

function favouriteRecord(doc: Y.Doc, { type, id }: FavouriteRef) {
	const records = type === 'folder' ? getFolders(doc) : type === 'list' ? getLists(doc) : getFavouriteFolders(doc);
	return findYMap(records, id);
}

function setFavouriteOrder(record: Y.Map<unknown>, type: FavouriteRef['type'], order: number) {
	const field = type === 'favourites-folder' ? 'order' : 'favouriteOrder';
	if (record.get(field) !== order) record.set(field, order);
}

function setFavouriteParent(record: Y.Map<unknown>, type: FavouriteRef['type'], parentId: string | null) {
	const field = type === 'favourites-folder' ? 'parentId' : 'favouriteParentId';
	if (record.get(field) !== parentId) record.set(field, parentId);
}

export function toggleFavourite(type: FavouriteShortcut['type'], id: string, keepPlacement = false) {
	const doc = getMutableDoc();
	const record = favouriteRecord(doc, { type, id });
	if (!record) return;
	const next = !record.get('favourite');
	const order = next && !keepPlacement
		? getInsertionOrder(storedFavouriteEntries().filter(entry => entry.parentId === null), 'bottom')
		: null;
	doc.transact(() => {
		record.set('favourite', next);
		record.set('updatedAt', new Date().toISOString());
		if (order === null) return;
		if (record.get('favouriteParentId') != null) setFavouriteParent(record, type, null);
		setFavouriteOrder(record, type, order);
	});
}

export function createFavouriteFolder(name: string, parentId: string | null): string | null {
	const doc = getMutableDoc();
	const groups = readFavouriteFolders();
	name = name.trim();
	if (!name || (parentId !== null && !groups.some(group => group.id === parentId))) return null;
	const id = uid();
	const order = getInsertionOrder(storedFavouriteEntries(groups).filter(entry => entry.parentId === parentId), 'bottom');
	const record = new Y.Map<unknown>();
	for (const [key, value] of Object.entries({ id, name, parentId, order })) record.set(key, value);
	getFavouriteFolders(doc).push([record]);
	return id;
}

export function renameFavouriteFolder(id: string, name: string) {
	const doc = getMutableDoc();
	const record = favouriteRecord(doc, { type: 'favourites-folder', id });
	if (record && name.trim()) record.set('name', name.trim());
}

export function canMoveFavouriteFolder(groups: FavouriteFolder[], id: string, parentId: string | null): boolean {
	while (parentId !== null) {
		if (parentId === id) return false;
		parentId = groups.find(group => group.id === parentId)?.parentId ?? null;
	}
	return true;
}

export function moveFavourite(ref: FavouriteRef, parentId: string | null) {
	const doc = getMutableDoc();
	const groups = readFavouriteFolders();
	if (parentId !== null && !groups.some(group => group.id === parentId)) return;
	if (ref.type === 'favourites-folder' && !canMoveFavouriteFolder(groups, ref.id, parentId)) return;
	const entries = storedFavouriteEntries(groups);
	const entry = entries.find(entry => entry.type === ref.type && entry.item.id === ref.id);
	const record = favouriteRecord(doc, ref);
	if (!entry || !record || entry.parentId === parentId || (entry.type !== 'favourites-folder' && !entry.item.favourite)) return;
	const order = getInsertionOrder(entries.filter(entry => entry.parentId === parentId), 'bottom');
	doc.transact(() => {
		if (ref.type === 'favourites-folder') materializeCycles(getFavouriteFolders(doc), groups);
		setFavouriteParent(record, ref.type, parentId);
		setFavouriteOrder(record, ref.type, order);
	});
}

export function deleteFavouriteFolder(id: string) {
	const doc = getMutableDoc();
	const groups = readFavouriteFolders();
	const group = groups.find(group => group.id === id);
	if (!group) return;
	const entries = storedFavouriteEntries(groups);
	const children = entries.filter(entry => entry.parentId === id);
	const siblings = entries.filter(entry => entry.parentId === group.parentId)
		.flatMap(entry => entry.type === 'favourites-folder' && entry.item.id === id ? children : [entry]);
	doc.transact(() => {
		for (const child of children) {
			const record = favouriteRecord(doc, { type: child.type, id: child.item.id });
			if (record) setFavouriteParent(record, child.type, group.parentId);
		}
		siblings.forEach((entry, order) => {
			const record = favouriteRecord(doc, { type: entry.type, id: entry.item.id });
			if (record) setFavouriteOrder(record, entry.type, order);
		});
		removeYMap(getFavouriteFolders(doc), id);
	});
}

export function saveFavouritesOrder(parentId: string | null, refs: FavouriteRef[]) {
	const doc = getMutableDoc();
	const keys = new Set(refs.map(favouriteKey));
	const siblings = storedFavouriteEntries(undefined, keys).filter(entry => entry.parentId === parentId);
	const siblingKeys = new Set(siblings.map(entry => favouriteKey({ type: entry.type, id: entry.item.id })));
	const ordered = refs.filter(ref => siblingKeys.has(favouriteKey(ref)));
	let index = 0;
	doc.transact(() => {
		siblings.forEach((entry, order) => {
			const ref = { type: entry.type, id: entry.item.id };
			const target = keys.has(favouriteKey(ref)) ? ordered[index++] : ref;
			const record = favouriteRecord(doc, target);
			if (record) setFavouriteOrder(record, target.type, order);
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

export interface BackupItem extends Item { richText?: RichTextOperation[] }
export interface BackupSheet extends SheetMeta { cells?: Record<string, string> }

export interface BackupFile {
	version: number;
	exported: string; // ISO timestamp
	folders: Folder[];
	lists: ListMeta[];
	items: BackupItem[];
	sheets?: BackupSheet[];
	smartFolders?: Record<string, string[]>;
	favouriteFolders?: FavouriteFolder[];
	listFolders?: ListFolder[];
	customLocations?: RetailLocation[];
	locationOptionalTags?: string[];
	startingLocation?: StartingLocation | null;
	nearbyLocationFilterEnabled?: boolean;
	hotSuburbIds?: string[];
	nearbyPreviewLimit?: number;
	nearbyRecentlyModifiedFirst?: boolean;
	nearbyChecklist?: Record<string, NearbyChecklistState>;
	pausedErrandTags?: string[];
	pausedErrandItemIds?: string[];
}

/** Current application data. Device preferences and named history are separate. */
export function exportBackup(): BackupFile {
	const doc = getDoc();
	const favouriteFolders = readFavouriteFolders();
	const listFolders = readListFolders().map(({ createdAt, updatedAt, ...folder }) => ({
		...folder, ...(createdAt ? { createdAt } : {}), ...(updatedAt ? { updatedAt } : {})
	})) as ListFolder[];
	const backup: BackupFile = {
		version: 2,
		exported: new Date().toISOString(),
		folders: readFolders(),
		lists: readLists(),
		// DokuWiki write state is not part of backups: a restore must not resend old entries.
		items: readAllItems().map(({ dokuwiki: _request, dokuwikiStatus: _status, listFolderId, ...rest }) => {
			// Root items omit the field so backups without folders keep their old shape.
			const item: BackupItem = listFolderId ? { ...rest, listFolderId } : rest;
			const richText = readItemRichText(doc, item.id, item.name);
			return richText === undefined ? item : { ...item, richText };
		}),
		sheets: readSheets().map(sheet => ({ ...sheet, cells: readCells(sheet.id) })),
		smartFolders: readReportAssignments(getDoc()),
		...(favouriteFolders.length > 0 ? { favouriteFolders } : {}),
		...(listFolders.length > 0 ? { listFolders } : {}),
		customLocations: readCustomLocations(),
		locationOptionalTags: readLocationOptionalTags(),
		startingLocation: readStartingLocation(),
		nearbyLocationFilterEnabled: readNearbyLocationFilterEnabled(),
		hotSuburbIds: readHotSuburbIds(),
		nearbyPreviewLimit: readNearbyPreviewLimit(),
		nearbyRecentlyModifiedFirst: readNearbyRecentlyModifiedFirst(),
		nearbyChecklist: readNearbyChecklist(),
		pausedErrandTags: readPausedErrandTags(),
		pausedErrandItemIds: readPausedErrandItemIds()
	};
	validateBackup(backup);
	return backup;
}

/** Shared by file preview, export and restore; this function never mutates Yjs. */
export function validateBackup(value: unknown): asserts value is BackupFile {
	if (!isRecord(value)) throw new Error('Invalid backup: expected a JSON object.');
	if (value.version !== 1 && value.version !== 2) throw new Error(`Unsupported backup version: ${String(value.version)}. Update the app if this file came from a newer release.`);
	const fields = new Set(['version', 'exported', 'folders', 'lists', 'items', 'sheets', 'smartFolders', 'favouriteFolders', 'listFolders', 'customLocations', 'locationOptionalTags', 'startingLocation', 'nearbyLocationFilterEnabled', 'hotSuburbIds', 'nearbyPreviewLimit', 'nearbyRecentlyModifiedFirst', 'nearbyChecklist', 'pausedErrandTags', 'pausedErrandItemIds']);
	for (const key of Object.keys(value)) if (!fields.has(key)) throw new Error(`Unrecognized backup section: ${key}. This backup may require a newer app.`);
	if (value.exported !== undefined && (typeof value.exported !== 'string' || !Number.isFinite(Date.parse(value.exported)))) throw new Error('Invalid backup export date.');
	const backup = value as unknown as BackupFile;
	validateRecords(backup.folders, 'folders');
	validateRecords(backup.favouriteFolders === undefined ? [] : backup.favouriteFolders, 'favouriteFolders');
	validateRecords(backup.lists, 'lists');
	validateRecords(backup.items, 'items');
	const listFolders = backup.listFolders === undefined ? [] : backup.listFolders;
	validateRecords(listFolders, 'listFolders');
	if (backup.items.some(item => typeof item.listId !== 'string' || !item.listId.trim())) throw new Error('Invalid item listId.');
	validateRecords(backup.sheets === undefined ? [] : backup.sheets, 'sheets');
	validateLocations(backup.customLocations === undefined ? [] : backup.customLocations);
	if (backup.locationOptionalTags !== undefined && (!Array.isArray(backup.locationOptionalTags) || backup.locationOptionalTags.some(tag => typeof tag !== 'string' || !/^#?\w+$/.test(tag)))) throw new Error('Invalid location-free errand hashtags.');
	if (backup.pausedErrandTags !== undefined && (!Array.isArray(backup.pausedErrandTags) || backup.pausedErrandTags.some(tag => typeof tag !== 'string' || !/^#?\w+$/.test(tag)))) throw new Error('Invalid paused errand tags.');
	if (backup.pausedErrandItemIds !== undefined && (!Array.isArray(backup.pausedErrandItemIds) || backup.pausedErrandItemIds.some(id => typeof id !== 'string' || !id.trim()))) throw new Error('Invalid paused errand item ids.');
	if (backup.startingLocation != null && !isStartingLocation(backup.startingLocation)) throw new Error('Invalid starting location.');
	if (backup.nearbyLocationFilterEnabled !== undefined && typeof backup.nearbyLocationFilterEnabled !== 'boolean') throw new Error('Invalid nearby location filter.');
	if (backup.hotSuburbIds !== undefined && !isHotSuburbIds(backup.hotSuburbIds)) throw new Error('Invalid hot suburbs.');
	if (backup.nearbyPreviewLimit !== undefined && !isNearbyPreviewLimit(backup.nearbyPreviewLimit)) throw new Error('Invalid nearby preview limit.');
	if (backup.nearbyRecentlyModifiedFirst !== undefined && typeof backup.nearbyRecentlyModifiedFirst !== 'boolean') throw new Error('Invalid nearby recently modified order.');
	if (backup.nearbyChecklist !== undefined && (!backup.nearbyChecklist || typeof backup.nearbyChecklist !== 'object' || Array.isArray(backup.nearbyChecklist) || Object.entries(backup.nearbyChecklist).some(([id, state]) => !id || !isNearbyChecklistState(state)))) throw new Error('Invalid nearby checklist.');
	if (backup.customLocations?.some(location => !location.id.startsWith('custom-'))) throw new Error('Custom location ids must start with custom-.');
	if (backup.smartFolders !== undefined && !isRecord(backup.smartFolders)) throw new Error('Invalid reports.');
	for (const ids of Object.values(backup.smartFolders ?? {})) {
		if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) throw new Error('Invalid report assignments.');
	}
	const items = new Map(backup.items.map(item => [item.id, item]));
	const folders = new Map(listFolders.map(folder => [folder.id, folder]));
	for (const item of backup.items) {
		const parent = item.parentId ? items.get(item.parentId) : undefined;
		if (parent && parent.listId !== item.listId) throw new Error('An item parent must belong to the same list.');
		const folder = item.listFolderId ? folders.get(item.listFolderId) : undefined;
		if (folder && folder.listId !== item.listId) throw new Error('An item folder must belong to the same list.');
	}
	for (const folder of listFolders) {
		const parent = folder.parentId ? folders.get(folder.parentId) : undefined;
		if (parent && parent.listId !== folder.listId) throw new Error('A folder inside a list must belong to the same list as its parent folder.');
		if (folder.filterView !== undefined && !['all', 'unchecked', 'checked'].includes(folder.filterView)) throw new Error('Invalid folder filter.');
	}
}

export function parseBackup(text: string): BackupFile {
	if (new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES) throw new Error('Backup files must be 100 MB or smaller.');
	let value: unknown;
	try { value = JSON.parse(text.replace(/^\uFEFF/, '')); }
	catch { throw new Error('The file is not valid JSON. It may be incomplete or damaged.'); }
	validateBackup(value);
	return value;
}

/** Replace wipes current data; merge upserts by ID and retains other records. */
export function importBackup(backup: BackupFile, mode: 'replace' | 'merge'): void {
	if (mode !== 'merge' && mode !== 'replace') throw new Error('Invalid restore mode.');
	validateBackup(backup);
	const doc = getMutableDoc();
	const fArr = getFolders(doc);
	const favouritesArr = getFavouriteFolders(doc);
	const lArr = getLists(doc);
	const iArr = getItems(doc);
	const sArr = getSpreadsheets(doc);
	const lfArr = getListFolders(doc);
	// Index once: scanning the full Y.Array for each record freezes large restores.
	const indexes = new Map([fArr, favouritesArr, lArr, lfArr, iArr, sArr].map(arr => [arr, new Map(arr.toArray().map(record => [record.get('id') as string, record]))]));

	// Undo needs an authoritative pre-import baseline even for legacy notes
	// that have never been opened. Migration itself is not an undo action.
	for (const item of backup.items) {
		if (indexes.get(iArr)!.has(item.id) && !hasItemText(doc, item.id)) getItemText(doc, item.id);
	}

	doc.transact(() => {
		if (mode === 'replace') {
			if (fArr.length) fArr.delete(0, fArr.length);
			if (favouritesArr.length) favouritesArr.delete(0, favouritesArr.length);
			if (lArr.length) lArr.delete(0, lArr.length);
			if (iArr.length) iArr.delete(0, iArr.length);
			if (lfArr.length) lfArr.delete(0, lfArr.length);
			for (const key of doc.share.keys()) {
				if (key.startsWith('note_text_')) {
					const text = doc.getText(key);
					text.delete(0, text.length);
				}
				if (key.startsWith('sheet-cells-')) doc.getMap(key).clear();
			}
			doc.getMap('note-text-initialized').clear();
			if (sArr.length) sArr.delete(0, sArr.length);
			for (const index of indexes.values()) index.clear();
		}
		function upsert(arr: Y.Array<Y.Map<unknown>>, record: Record<string, unknown>, kind: 'folder' | 'item' | 'other') {
			const index = indexes.get(arr)!;
			let m = index.get(record.id as string);
			if (!m) {
				m = new Y.Map<unknown>();
				arr.push([m]);
				index.set(record.id as string, m);
			}
			for (const [key, value] of Object.entries(record)) {
				if (!['checks', 'checkboxes', 'richText', 'cells'].includes(key) && !(kind === 'folder' && key === 'defaultItems')) m.set(key, value);
			}
			if (kind === 'folder' && record.checkboxes !== undefined) replaceFolderCheckboxes(m, record.checkboxes as FolderCheckbox[]);
			if (kind === 'folder' && record.defaultItems !== undefined) replaceFolderDefaultItems(m, record.defaultItems as FolderDefaultItem[]);
			if (kind === 'item') {
				if (record.listFolderId == null) m.delete('listFolderId');
				if (record.checks !== undefined) {
					m.delete('checks');
					for (const key of [...m.keys()]) if (key.startsWith('chk_')) m.delete(key);
					for (const [id, value] of Object.entries(record.checks as Record<string, boolean>)) m.set(`chk_${id}`, value);
				}
				replaceItemRichText(doc, record.id as string, record.name as string, record.richText as RichTextOperation[] | undefined);
			}
		}
		for (const record of backup.folders) upsert(fArr, record as unknown as Record<string, unknown>, 'folder');
		for (const record of backup.favouriteFolders ?? []) upsert(favouritesArr, { ...record, parentId: record.parentId ?? null }, 'other');
		for (const record of backup.lists) upsert(lArr, record as unknown as Record<string, unknown>, 'other');
		for (const record of backup.listFolders ?? []) upsert(lfArr, { ...record, parentId: record.parentId ?? null }, 'other');
		for (const record of backup.items) upsert(iArr, record as unknown as Record<string, unknown>, 'item');
		for (const record of backup.sheets ?? []) upsert(sArr, record as unknown as Record<string, unknown>, 'other');
		for (const sheet of backup.sheets ?? []) {
			if (sheet.cells === undefined) continue; // Legacy merge keeps existing cells.
			const cells = getSheetCells(doc, sheet.id);
			cells.clear();
			for (const [key, value] of Object.entries(sheet.cells)) cells.set(key, value);
		}
		restoreReportAssignments(doc, backup.smartFolders ?? {}, mode === 'replace');
		const locations = doc.getMap<RetailLocation>('custom-locations');
		if (mode === 'replace') locations.clear();
		for (const location of backup.customLocations ?? []) locations.set(location.id, { ...location, tags: [...location.tags] });
		const optionalTags = doc.getMap<boolean>('location-optional-tags');
		if (mode === 'replace') optionalTags.clear();
		if (backup.locationOptionalTags !== undefined) {
			const restored = new Set(backup.locationOptionalTags.map(normalizeLocationTag));
			if (mode === 'replace') {
				for (const tag of DEFAULT_LOCATION_OPTIONAL_TAGS) optionalTags.set(tag, restored.has(tag));
			}
			for (const tag of restored) optionalTags.set(tag, true);
		}
		const preferences = doc.getMap('nearby-preferences');
		if (backup.startingLocation != null) preferences.set('starting-location', { ...backup.startingLocation });
		else if (mode === 'replace' || backup.startingLocation === null) preferences.delete('starting-location');
		if (backup.nearbyLocationFilterEnabled !== undefined) preferences.set('location-filter-enabled', backup.nearbyLocationFilterEnabled);
		else if (mode === 'replace') preferences.delete('location-filter-enabled');
		if (backup.hotSuburbIds !== undefined) preferences.set('hot-suburbs', [...backup.hotSuburbIds]);
		else if (mode === 'replace') preferences.delete('hot-suburbs');
		if (backup.nearbyPreviewLimit !== undefined) preferences.set('preview-limit', backup.nearbyPreviewLimit);
		else if (mode === 'replace') preferences.delete('preview-limit');
		if (backup.nearbyRecentlyModifiedFirst !== undefined) preferences.set('recently-modified-first', backup.nearbyRecentlyModifiedFirst);
		else if (mode === 'replace') preferences.delete('recently-modified-first');
		const checklist = doc.getMap<NearbyChecklistState>('nearby-checklist');
		if (mode === 'replace') checklist.clear();
		for (const [id, state] of Object.entries(backup.nearbyChecklist ?? {})) checklist.set(id, { ...state });
		const pausedTags = doc.getMap<boolean>('paused-errand-tags');
		if (mode === 'replace') pausedTags.clear();
		for (const tag of backup.pausedErrandTags ?? []) pausedTags.set(normalizeLocationTag(tag), true);
		const pausedItems = doc.getMap<boolean>('paused-errand-items');
		if (mode === 'replace') pausedItems.clear();
		for (const id of backup.pausedErrandItemIds ?? []) pausedItems.set(id, true);
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

export function readPausedErrandItemIds(): string[] {
	return [...getDoc().getMap<boolean>('paused-errand-items')]
		.filter(([id, paused]) => paused === true && !!id.trim())
		.map(([id]) => id).sort();
}

export function setErrandItemPaused(id: string, paused: boolean): void {
	if (!id.trim()) throw new Error('Invalid errand item id.');
	const doc = getMutableDoc();
	if (paused && !findYMap(getItems(doc), id) && !isIncludedErrandId(id)) return;
	const items = doc.getMap<boolean>('paused-errand-items');
	if (paused) items.set(id, true);
	else items.delete(id);
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

const DEFAULT_LOCATION_OPTIONAL_TAGS = ['bank', 'errand'];

/** Missing entries retain the defaults; explicit false values make removals sync. */
export function readLocationOptionalTags(): string[] {
	const tags = new Set(DEFAULT_LOCATION_OPTIONAL_TAGS);
	for (const [tag, enabled] of getDoc().getMap<boolean>('location-optional-tags')) {
		if (!/^\w+$/.test(tag) || typeof enabled !== 'boolean') continue;
		if (enabled) tags.add(tag);
		else tags.delete(tag);
	}
	return [...tags].sort();
}

export function setLocationOptionalTag(tag: string, enabled: boolean): void {
	if (typeof tag !== 'string' || typeof enabled !== 'boolean') throw new Error('Invalid location-free errand hashtag.');
	const normalized = normalizeLocationTag(tag);
	if (!/^\w+$/.test(normalized)) throw new Error('Use one hashtag with letters, numbers or underscores.');
	getMutableDoc().getMap<boolean>('location-optional-tags').set(normalized, enabled);
}

export function readCustomLocations(): RetailLocation[] {
	return [...getDoc().getMap<RetailLocation>('custom-locations').values()].map(location => ({ ...location, tags: [...location.tags] }));
}

export function saveCustomLocation(location: RetailLocation): void {
	validateLocations([location]);
	if (!location.id.startsWith('custom-')) throw new Error('Custom location ids must start with custom-.');
	const doc = getMutableDoc();
	const saved = { ...location, name: location.name.trim(), tags: [...new Set(location.tags.map(normalizeLocationTag))] };
	const wasStartingPoint = doc.getMap<RetailLocation>('custom-locations').get(location.id)?.startingPoint === true;
	doc.transact(() => {
		doc.getMap<RetailLocation>('custom-locations').set(location.id, saved);
		const preferences = doc.getMap('nearby-preferences');
		const starting = preferences.get('starting-location');
		if (isStartingLocation(starting) && starting.source === 'custom' && starting.customLocationId === location.id) {
			// Enabling a pill should not revive a stale selection from a disabled place.
			if (wasStartingPoint && saved.startingPoint === true) {
				preferences.set('starting-location', { ...starting, label: saved.name, latitude: saved.latitude, longitude: saved.longitude, updatedAt: new Date().toISOString() });
			} else {
				preferences.delete('starting-location');
			}
		}
	});
}

export function deleteCustomLocation(id: string): void {
	const doc = getMutableDoc();
	doc.transact(() => {
		doc.getMap('custom-locations').delete(id);
		const preferences = doc.getMap('nearby-preferences');
		const starting = preferences.get('starting-location');
		if (isStartingLocation(starting) && starting.source === 'custom' && starting.customLocationId === id) {
			preferences.delete('starting-location');
		}
	});
}

export function readStartingLocation(): StartingLocation | null {
	const doc = getDoc();
	const location = doc.getMap('nearby-preferences').get('starting-location');
	if (!isStartingLocation(location)) return null;
	if (location.source !== 'custom') return location;
	const custom = doc.getMap<RetailLocation>('custom-locations').get(location.customLocationId!);
	// Resolve the reference on read as well, so concurrent edits and selections converge.
	return custom?.startingPoint === true ? { ...location, label: custom.name, latitude: custom.latitude, longitude: custom.longitude } : null;
}

export function saveStartingLocation(location: StartingLocation): void {
	if (!isStartingLocation(location)) throw new Error('Invalid starting location.');
	const doc = getMutableDoc();
	if (location.source === 'custom') {
		const custom = doc.getMap<RetailLocation>('custom-locations').get(location.customLocationId!);
		if (!custom || custom.startingPoint !== true) throw new Error('This location is no longer available as a starting point. Choose another starting point.');
		location = { ...location, label: custom.name, latitude: custom.latitude, longitude: custom.longitude, accuracy: null };
	}
	// A single value keeps coordinates and metadata together when devices update concurrently.
	doc.transact(() => {
		const preferences = doc.getMap('nearby-preferences');
		preferences.set('starting-location', { ...location });
		preferences.set('location-filter-enabled', true);
	});
}

export function readNearbyLocationFilterEnabled(): boolean {
	return getDoc().getMap('nearby-preferences').get('location-filter-enabled') !== false;
}

export function saveNearbyLocationFilterEnabled(enabled: boolean): void {
	if (typeof enabled !== 'boolean') throw new Error('Invalid nearby location filter.');
	getMutableDoc().getMap('nearby-preferences').set('location-filter-enabled', enabled);
}

export function clearStartingLocation(): void {
	getMutableDoc().getMap('nearby-preferences').delete('starting-location');
}

export function readHotSuburbIds(): string[] {
	const ids = getDoc().getMap('nearby-preferences').get('hot-suburbs');
	return isHotSuburbIds(ids) ? [...ids] : [...defaultHotSuburbIds];
}

export function saveHotSuburbIds(ids: string[]): void {
	if (!isHotSuburbIds(ids)) throw new Error('Invalid hot suburbs.');
	getMutableDoc().getMap('nearby-preferences').set('hot-suburbs', [...ids]);
}

function isNearbyPreviewLimit(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 50;
}

export function readNearbyPreviewLimit(): number {
	const limit = getDoc().getMap('nearby-preferences').get('preview-limit');
	// Preserve support for backups made when the control allowed up to 50 items.
	return isNearbyPreviewLimit(limit) ? Math.min(limit, 9) : 3;
}

export function saveNearbyPreviewLimit(limit: number): void {
	if (!isNearbyPreviewLimit(limit) || limit > 9) throw new Error('Invalid nearby preview limit.');
	getMutableDoc().getMap('nearby-preferences').set('preview-limit', limit);
}

export function readNearbyRecentlyModifiedFirst(): boolean {
	return getDoc().getMap('nearby-preferences').get('recently-modified-first') === true;
}

export function saveNearbyRecentlyModifiedFirst(enabled: boolean): void {
	if (typeof enabled !== 'boolean') throw new Error('Invalid nearby recently modified order.');
	getMutableDoc().getMap('nearby-preferences').set('recently-modified-first', enabled);
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
