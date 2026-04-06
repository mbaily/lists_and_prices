/**
 * CRUD helpers for folders, lists, and items.
 * All mutations operate on the shared Y.Doc.
 */
import * as Y from 'yjs';
import { getFolders, getLists, getItems, getDoc, getSpreadsheets, getSheetCells } from './yjsStore.svelte';

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
	archived: boolean;
	createdAt: string | null;
	updatedAt: string | null;
}

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
		archived: (m.get('archived') as boolean) ?? false,
		createdAt: (m.get('createdAt') as string | null) ?? null,
		updatedAt: (m.get('updatedAt') as string | null) ?? null
	};
}

export function createFolder(name: string, parentId: string | null, color = '#6366f1'): string {
	const doc = getDoc();
	const folders = getFolders(doc);
	const existing = folders.toArray() as Y.Map<unknown>[];
	const maxOrder = existing.filter((f) => f.get('parentId') === parentId).length;
	const m = new Y.Map<unknown>();
	const id = uid();
	const now = new Date().toISOString();
	m.set('id', id);
	m.set('name', name);
	m.set('color', color);
	m.set('parentId', parentId);
	m.set('order', maxOrder);
	m.set('createdAt', now);
	m.set('updatedAt', now);
	folders.push([m]);
	return id;
}

export function updateFolder(id: string, patch: Partial<Omit<Folder, 'id' | 'createdAt' | 'updatedAt'>>) {
	const m = findYMap(getFolders(getDoc()), id);
	if (!m) return;
	for (const [k, v] of Object.entries(patch)) m.set(k, v);
	const keys = Object.keys(patch);
	if (!(keys.length === 1 && keys[0] === 'order')) m.set('updatedAt', new Date().toISOString());
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
	for (const lid of listIds) deleteList(lid);

	removeYMap(getFolders(doc), id);
}

export function isDescendant(folderId: string, targetId: string, _visited = new Set<string>()): boolean {
	// Returns true if targetId is folderId or a descendant of folderId
	if (folderId === targetId) return true;
	if (_visited.has(folderId)) return false; // cycle guard
	_visited.add(folderId);
	const folders = getFolders(getDoc()).toArray() as Y.Map<unknown>[];
	const children = folders
		.filter((f) => f.get('parentId') === folderId)
		.map((f) => f.get('id') as string);
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

export interface ListMeta {
	id: string;
	name: string;
	color: string;
	folderId: string;
	type: 'plain' | 'priced';
	order: number;
	done: boolean;
	favourite: boolean;
	archived: boolean;
	createdAt: string | null;
	updatedAt: string | null;
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
		type: (m.get('type') as 'plain' | 'priced') ?? 'plain',
		order: (m.get('order') as number) ?? 0,
		done: (m.get('done') as boolean) ?? false,
		favourite: (m.get('favourite') as boolean) ?? false,
		archived: (m.get('archived') as boolean) ?? false,
		createdAt: (m.get('createdAt') as string | null) ?? null,
		updatedAt: (m.get('updatedAt') as string | null) ?? null
	};
}

export function createList(
	name: string,
	folderId: string,
	type: 'plain' | 'priced',
	color = '#6366f1'
): string {
	const doc = getDoc();
	const lists = getLists(doc);
	const existing = (lists.toArray() as Y.Map<unknown>[]).filter(
		(l) => l.get('folderId') === folderId
	);
	const m = new Y.Map<unknown>();
	const id = uid();
	const now = new Date().toISOString();
	m.set('id', id);
	m.set('name', name);
	m.set('color', color);
	m.set('folderId', folderId);
	m.set('type', type);
	m.set('order', existing.length);
	m.set('createdAt', now);
	m.set('updatedAt', now);
	lists.push([m]);
	return id;
}

export function updateList(id: string, patch: Partial<Omit<ListMeta, 'id' | 'createdAt' | 'updatedAt'>>) {
	const m = findYMap(getLists(getDoc()), id);
	if (!m) return;
	for (const [k, v] of Object.entries(patch)) m.set(k, v);
	const keys = Object.keys(patch);
	if (!(keys.length === 1 && keys[0] === 'order')) m.set('updatedAt', new Date().toISOString());
}

export function deleteList(id: string) {
	const doc = getDoc();
	doc.transact(() => {
		// Delete all items in this list
		const allItems = getItems(doc).toArray() as Y.Map<unknown>[];
		const itemIds = allItems
			.filter((i) => i.get('listId') === id)
			.map((i) => i.get('id') as string);
		for (const iid of itemIds) deleteItem(iid);
		removeYMap(getLists(doc), id);
	});
}

// ─── Items ────────────────────────────────────────────────────────────────────

export interface Item {
	id: string;
	listId: string;
	name: string;
	price: number | null;
	checked: boolean;
	order: number;
	heading: boolean;
	parentId: string | null;
	note: boolean;
	createdAt: string | null;
	updatedAt: string | null;
}

export function readItems(listId: string): Item[] {
	return (getItems(getDoc()).toArray() as Y.Map<unknown>[])
		.filter((m) => m.get('listId') === listId)
		.map(yMapToItem)
		.sort((a, b) => a.order - b.order);
}

function yMapToItem(m: Y.Map<unknown>): Item {
	return {
		id: m.get('id') as string,
		listId: m.get('listId') as string,
		name: m.get('name') as string,
		price: (m.get('price') as number | null) ?? null,
		checked: (m.get('checked') as boolean) ?? false,
		order: (m.get('order') as number) ?? 0,
		heading: (m.get('heading') as boolean) ?? false,
		parentId: (m.get('parentId') as string | null) ?? null,
		note: (m.get('note') as boolean) ?? false,
		createdAt: (m.get('createdAt') as string | null) ?? null,
		updatedAt: (m.get('updatedAt') as string | null) ?? null
	};
}

export function createItem(listId: string, name: string, price: number | null = null, parentId: string | null = null, note = false): string {
	const doc = getDoc();
	const items = getItems(doc);
	const existing = (items.toArray() as Y.Map<unknown>[]).filter(
		(i) => i.get('listId') === listId
	);
	// Order within siblings (same parentId)
	const siblings = existing.filter((i) => (i.get('parentId') ?? null) === parentId);
	const m = new Y.Map<unknown>();
	const id = uid();
	const now = new Date().toISOString();
	m.set('id', id);
	m.set('listId', listId);
	m.set('name', name);
	m.set('price', price);
	m.set('checked', false);
	m.set('order', siblings.length);
	m.set('createdAt', now);
	m.set('updatedAt', now);
	if (parentId !== null) m.set('parentId', parentId);
	if (note) m.set('note', note);
	items.push([m]);
	return id;
}

export function updateItem(id: string, patch: Partial<Omit<Item, 'id' | 'listId' | 'createdAt' | 'updatedAt'>>) {
	const m = findYMap(getItems(getDoc()), id);
	if (!m) return;
	for (const [k, v] of Object.entries(patch)) m.set(k, v);
	const keys = Object.keys(patch);
	if (!(keys.length === 1 && keys[0] === 'order')) m.set('updatedAt', new Date().toISOString());
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

export function createItemsBatch(listId: string, names: string[]): void {
	getDoc().transact(() => { for (const name of names) createItem(listId, name); });
}

export function listTotal(listId: string): number {
	return Math.round(
		readItems(listId)
			.filter((i) => i.parentId === null)
			.reduce((s, i) => s + Math.round((i.price ?? 0) * 100), 0)
	) / 100;
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
	// If the caller provides a pre-filtered ordered list of IDs, use that.
	// Otherwise fall back to all siblings (used internally / from tests).
	const all = visibleIds
		? readFolders().filter((f) => visibleIds.includes(f.id)).sort((a, b) => visibleIds.indexOf(a.id) - visibleIds.indexOf(b.id))
		: readFolders().filter((f) => f.parentId === parentId).sort((a, b) => a.order - b.order);
	const [moved] = all.splice(fromIndex, 1);
	all.splice(toIndex, 0, moved);
	doc.transact(() => all.forEach((f, idx) => updateFolder(f.id, { order: idx })));
}

export function reorderLists(folderId: string, fromIndex: number, toIndex: number, visibleIds?: string[]) {
	const doc = getDoc();
	const all = visibleIds
		? readLists().filter((l) => visibleIds.includes(l.id)).sort((a, b) => visibleIds.indexOf(a.id) - visibleIds.indexOf(b.id))
		: readLists().filter((l) => l.folderId === folderId).sort((a, b) => a.order - b.order);
	const [moved] = all.splice(fromIndex, 1);
	all.splice(toIndex, 0, moved);
	doc.transact(() => all.forEach((l, idx) => updateList(l.id, { order: idx })));
}

// ─── Internal utilities ───────────────────────────────────────────────────────

function findYMap(arr: Y.Array<unknown>, id: string): Y.Map<unknown> | null {
	const maps = arr.toArray() as Y.Map<unknown>[];
	return maps.find((m) => m.get('id') === id) ?? null;
}

function removeYMap(arr: Y.Array<unknown>, id: string) {
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
}

function _readAllItems() {
	return (getItems(getDoc()).toArray() as Y.Map<unknown>[]).map(yMapToItem);
}

/** Serialise the entire doc to a plain JS object ready to JSON.stringify. */
export function exportBackup(): BackupFile {
	return {
		version: 1,
		exported: new Date().toISOString(),
		folders: readFolders(),
		lists: readLists(),
		items: _readAllItems()
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

	doc.transact(() => {
		if (mode === 'replace') {
			// Clear all arrays
			if (fArr.length) fArr.delete(0, fArr.length);
			if (lArr.length) lArr.delete(0, lArr.length);
			if (iArr.length) iArr.delete(0, iArr.length);

			// Insert folders
			for (const f of backup.folders) {
				const m = new Y.Map<unknown>();
				for (const [k, v] of Object.entries(f)) m.set(k, v);
				fArr.push([m]);
			}
			// Insert lists
			for (const l of backup.lists) {
				const m = new Y.Map<unknown>();
				for (const [k, v] of Object.entries(l)) m.set(k, v);
				lArr.push([m]);
			}
			// Insert items
			for (const i of backup.items) {
				const m = new Y.Map<unknown>();
				for (const [k, v] of Object.entries(i)) m.set(k, v);
				iArr.push([m]);
			}
		} else {
			// Merge: upsert each record by id
			function upsert(arr: Y.Array<unknown>, record: Record<string, unknown>) {
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
		}
	});
}
// ─── Spreadsheets ─────────────────────────────────────────────────────────────

export interface SheetMeta {
	id: string;
	name: string;
	folderId: string;
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
		folderId: m.get('folderId') as string,
		order: (m.get('order') as number) ?? 0,
		createdAt: (m.get('createdAt') as string | null) ?? null,
		updatedAt: (m.get('updatedAt') as string | null) ?? null
	};
}

export function createSheet(name: string, folderId: string): string {
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
	const m = findYMap(getSpreadsheets(getDoc()), id);
	if (!m) return;
	for (const [k, v] of Object.entries(patch)) m.set(k, v);
	const keys = Object.keys(patch);
	if (!(keys.length === 1 && keys[0] === 'order')) m.set('updatedAt', new Date().toISOString());
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