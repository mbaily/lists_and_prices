/**
 * CRUD helpers for folders, lists, and items.
 * All mutations operate on the shared Y.Doc.
 */
import * as Y from 'yjs';
import { getFolders, getLists, getItems, getDoc } from './yjsStore.svelte';

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
		done: (m.get('done') as boolean) ?? false
	};
}

export function createFolder(name: string, parentId: string | null, color = '#6366f1'): string {
	const doc = getDoc();
	const folders = getFolders(doc);
	const existing = folders.toArray() as Y.Map<unknown>[];
	const maxOrder = existing.filter((f) => f.get('parentId') === parentId).length;
	const m = new Y.Map<unknown>();
	const id = uid();
	m.set('id', id);
	m.set('name', name);
	m.set('color', color);
	m.set('parentId', parentId);
	m.set('order', maxOrder);
	folders.push([m]);
	return id;
}

export function updateFolder(id: string, patch: Partial<Omit<Folder, 'id'>>) {
	const m = findYMap(getFolders(getDoc()), id);
	if (!m) return;
	for (const [k, v] of Object.entries(patch)) m.set(k, v);
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
		favourite: (m.get('favourite') as boolean) ?? false
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
	m.set('id', id);
	m.set('name', name);
	m.set('color', color);
	m.set('folderId', folderId);
	m.set('type', type);
	m.set('order', existing.length);
	lists.push([m]);
	return id;
}

export function updateList(id: string, patch: Partial<Omit<ListMeta, 'id'>>) {
	const m = findYMap(getLists(getDoc()), id);
	if (!m) return;
	for (const [k, v] of Object.entries(patch)) m.set(k, v);
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
		order: (m.get('order') as number) ?? 0
	};
}

export function createItem(listId: string, name: string, price: number | null = null): string {
	const doc = getDoc();
	const items = getItems(doc);
	const existing = (items.toArray() as Y.Map<unknown>[]).filter(
		(i) => i.get('listId') === listId
	);
	const m = new Y.Map<unknown>();
	const id = uid();
	m.set('id', id);
	m.set('listId', listId);
	m.set('name', name);
	m.set('price', price);
	m.set('checked', false);
	m.set('order', existing.length);
	items.push([m]);
	return id;
}

export function updateItem(id: string, patch: Partial<Omit<Item, 'id' | 'listId'>>) {
	const m = findYMap(getItems(getDoc()), id);
	if (!m) return;
	for (const [k, v] of Object.entries(patch)) m.set(k, v);
}

export function deleteItem(id: string) {
	removeYMap(getItems(getDoc()), id);
}

export function deleteItemsBatch(ids: string[]): void {
	getDoc().transact(() => { for (const id of ids) deleteItem(id); });
}

export function setItemsChecked(ids: string[], checked: boolean): void {
	getDoc().transact(() => { for (const id of ids) updateItem(id, { checked }); });
}

export function createItemsBatch(listId: string, names: string[]): void {
	getDoc().transact(() => { for (const name of names) createItem(listId, name); });
}

export function listTotal(listId: string): number {
	return Math.round(readItems(listId).reduce((s, i) => s + Math.round((i.price ?? 0) * 100), 0)) / 100;
}

// ─── Reorder helpers ──────────────────────────────────────────────────────────

export function reorderItems(listId: string, fromIndex: number, toIndex: number) {
	const doc = getDoc();
	const items = readItems(listId);
	const [moved] = items.splice(fromIndex, 1);
	items.splice(toIndex, 0, moved);
	doc.transact(() => items.forEach((item, idx) => updateItem(item.id, { order: idx })));
}

export function reorderFolders(parentId: string | null, fromIndex: number, toIndex: number) {
	const doc = getDoc();
	const all = readFolders()
		.filter((f) => f.parentId === parentId)
		.sort((a, b) => a.order - b.order);
	const [moved] = all.splice(fromIndex, 1);
	all.splice(toIndex, 0, moved);
	doc.transact(() => all.forEach((f, idx) => updateFolder(f.id, { order: idx })));
}

export function reorderLists(folderId: string, fromIndex: number, toIndex: number) {
	const doc = getDoc();
	const all = readLists()
		.filter((l) => l.folderId === folderId)
		.sort((a, b) => a.order - b.order);
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
