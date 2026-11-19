import type { Item, ListFolder } from './data';
import { buildItemTreeOrder, compareOrder, type TreeItem } from './hierarchy';

export function listFolderPath(folders: ReadonlyMap<string, ListFolder>, id: string | null | undefined): ListFolder[] {
	const path: ListFolder[] = [];
	const visited = new Set<string>();
	while (id && !visited.has(id)) {
		const folder = folders.get(id);
		if (!folder) break;
		path.push(folder);
		visited.add(id);
		id = folder.parentId;
	}
	return path.reverse();
}

export function listFolderDescendants(folders: ListFolder[], ids: Iterable<string>): Set<string> {
	const byParent = new Map<string, string[]>();
	for (const folder of folders) {
		if (folder.parentId === null) continue;
		const children = byParent.get(folder.parentId) ?? [];
		children.push(folder.id);
		byParent.set(folder.parentId, children);
	}
	const requested = new Set(ids);
	const pending = folders.filter(folder => requested.has(folder.id)).map(folder => folder.id);
	const descendants = new Set<string>();
	while (pending.length) {
		const id = pending.pop()!;
		if (descendants.has(id)) continue;
		descendants.add(id);
		for (const child of byParent.get(id) ?? []) pending.push(child);
	}
	return descendants;
}

export type ListRow = (TreeItem & { folder?: undefined }) | (Omit<TreeItem, 'item'> & { item: ListFolder; folder: ListFolder });

/** Share root order with folders while keeping each task's subtree together. */
export function listRows(tree: TreeItem[], folders: ListFolder[]): ListRow[] {
	const itemRoots = tree.filter(row => row.level === 0).map(row => row.item);
	const roots = [...itemRoots, ...folders].sort(compareOrder);
	const positions = new Map(roots.map((root, index) => [root.id, index]));
	const rows: ListRow[][] = roots.map(() => []);
	for (const row of tree) {
		const position = positions.get(itemRoots[row.rootTlIdx].id)!;
		rows[position].push(row.level === 0
			? { ...row, tlIdx: position, rootTlIdx: position, sibIdx: position }
			: { ...row, rootTlIdx: position });
	}
	for (const folder of folders) {
		const position = positions.get(folder.id)!;
		rows[position].push({ item: folder, folder, level: 0, tlIdx: position, rootTlIdx: position, sibIdx: position });
	}
	return rows.flat();
}

export function listFolderPathLabel(folders: ReadonlyMap<string, ListFolder>, id: string | null | undefined, separator = ' › '): string {
	return listFolderPath(folders, id).map(folder => folder.name).join(separator);
}

export type ClipboardEntry =
	| { kind: 'item'; item: Item; parentId: string | null }
	| { kind: 'folder'; folder: ListFolder; parentId: string | null };

/** Rows of a view in display order. Folder rows carry their whole subtree,
 * and root items inside an exported folder name that folder as parent. */
export function clipboardEntries(items: Item[], folders: ListFolder[], viewFolderId: string | null, selected?: ReadonlySet<string>): ClipboardEntry[] {
	const entries: ClipboardEntry[] = [];
	const visited = new Set<string>();
	const emit = (folderId: string | null, filter?: ReadonlySet<string>) => {
		const tree = buildItemTreeOrder(items.filter(item => (item.listFolderId ?? null) === folderId));
		for (const row of listRows(tree, folders.filter(folder => folder.parentId === folderId))) {
			if (filter && !filter.has(row.item.id)) continue;
			const containerId = folderId === viewFolderId ? null : folderId;
			if (row.folder) {
				if (visited.has(row.folder.id)) continue;
				visited.add(row.folder.id);
				entries.push({ kind: 'folder', folder: row.folder, parentId: containerId });
				emit(row.folder.id);
			} else {
				entries.push({ kind: 'item', item: row.item, parentId: row.item.parentId ?? containerId });
			}
		}
	};
	emit(viewFolderId, selected);
	return entries;
}
