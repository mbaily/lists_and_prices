// @ts-nocheck -- Exercise real moves and component actions against Yjs data.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp, componentFunctions, transpile } from './helpers/app.mjs';

for (const position of ['top', 'bottom']) {
	for (const nested of [false, true]) {
		test(`moving to the ${position} of ${nested ? 'a parent' : 'a list'} preserves displayed order and subtrees`, () => {
			const app = createApp(), d = app.data;
			try {
				const folder = d.createFolder('Folder', null);
				const source = d.createList('Source', folder, 'plain');
				const target = d.createList('Target', folder, 'plain');
				const firstParent = d.createItem(source, 'First parent');
				const first = d.createItem(source, 'First selected', null, firstParent, true);
				const descendant = d.createItem(source, 'Unselected descendant', null, first);
				const second = d.createItem(source, 'Second selected', null, firstParent);
				const secondParent = d.createItem(source, 'Second parent');
				const third = d.createItem(source, 'Third selected', null, secondParent);
				// Numeric item order differs from tree/display order across parents.
				d.updateItem(first, { order: -6 }); d.updateItem(second, { order: 20 }); d.updateItem(third, { order: -10 });
				const parentId = nested ? d.createItem(target, 'Target note', null, null, true) : null;
				const existingFirst = d.createItem(target, 'Existing first', null, parentId);
				const existingLast = d.createItem(target, 'Existing last', null, parentId);
				d.updateItem(existingFirst, { order: -20 }); d.updateItem(existingLast, { order: 40 });
				const beforeSource = d.readItems(source), beforeTarget = d.readItems(target);
				app.store.getUndoManager().clear();
				assert.equal(d.moveItemsToDestination(source, [third, second, first], { listId: target, parentId }, position), true);
				const moved = [first, descendant, second, third];
				const expected = position === 'top' ? [...moved, existingFirst, existingLast] : [existingFirst, existingLast, ...moved];
				assert.deepEqual(app.hierarchy.buildItemTreeOrder(d.readItems(target)).map(({ item }) => item.id),
					nested ? [parentId, ...expected] : expected);
				assert.deepEqual(app.hierarchy.buildItemTreeOrder(d.readItems(source)).map(({ item }) => item.id), [firstParent, secondParent]);
				assert.equal(app.store.getUndoCount(), 1);
				app.store.undoLastAction();
				assert.deepEqual(d.readItems(source), beforeSource);
				assert.deepEqual(d.readItems(target), beforeTarget);
			} finally { app.dispose(); }
		});
	}

	for (const action of ['mark', 'reparent']) {
		test(`a same-parent ${action} move to ${position} excludes moved siblings and keeps their order`, () => {
			const app = createApp(), d = app.data;
			try {
				const folder = d.createFolder('Folder', null), list = d.createList('List', folder, 'plain');
				const parent = d.createItem(list, 'Parent');
				const ids = ['A', 'B', 'C', 'D'].map((name) => d.createItem(list, name, null, parent));
				ids.forEach((id, index) => d.updateItem(id, { order: -20 + index * 5 }));
				const move = action === 'mark'
					? (selected) => d.moveItemsToDestination(list, selected, { listId: list, parentId: parent }, position)
					: (selected) => d.reparentItems(list, selected, parent, position);
				assert.equal(move([ids[2], ids[0]]), true);
				assert.deepEqual(d.readItems(list).filter((item) => item.parentId === parent).map((item) => item.name),
					position === 'top' ? ['A', 'C', 'B', 'D'] : ['B', 'D', 'A', 'C']);
				// An empty destination after excluding the selection still keeps order.
				assert.equal(move([...ids].reverse()), true);
				assert.deepEqual(d.readItems(list).filter((item) => item.parentId === parent).map((item) => item.name),
					position === 'top' ? ['A', 'C', 'B', 'D'] : ['B', 'D', 'A', 'C']);
			} finally { app.dispose(); }
		});
	}

	test(`moving to an empty destination at ${position} keeps selection order`, () => {
		const app = createApp(), d = app.data;
		try {
			const folder = d.createFolder('Folder', null), source = d.createList('Source', folder, 'plain');
			const target = d.createList('Target', folder, 'plain');
			const first = d.createItem(source, 'First'), second = d.createItem(source, 'Second');
			assert.equal(d.moveItemsToDestination(source, [second, first], { listId: target, parentId: null }, position), true);
			assert.deepEqual(d.readItems(target).map((item) => item.id), [first, second]);
		} finally { app.dispose(); }
	});
}

function homeMoveProbe(app, taggedId, kind, position) {
	const state = {
		commitState: { isHistorical: false }, taggedListId: kind === 'list' ? taggedId : null,
		taggedFolderId: kind === 'folder' ? taggedId : null,
		settings: { addListPosition: position, addItemPosition: position === 'top' ? 'bottom' : 'top' },
		readFolders: app.data.readFolders, readLists: app.data.readLists,
		updateFolder: app.data.updateFolder, updateList: app.data.updateList,
		isDescendant: app.data.isDescendant, isFolderEffectivelyArchived: app.data.isFolderEffectivelyArchived,
		getInsertionOrder: app.hierarchy.getInsertionOrder,
		get allFolders() { return this.readFolders(); },
		alert(message) { assert.fail(message); }
	};
	const source = componentFunctions('src/lib/components/HomeScreen.svelte', ['moveTaggedTo', 'clearTag']);
	const handlers = new Function('state', `with (state) { ${transpile(source)}; return { moveTaggedTo }; }`)(state);
	return { state, handlers };
}

for (const position of ['top', 'bottom']) {
	for (const kind of ['list', 'folder']) {
		for (const sameFolder of [false, true]) {
			test(`tagged ${kind} moves to ${position} ${sameFolder ? 'within' : 'across'} folders using Add lists & folders to`, () => {
				const app = createApp(), d = app.data;
				try {
					const source = d.createFolder('Source', null), target = d.createFolder('Target', null);
					const first = d.createFolder('Existing folder', target), last = d.createList('Existing list', target, 'plain');
					d.updateFolder(first, { order: -10 }); d.updateList(last, { order: 30 });
					const from = sameFolder ? target : source;
					const moved = kind === 'list' ? d.createList('Moving list', from, 'plain') : d.createFolder('Moving folder', from);
					if (kind === 'list') d.updateList(moved, { order: position === 'top' ? -50 : 50 });
					else d.updateFolder(moved, { order: position === 'top' ? -50 : 50 });
					const beforeFolders = d.readFolders(), beforeLists = d.readLists();
					const p = homeMoveProbe(app, moved, kind, position);
					app.store.getUndoManager().clear();
					p.handlers.moveTaggedTo(target);
					const siblings = [
						...d.readFolders().filter((folder) => folder.parentId === target),
						...d.readLists().filter((list) => list.folderId === target)
					].sort(app.hierarchy.compareOrder);
					assert.deepEqual(siblings.map((item) => item.id), position === 'top' ? [moved, first, last] : [first, last, moved]);
					assert.equal(siblings.find((item) => item.id === moved).order, position === 'top' ? -11 : 31);
					assert.equal(p.state.taggedListId, null); assert.equal(p.state.taggedFolderId, null);
					assert.equal(app.store.getUndoCount(), 1);
					app.store.undoLastAction();
					assert.deepEqual(d.readFolders(), beforeFolders); assert.deepEqual(d.readLists(), beforeLists);
				} finally { app.dispose(); }
			});
		}
	}

	test(`a tagged folder moved to root respects ${position}`, () => {
		const app = createApp(), d = app.data;
		try {
			const first = d.createFolder('First', null), last = d.createFolder('Last', null);
			const moved = d.createFolder('Moving', first);
			const p = homeMoveProbe(app, moved, 'folder', position);
			p.handlers.moveTaggedTo(null);
			assert.deepEqual(d.readFolders().filter((folder) => folder.parentId === null).sort(app.hierarchy.compareOrder).map((folder) => folder.id),
				position === 'top' ? [moved, first, last] : [first, last, moved]);
		} finally { app.dispose(); }
	});
}
