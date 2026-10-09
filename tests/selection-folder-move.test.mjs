// @ts-nocheck -- Exercise the actual selection-bar handlers with real Yjs data.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp, componentFunctions, transpile, Y } from './helpers/app.mjs';

function fixture(position = 'top', itemPosition = 'bottom') {
	const app = createApp(), d = app.data;
	const folder = d.createFolder('Folder', null);
	const first = d.createList('First', folder, 'plain');
	const source = d.createList('Source', folder, 'plain');
	const last = d.createList('Last', folder, 'priced');
	d.updateList(first, { order: -20 });
	d.updateList(source, { order: 5 });
	d.updateList(last, { order: 40 });
	const state = {
		listId: source, canEditList: true, selectedIds: new Set(),
		selectionMode: true, showSelectionPanel: false, selectedMoveMark: '', markMoveError: '',
		settings: { addListPosition: position, addItemPosition: itemPosition },
		readLists: d.readLists, readFolders: d.readFolders,
		isListEffectivelyArchived: d.isListEffectivelyArchived,
		moveItemsToDestination: d.moveItemsToDestination,
		alert(message) { assert.fail(message); }
	};
	const functions = componentFunctions('src/lib/components/ListScreen.svelte', [
		'getFolderMoveTarget', 'moveSelectedToFolderEdge', 'exitSelectionMode'
	]);
	const handlers = new Function('state', `with (state) { ${transpile(functions)}; return { getFolderMoveTarget, moveSelectedToFolderEdge }; }`)(state);
	const target = () => handlers.getFolderMoveTarget(d.readLists(), d.readFolders());
	return { app, d, folder, first, source, last, state, handlers, target };
}

for (const position of ['top', 'bottom']) {
	for (const itemPosition of ['top', 'bottom']) {
		test(`selection shortcut chooses the ${position} list and inserts subtrees at its ${itemPosition}, with one undo`, () => {
			const p = fixture(position, itemPosition), { d, app } = p;
			try {
				const parentA = d.createItem(p.source, 'Unselected first parent');
				const todo = d.createItem(p.source, 'Selected todo', 4.5, parentA);
				const noteChild = d.createItem(p.source, 'Unselected rich subnote', null, todo, true);
				const grandchild = d.createItem(p.source, 'Unselected grandchild', null, noteChild);
				const parentB = d.createItem(p.source, 'Unselected second parent');
				const note = d.createItem(p.source, 'Selected note', null, parentB, true);
				const todoChild = d.createItem(p.source, 'Unselected subtask', null, note);
				// Root numeric order differs from the source tree's display order.
				d.updateItem(todo, { order: 20, qty: 2, checked: true, pinned: true });
				d.updateItem(note, { order: -20, fullScreen: true });
				const checkbox = d.addFolderCheckbox(p.folder, 'Done');
				d.setItemCheckboxState(todo, checkbox, true);
				const text = d.getItemYText(app.doc, noteChild);
				text.format(0, 10, { bold: true });
				const delta = text.toDelta();
				const destination = position === 'top' ? p.first : p.last;
				const existingFirst = d.createItem(destination, 'Existing first');
				const existingLast = d.createItem(destination, 'Existing last');
				const beforeSource = d.readItems(p.source), beforeTarget = d.readItems(destination);
				p.state.selectedIds = new Set([note, noteChild, todo]);
				app.store.getUndoManager().clear();
				p.handlers.moveSelectedToFolderEdge();
				const moved = [todo, noteChild, grandchild, note, todoChild];
				assert.deepEqual(app.hierarchy.buildItemTreeOrder(d.readItems(destination)).map(({ item }) => item.id),
					itemPosition === 'top' ? [...moved, existingFirst, existingLast] : [existingFirst, existingLast, ...moved]);
				assert.deepEqual(d.readItems(p.source).map((item) => item.id), [parentA, parentB]);
				for (const before of beforeSource.filter((item) => moved.includes(item.id))) {
					const after = d.readItems(destination).find((item) => item.id === before.id);
					assert.equal(after.parentId, [todo, note].includes(before.id) ? null : before.parentId);
					for (const key of ['name', 'note', 'checks', 'checked', 'price', 'qty', 'pinned', 'fullScreen', 'createdAt']) {
						assert.deepEqual(after[key], before[key], key);
					}
				}
				assert.deepEqual(d.getItemYText(app.doc, noteChild).toDelta(), delta);
				assert.equal(p.state.selectionMode, false);
				assert.equal(p.state.selectedIds.size, 0);
				assert.equal(app.store.getUndoCount(), 1);
				app.store.undoLastAction();
				assert.deepEqual(d.readItems(p.source), beforeSource);
				assert.deepEqual(d.readItems(destination), beforeTarget);
			} finally { app.dispose(); }
		});
	}

	test(`the ${position} destination skips dividers, archived lists and lists outside the current folder`, () => {
		const p = fixture(position), { d, app } = p;
		try {
			for (const order of [-100, 100]) {
				const archived = d.createList('Archived', p.folder, 'plain');
				d.updateList(archived, { archived: true, order });
				const divider = d.createList('Divider', p.folder, 'divider');
				d.updateList(divider, { order });
				const subfolder = d.createFolder('Subfolder', p.folder);
				const nested = d.createList('Nested list', subfolder, 'plain');
				d.updateList(nested, { order });
				const elsewhere = d.createList('Other folder', d.createFolder('Other', null), 'plain');
				d.updateList(elsewhere, { order });
			}
			assert.equal(p.target().id, position === 'top' ? p.first : p.last);
			// Archiving an ancestor also makes the destination unavailable.
			d.updateFolder(p.folder, { archived: true });
			assert.equal(p.target(), null);
		} finally { app.dispose(); }
	});
}

test('the shortcut rereads list order and the user setting at click time', () => {
	const p = fixture(), { d, app } = p;
	try {
		const item = d.createItem(p.source, 'Selected');
		p.state.selectedIds = new Set([item]);
		assert.equal(p.target().id, p.first);
		p.state.settings.addListPosition = 'bottom';
		d.updateList(p.first, { order: 100 });
		p.handlers.moveSelectedToFolderEdge();
		assert.deepEqual(d.readItems(p.first).map((entry) => entry.id), [item]);
		assert.equal(d.readItems(p.last).length, 0);
	} finally { app.dispose(); }
});

test('lists with equal order use the same first and last entries displayed in the folder', () => {
	const p = fixture();
	try {
		for (const id of [p.first, p.source, p.last]) p.d.updateList(id, { order: 0 });
		assert.equal(p.target().id, p.first);
		p.state.settings.addListPosition = 'bottom';
		assert.equal(p.target().id, p.last);
	} finally { p.app.dispose(); }
});

for (const condition of ['empty selection', 'already in destination', 'only list', 'deleted source', 'historical view', 'stale selection']) {
	test(`the shortcut preserves data and selection with ${condition}`, () => {
		const p = fixture(), { d, app } = p;
		try {
			const item = d.createItem(p.source, 'Selected');
			p.state.selectedIds = new Set([item]);
			if (condition === 'empty selection') p.state.selectedIds.clear();
			if (condition === 'already in destination') d.updateList(p.source, { order: -100 });
			if (condition === 'only list') { d.deleteList(p.first); d.deleteList(p.last); }
			if (condition === 'deleted source') d.deleteList(p.source);
			if (condition === 'historical view') p.state.canEditList = false;
			if (condition === 'stale selection') {
				p.state.selectedIds.add('deleted-item');
				p.state.alert = (message) => assert.match(message, /selection may have changed/);
			}
			const before = Y.encodeStateAsUpdate(app.doc), selection = [...p.state.selectedIds];
			p.handlers.moveSelectedToFolderEdge();
			assert.deepEqual(Y.encodeStateAsUpdate(app.doc), before);
			assert.deepEqual([...p.state.selectedIds], selection);
			assert.equal(p.state.selectionMode, true);
		} finally { app.dispose(); }
	});
}
