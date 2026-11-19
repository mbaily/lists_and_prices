import type { Item, ListFolder, ListMeta } from './data';
import type { MarkedEntity } from './destinationMarks';
import { buildItemTreeOrder, selectedRoots } from './hierarchy';
import { listFolderDescendants, listRows } from './listFolders';

export interface ItemMoveDestination {
	listId: string;
	parentId: string | null;
	listFolderId?: string | null;
}

/** Callers supply lists that are available as destinations. */
export function resolveMarkedItemDestination(mark: MarkedEntity, lists: ListMeta[], items: Item[], folders: ListFolder[] = []): ItemMoveDestination | null {
	if (mark.kind === 'list') {
		const list = lists.find((entry) => entry.id === mark.id);
		return list && list.type !== 'divider' ? { listId: list.id, parentId: null } : null;
	}
	if (mark.kind === 'list-folder') {
		const folder = folders.find(entry => entry.id === mark.id);
		return folder && lists.some(list => list.id === folder.listId && list.type !== 'divider')
			? { listId: folder.listId, parentId: null, listFolderId: folder.id } : null;
	}
	if (!['item', 'note', 'todo', 'task'].includes(mark.kind)) return null;
	const item = items.find((entry) => entry.id === mark.id);
	if (!item || item.heading || !lists.some((list) => list.id === item.listId && list.type !== 'divider')) return null;
	if (mark.kind === 'note' && !item.note) return null;
	if ((mark.kind === 'todo' || mark.kind === 'task') && item.note) return null;
	return { listId: item.listId, parentId: item.id };
}

export function planListEntryMove(source: Item[], target: Item[], sourceFolders: ListFolder[], targetFolders: ListFolder[], ids: Iterable<string>, destination: ItemMoveDestination) {
	const selected = new Set(ids);
	const sourceById = new Map(source.map(item => [item.id, item]));
	const foldersById = new Map(sourceFolders.map(folder => [folder.id, folder]));
	if (!selected.size || [...selected].some(id => !sourceById.has(id) && !foldersById.has(id))) return null;
	const parent = destination.parentId === null ? undefined : target.find(item => item.id === destination.parentId);
	if (destination.parentId !== null && (!parent || parent.heading)) return null;
	const targetFolderId = parent ? parent.listFolderId ?? null : destination.listFolderId ?? null;
	if (targetFolderId !== null && !targetFolders.some(folder => folder.id === targetFolderId)) return null;
	const movedFolderIds = listFolderDescendants(sourceFolders, selected);
	if (movedFolderIds.size && (parent || (targetFolderId !== null && movedFolderIds.has(targetFolderId)))) return null;
	const folderRoots = sourceFolders.filter(folder => selected.has(folder.id) && (!folder.parentId || !movedFolderIds.has(folder.parentId)));
	const travellingItems = source.filter(item => item.listFolderId && movedFolderIds.has(item.listFolderId));
	const carriedItemIds = new Set(travellingItems.map(item => item.id));
	const itemSelection = [...selected].filter(id => sourceById.has(id) && !carriedItemIds.has(id));
	const targetItems = target.filter(item => (item.listFolderId ?? null) === targetFolderId);
	const itemPlan = itemSelection.length ? planItemMove(source, targetItems, itemSelection, destination.parentId) : null;
	if (itemSelection.length && !itemPlan) return null;
	const rootIds = new Set([...folderRoots.map(folder => folder.id), ...itemPlan?.roots ?? []]);
	const roots = listRows(buildItemTreeOrder(source), folderRoots).filter(row => rootIds.has(row.item.id)).map(row => row.item.id);
	return { roots, movedItemIds: itemPlan?.movedIds ?? new Set<string>(), travellingItems, movedFolderIds, targetFolderId };
}

/** Plan a subtree move without changing any data. Roots follow their list order. */
export function planItemMove(source: Item[], destination: Item[], ids: Iterable<string>, parentId: string | null): { roots: string[]; movedIds: Set<string> } | null {
	const selected = new Set(ids);
	const sourceIds = new Set(source.map((item) => item.id));
	if (selected.size === 0 || [...selected].some((id) => !sourceIds.has(id))) return null;
	if (parentId !== null && !destination.some((item) => item.id === parentId && !item.heading)) return null;
	const rootIds = new Set(selectedRoots(source, selected));
	const tree = buildItemTreeOrder(source);
	const roots = tree.filter(({ item }) => rootIds.has(item.id)).map(({ item }) => item.id);
	if (roots.length === 0) return null;
	const movedIds = new Set<string>();
	for (const { item } of tree) {
		if (rootIds.has(item.id) || (item.parentId !== null && movedIds.has(item.parentId))) movedIds.add(item.id);
	}
	if (parentId !== null && movedIds.has(parentId)) return null;
	const projected = [
		...destination.filter((item) => !movedIds.has(item.id)),
		...source.filter((item) => movedIds.has(item.id)).map((item) =>
			rootIds.has(item.id) ? { ...item, parentId } : item)
	];
	if (buildItemTreeOrder(projected).some(({ item, level }) => movedIds.has(item.id) && level > 2)) return null;
	return { roots, movedIds };
}
