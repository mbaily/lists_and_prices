import type { Item, ListMeta } from './data';
import type { MarkedEntity } from './destinationMarks';
import { buildItemTreeOrder, selectedRoots } from './hierarchy';

export interface ItemMoveDestination {
	listId: string;
	parentId: string | null;
}

/** Callers supply lists that are available as destinations. */
export function resolveMarkedItemDestination(mark: MarkedEntity, lists: ListMeta[], items: Item[]): ItemMoveDestination | null {
	if (mark.kind === 'list') {
		const list = lists.find((entry) => entry.id === mark.id);
		return list && list.type !== 'divider' ? { listId: list.id, parentId: null } : null;
	}
	if (!['item', 'note', 'todo', 'task'].includes(mark.kind)) return null;
	const item = items.find((entry) => entry.id === mark.id);
	if (!item || item.heading || !lists.some((list) => list.id === item.listId && list.type !== 'divider')) return null;
	if (mark.kind === 'note' && !item.note) return null;
	if ((mark.kind === 'todo' || mark.kind === 'task') && item.note) return null;
	return { listId: item.listId, parentId: item.id };
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
