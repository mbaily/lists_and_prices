// @ts-nocheck -- Folders inside lists against real Yjs data.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp } from './helpers/app.mjs';

function fixture() {
	const app = createApp();
	const home = app.data.createFolder('Home', null);
	const source = app.data.createList('Source', home, 'plain');
	const target = app.data.createList('Target', home, 'priced');
	return { app, d: app.data, home, source, target };
}

const ids = (entries) => entries.map((entry) => entry.id);

test('items and folders share root order and views are scoped', () => {
	const { app, d, source } = fixture();
	try {
		const first = d.createItem(source, 'First');
		const folder = d.createListFolder(source, 'Folder');
		const last = d.createItem(source, 'Last');
		const inside = d.createItem(source, 'Inside', null, null, false, 'bottom', undefined, folder);
		const child = d.createItem(source, 'Child', null, inside);
		const rootChild = d.createItem(source, 'Root child', null, first, false, 'bottom', undefined, folder);
		assert.deepEqual(ids(d.readItems(source, null)).sort(), [first, last, rootChild].sort());
		assert.deepEqual(ids(d.readItems(source, folder)).sort(), [inside, child].sort());
		assert.equal(d.readItems(source).length, 5);
		const rows = app.load('src/lib/listFolders.ts').listRows(app.hierarchy.buildItemTreeOrder(d.readItems(source, null)), d.readListFolders(source).filter((entry) => entry.parentId === null));
		assert.deepEqual(rows.map((row) => row.item.id), [first, rootChild, folder, last]);
		d.reorderSiblings(source, null, 1, 0, null);
		assert.deepEqual(app.load('src/lib/listFolders.ts').listRows(app.hierarchy.buildItemTreeOrder(d.readItems(source, null)), d.readListFolders(source)).map((row) => row.item.id), [folder, first, rootChild, last]);
	} finally { app.dispose(); }
});

test('folder subtrees move across lists with one undo and cannot enter themselves', () => {
	const { app, d, source, target } = fixture();
	try {
		const outer = d.createListFolder(source, 'Outer');
		const inner = d.createListFolder(source, 'Inner', outer);
		const task = d.createItem(source, 'Task', null, null, false, 'bottom', undefined, inner);
		const sub = d.createItem(source, 'Sub', null, task);
		const loose = d.createItem(source, 'Loose');
		assert.equal(d.moveItemsToDestination(source, [outer], { listId: source, parentId: null, listFolderId: inner }), false);
		assert.equal(d.moveItemsToDestination(source, [outer], { listId: source, parentId: loose }), false);
		app.store.getUndoManager().clear();
		assert.equal(d.moveItemsToDestination(source, [outer, sub], { listId: target, parentId: null }), true);
		assert.deepEqual(ids(d.readListFolders(source)), []);
		assert.deepEqual(ids(d.readItems(source)), [loose]);
		const moved = d.readItems(target);
		assert.equal(moved.find((item) => item.id === sub).parentId, task, 'carried descendants keep task hierarchy');
		assert.equal(moved.find((item) => item.id === task).listFolderId, inner);
		assert.equal(d.readListFolders(target).find((folder) => folder.id === inner).parentId, outer);
		app.store.getUndoManager().undo();
		assert.deepEqual(ids(d.readListFolders(source)).sort(), [outer, inner].sort());
		assert.equal(d.readItems(source).find((item) => item.id === task).listFolderId, inner);
	} finally { app.dispose(); }
});

test('a selected child detaches into the destination folder and keeps its descendants', () => {
	const { d, source } = fixture();
	const folder = d.createListFolder(source, 'Folder');
	const parent = d.createItem(source, 'Parent');
	const child = d.createItem(source, 'Child', null, parent);
	const grandchild = d.createItem(source, 'Grandchild', null, child);
	assert.equal(d.moveItemsToDestination(source, [child], { listId: source, parentId: null, listFolderId: folder }), true);
	const items = d.readItems(source);
	assert.equal(items.find((item) => item.id === child).parentId, null);
	assert.equal(items.find((item) => item.id === child).listFolderId, folder);
	assert.equal(items.find((item) => item.id === grandchild).listFolderId, folder);
	assert.equal(items.find((item) => item.id === parent).listFolderId, null);
	assert.equal(d.reparentItems(source, [child], null, 'bottom', null), true);
	assert.equal(d.readItems(source).find((item) => item.id === grandchild).listFolderId, null);
});

test('deleting a folder removes its contents recursively', () => {
	const { d, source } = fixture();
	const outer = d.createListFolder(source, 'Outer');
	const inner = d.createListFolder(source, 'Inner', outer);
	const task = d.createItem(source, 'Task', null, null, false, 'bottom', undefined, inner);
	d.createItem(source, 'Sub', null, task);
	const keep = d.createItem(source, 'Keep');
	d.deleteListEntries(source, [outer]);
	assert.deepEqual(ids(d.readListFolders(source)), []);
	assert.deepEqual(ids(d.readItems(source)), [keep]);
});

test('a child created under a root parent stays at the root of the list', () => {
	const { d, source } = fixture();
	const folder = d.createListFolder(source, 'Folder');
	const parent = d.createItem(source, 'Parent');
	const child = d.createItem(source, 'Child', null, parent, false, 'bottom', undefined, folder);
	assert.equal(d.readItems(source).find((item) => item.id === child).listFolderId, null);
});

test('backups round-trip folders inside lists, including empty folders', () => {
	const { app, d, source, target } = fixture();
	try {
		const outer = d.createListFolder(source, 'Outer');
		const empty = d.createListFolder(source, 'Empty', outer);
		const task = d.createItem(source, 'Task', null, null, false, 'bottom', undefined, outer);
		const child = d.createItem(source, 'Child', null, task);
		const root = d.createItem(source, 'Root');
		const backup = JSON.parse(JSON.stringify(d.exportBackup()));
		assert.equal(backup.items.find((item) => item.id === root).listFolderId, undefined);
		assert.equal(backup.items.find((item) => item.id === task).listFolderId, outer);
		d.importBackup(backup, 'replace');
		assert.deepEqual(ids(d.readListFolders(source)).sort(), [outer, empty].sort());
		assert.equal(d.readItems(source).find((item) => item.id === child).listFolderId, outer);
		// Merge moves an item back to the root when the backup has it there.
		d.moveItemsToDestination(source, [root], { listId: source, parentId: null, listFolderId: empty });
		d.importBackup(backup, 'merge');
		assert.equal(d.readItems(source).find((item) => item.id === root).listFolderId, null);
		assert.throws(() => d.validateBackup({ ...backup, listFolders: [{ ...backup.listFolders[0], listId: target }, ...backup.listFolders.slice(1)] }), /same list/);
	} finally { app.dispose(); }
});

test('rollover keeps folder structure below the view and reuses matching folders', () => {
	const { app, d, source, target } = fixture();
	try {
		const view = d.createListFolder(source, 'View');
		const nested = d.createListFolder(source, 'Nested', view);
		const top = d.createItem(source, 'Top', null, null, false, 'bottom', undefined, view);
		const deep = d.createItem(source, 'Deep', null, null, false, 'bottom', undefined, nested);
		const existing = d.createListFolder(target, 'nested');
		app.store.getUndoManager().clear();
		assert.equal(d.moveItemsKeepingFolders(source, [top, deep], target, view), true);
		const moved = d.readItems(target);
		assert.equal(moved.find((item) => item.id === top).listFolderId, null);
		assert.equal(moved.find((item) => item.id === deep).listFolderId, existing);
		assert.deepEqual(ids(d.readListFolders(source)), [view], 'emptied source folder is deleted; the open view stays');
		app.store.getUndoManager().undo();
		assert.equal(d.readItems(target).length, 0);
		assert.deepEqual(ids(d.readListFolders(source)).sort(), [view, nested].sort(), 'undo restores the folder');
		assert.equal(d.moveItemsKeepingFolders(source, [deep], target, d.createListFolder(source, 'Elsewhere')), false);
	} finally { app.dispose(); }
});

test('rollover deletes source folders it empties, like a filesystem move', () => {
	const { app, d, source, target } = fixture();
	try {
		const outer = d.createListFolder(source, 'Outer');
		const inner = d.createListFolder(source, 'Inner', outer);
		const deep = d.createItem(source, 'Deep', null, null, false, 'bottom', undefined, inner);
		const mixed = d.createListFolder(source, 'Mixed');
		const leaving = d.createItem(source, 'Leaving', null, null, false, 'bottom', undefined, mixed);
		d.createItem(source, 'Staying', null, null, false, 'bottom', undefined, mixed);
		const empty = d.createListFolder(source, 'Empty');
		const sibling = d.createListFolder(source, 'Sibling');
		const keep = d.createListFolder(source, 'Keep', sibling);
		d.createItem(source, 'Kept', null, null, false, 'bottom', undefined, keep);
		const sibDeep = d.createListFolder(source, 'Sib deep', sibling);
		const sibItem = d.createItem(source, 'Sib item', null, null, false, 'bottom', undefined, sibDeep);
		assert.equal(d.moveItemsKeepingFolders(source, [deep, leaving, sibItem], target, null), true);
		assert.deepEqual(ids(d.readListFolders(source)).sort(), [mixed, empty, sibling, keep].sort(),
			'emptied chain Outer/Inner and Sib deep go; folders with remaining content or already empty stay');
		assert.deepEqual(d.readListFolders(target).map((folder) => folder.name).sort(), ['Inner', 'Mixed', 'Outer', 'Sib deep', 'Sibling']);
	} finally { app.dispose(); }
});

test('clipboard JSON round-trips nested and empty folders in sibling order', () => {
	const { app, d, source, target } = fixture();
	try {
		const lf = app.load('src/lib/listFolders.ts');
		const first = d.createItem(source, 'First');
		const folder = d.createListFolder(source, 'Folder');
		d.createListFolder(source, 'Empty', folder);
		const inside = d.createItem(source, 'Inside', null, null, false, 'bottom', undefined, folder);
		d.createItem(source, 'Inside child', null, inside, true);
		d.createItem(source, 'Last');
		const entries = lf.clipboardEntries(d.readItems(source), d.readListFolders(source), null);
		const payload = entries.map((entry) => entry.kind === 'folder'
			? { id: entry.folder.id, name: entry.folder.name, folder: true, ...(entry.parentId ? { parentId: entry.parentId } : {}) }
			: { id: entry.item.id, name: entry.item.name, ...(entry.item.note ? { note: true } : {}), ...(entry.parentId ? { parentId: entry.parentId } : {}) });
		const dest = d.createListFolder(target, 'Dest');
		d.createItemsFromExport(target, payload, { listFolderId: dest });
		const folders = d.readListFolders(target);
		const copied = folders.find((entry) => entry.name === 'Folder');
		assert.equal(copied.parentId, dest);
		assert.equal(folders.find((entry) => entry.name === 'Empty').parentId, copied.id);
		const rows = lf.listRows(app.hierarchy.buildItemTreeOrder(d.readItems(target, dest)), folders.filter((entry) => entry.parentId === dest));
		assert.deepEqual(rows.map((row) => row.item.name), ['First', 'Folder', 'Last']);
		const insideCopy = d.readItems(target, copied.id);
		assert.deepEqual(app.hierarchy.buildItemTreeOrder(insideCopy).map(({ item, level }) => `${level}:${item.name}`), ['0:Inside', '1:Inside child']);
		assert.ok(!ids(insideCopy).includes(first) && !ids(d.readItems(target)).includes(first), 'copies get new ids');
		void first;
	} finally { app.dispose(); }
});
