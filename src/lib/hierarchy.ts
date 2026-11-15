import type { Item } from './data';

/** Resolve missing parents and concurrent move cycles without writing repairs
 * back into the CRDT. All replicas cut the same (smallest-id) edge of a cycle,
 * so partially received updates cannot permanently undo somebody else's move. */
export function resolveParentLinks<T extends { id: string; parentId: string | null }>(nodes: T[]): T[] {
	const parents = new Map(nodes.map((node) => [node.id, node.parentId]));
	for (const [id, parent] of parents) {
		if (parent !== null && !parents.has(parent)) parents.set(id, null);
	}
	const visited = new Set<string>();
	for (const node of nodes) {
		const path: string[] = [];
		const positions = new Map<string, number>();
		let id: string | null = node.id;
		while (id !== null && !visited.has(id)) {
			const cycleStart = positions.get(id);
			if (cycleStart !== undefined) {
				const root = path.slice(cycleStart).sort()[0];
				parents.set(root, null);
				break;
			}
			positions.set(id, path.length);
			path.push(id);
			id = parents.get(id) ?? null;
		}
		for (const entry of path) visited.add(entry);
	}
	return nodes.map((node) => ({ ...node, parentId: parents.get(node.id) ?? null }));
}

export function compareOrder(a: { id: string; order: number }, b: { id: string; order: number }): number {
	return a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Reserve consecutive orders for a batch, preserving its order at either end. */
export function getInsertionOrder(siblings: { order: number }[], position: 'top' | 'bottom', count = 1): number {
	if (siblings.length === 0) return 0;
	return position === 'top'
		? siblings.reduce((min, item) => Math.min(min, item.order), Infinity) - count
		: siblings.reduce((max, item) => Math.max(max, item.order), -Infinity) + 1;
}

export interface TreeItem {
	item: Item;
	level: number;
	tlIdx: number;
	rootTlIdx: number;
	sibIdx: number;
}

/** Render every stored item, including legacy deep trees and heading children. */
export function buildItemTreeOrder(items: Item[]): TreeItem[] {
	const children = new Map<string | null, Item[]>();
	for (const item of resolveParentLinks(items)) {
		const siblings = children.get(item.parentId) ?? [];
		siblings.push(item);
		children.set(item.parentId, siblings);
	}
	for (const siblings of children.values()) siblings.sort(compareOrder);
	const result: TreeItem[] = [];
	const stack = (children.get(null) ?? []).map((item, idx) => ({ item, level: 0, tlIdx: idx, rootTlIdx: idx, sibIdx: idx })).reverse();
	while (stack.length > 0) {
		const entry = stack.pop()!;
		result.push(entry);
		const siblings = children.get(entry.item.id) ?? [];
		for (let idx = siblings.length - 1; idx >= 0; idx--) {
			stack.push({ item: siblings[idx], level: entry.level + 1, tlIdx: -1, rootTlIdx: entry.rootTlIdx, sibIdx: idx });
		}
	}
	return result;
}

/** Moving a selected parent also moves its selected descendants as a subtree. */
export function selectedRoots(items: Item[], ids: Iterable<string>): string[] {
	const selected = new Set(ids);
	const byId = new Map(items.map((item) => [item.id, item]));
	return [...selected].filter((id) => {
		const visited = new Set([id]);
		let parent = byId.get(id)?.parentId;
		while (parent) {
			if (selected.has(parent) || visited.has(parent)) return false;
			visited.add(parent);
			parent = byId.get(parent)?.parentId;
		}
		return byId.has(id);
	});
}

export function canReparentItems(items: Item[], ids: Iterable<string>, targetId: string | null): boolean {
	const selected = new Set(ids);
	if (selected.size === 0) return false;
	const byId = new Map(items.map((item) => [item.id, item]));
	if ([...selected].some((id) => !byId.has(id))) return false;
	if (targetId !== null && (!byId.has(targetId) || byId.get(targetId)!.heading)) return false;
	const ancestors = new Set<string>();
	let parent = targetId;
	while (parent !== null) {
		if (selected.has(parent) || ancestors.has(parent)) return false;
		ancestors.add(parent);
		parent = byId.get(parent)?.parentId ?? null;
	}
	const roots = new Set(selectedRoots(items, selected));
	if (roots.size === 0) return false;
	const moved = items.map((item) => roots.has(item.id) ? { ...item, parentId: targetId } : item);
	const movedIds = new Set<string>();
	for (const entry of buildItemTreeOrder(moved)) {
		if (roots.has(entry.item.id) || (entry.item.parentId !== null && movedIds.has(entry.item.parentId))) {
			if (entry.level > 2) return false;
			movedIds.add(entry.item.id);
		}
	}
	return true;
}

/** Return IDs of notes/subnotes whose parent, sibling, and child tasks/notes are all complete. */
export function getCompletedNoteIds(items: Item[], isDone: (item: Item) => boolean): Set<string> {
	const resolved = resolveParentLinks(items);
	const byId = new Map(resolved.map((item) => [item.id, item]));
	const childrenByParent = new Map<string | null, Item[]>();
	for (const item of resolved) {
		const siblings = childrenByParent.get(item.parentId) ?? [];
		siblings.push(item);
		childrenByParent.set(item.parentId, siblings);
	}

	const subtreeMemo = new Map<string, { complete: boolean; hasTask: boolean }>();
	function evalSubtree(id: string): { complete: boolean; hasTask: boolean } {
		const cached = subtreeMemo.get(id);
		if (cached) return cached;
		const item = byId.get(id)!;
		let complete = !item.heading && !item.note ? isDone(item) : true;
		let hasTask = !item.heading && !item.note;
		for (const child of childrenByParent.get(id) ?? []) {
			const childRes = evalSubtree(child.id);
			if (!childRes.complete) complete = false;
			if (childRes.hasTask) hasTask = true;
		}
		const res = { complete, hasTask };
		subtreeMemo.set(id, res);
		return res;
	}

	const noteCompleteMemo = new Map<string, boolean>();
	function isNoteComplete(id: string): boolean {
		const cached = noteCompleteMemo.get(id);
		if (cached !== undefined) return cached;
		const item = byId.get(id);
		if (!item || !item.note || item.heading) {
			noteCompleteMemo.set(id, false);
			return false;
		}

		let hasTask = false;
		let ancId = item.parentId;
		while (ancId !== null) {
			const anc = byId.get(ancId);
			if (!anc) break;
			if (anc.note && !anc.heading) {
				if (!isNoteComplete(anc.id)) {
					noteCompleteMemo.set(id, false);
					return false;
				}
				hasTask = true;
				break;
			}
			if (!anc.heading) {
				hasTask = true;
				if (!isDone(anc)) {
					noteCompleteMemo.set(id, false);
					return false;
				}
			}
			ancId = anc.parentId;
		}

		for (const sibling of childrenByParent.get(item.parentId) ?? []) {
			if (sibling.id === item.id) continue;
			const sibRes = evalSubtree(sibling.id);
			if (!sibRes.complete) {
				noteCompleteMemo.set(id, false);
				return false;
			}
			if (sibRes.hasTask) hasTask = true;
		}

		for (const child of childrenByParent.get(item.id) ?? []) {
			const childRes = evalSubtree(child.id);
			if (!childRes.complete) {
				noteCompleteMemo.set(id, false);
				return false;
			}
			if (childRes.hasTask) hasTask = true;
		}

		noteCompleteMemo.set(id, hasTask);
		return hasTask;
	}

	const result = new Set<string>();
	for (const item of resolved) {
		if (item.note && !item.heading && isNoteComplete(item.id)) {
			result.add(item.id);
		}
	}
	return result;
}
