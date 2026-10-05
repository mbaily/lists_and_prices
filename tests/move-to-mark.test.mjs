// @ts-nocheck -- Real Yjs moves and the actual selection-panel handlers.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';
import { createApp, componentFunctions, merge, root, transpile, Y } from './helpers/app.mjs';

function fixture() {
	const app = createApp();
	const folder = app.data.createFolder('Folder', null);
	const source = app.data.createList('Source', folder, 'plain');
	const target = app.data.createList('Target', folder, 'priced');
	const moving = app.load('src/lib/itemMove.ts');
	return { app, folder, source, target, moving, destination: { listId: target, parentId: null } };
}

test('cross-list moves keep IDs, rich note text, attributes and unselected descendants, with one undo', () => {
	const p = fixture(), d = p.app.data;
	try {
		const parent = d.createItem(p.source, 'Parent', 4.5);
		const note = d.createItem(p.source, 'Rich note', null, parent, true);
		const child = d.createItem(p.source, 'Child', null, note);
		const heading = d.createItem(p.source, 'Heading');
		const remaining = d.createItem(p.source, 'Stay here');
		d.updateItem(parent, { qty: 2, checked: true, pinned: true });
		d.updateItem(note, { fullScreen: true });
		d.updateItem(heading, { heading: true });
		d.setItemCheckboxState(parent, 'custom-check', true);
		const text = d.getItemYText(p.app.doc, note);
		text.format(0, 4, { bold: true });
		const delta = text.toDelta();
		const existing = d.createItem(p.target, 'Existing');
		const sourceBefore = d.readItems(p.source);
		p.app.store.getUndoManager().clear();
		assert.equal(d.moveItemsToDestination(p.source, [heading, note, parent], p.destination), true);
		assert.deepEqual(d.readItems(p.source).map((item) => item.id), [remaining]);
		const moved = d.readItems(p.target);
		assert.deepEqual(p.app.hierarchy.buildItemTreeOrder(moved).map(({ item }) => item.id), [existing, parent, note, child, heading]);
		assert.equal(moved.find((item) => item.id === parent).parentId, null);
		assert.equal(moved.find((item) => item.id === note).parentId, parent);
		assert.equal(moved.find((item) => item.id === child).parentId, note);
		for (const before of sourceBefore.filter((item) => item.id !== remaining)) {
			const after = moved.find((item) => item.id === before.id);
			for (const key of ['name', 'price', 'qty', 'checked', 'heading', 'note', 'pinned', 'fullScreen', 'createdAt', 'checks']) {
				assert.deepEqual(after[key], before[key], key);
			}
		}
		assert.equal(d.getItemYText(p.app.doc, note), text);
		assert.deepEqual(text.toDelta(), delta);
		assert.equal(p.app.store.getUndoCount(), 1);
		p.app.store.undoLastAction();
		assert.deepEqual(d.readItems(p.source), sourceBefore);
		assert.deepEqual(d.readItems(p.target).map((item) => item.id), [existing]);
		assert.deepEqual(text.toDelta(), delta);
	} finally { p.app.dispose(); }
});

test('moving only a subtask makes it a root while keeping its descendants and the original parent', () => {
	const p = fixture(), d = p.app.data;
	try {
		const parent = d.createItem(p.source, 'Parent');
		const child = d.createItem(p.source, 'Child', null, parent);
		const grandchild = d.createItem(p.source, 'Grandchild', null, child);
		assert.equal(d.moveItemsToDestination(p.source, [child], p.destination), true);
		assert.deepEqual(d.readItems(p.source).map((item) => item.id), [parent]);
		assert.equal(d.readItems(p.target).find((item) => item.id === child).parentId, null);
		assert.equal(d.readItems(p.target).find((item) => item.id === grandchild).parentId, child);
	} finally { p.app.dispose(); }
});

test('item destinations accept compatible parents but reject cycles, headings and excessive depth', () => {
	const p = fixture(), d = p.app.data;
	try {
		const task = d.createItem(p.source, 'Task');
		const subnote = d.createItem(p.source, 'Subnote', null, task, true);
		const parent = d.createItem(p.target, 'Target note', null, null, true);
		const deep = d.createItem(p.target, 'Deep target', null, parent);
		assert.equal(d.moveItemsToDestination(p.source, [task], { listId: p.target, parentId: deep }), false);
		assert.equal(d.moveItemsToDestination(p.source, [task], { listId: p.source, parentId: subnote }), false);
		assert.equal(d.moveItemsToDestination(p.source, [task], { listId: p.target, parentId: parent }), true);
		assert.equal(d.readItems(p.target).find((item) => item.id === task).parentId, parent);
		assert.equal(d.moveItemsToDestination(p.target, [task], { listId: p.target, parentId: null }), true);
		assert.equal(d.readItems(p.target).find((item) => item.id === task).parentId, null);
		d.updateItem(parent, { heading: true });
		assert.equal(d.moveItemsToDestination(p.target, [task], { listId: p.target, parentId: parent }), false);
	} finally { p.app.dispose(); }
});

test('incompatible, missing and archived destinations never partially move a selection', () => {
	const p = fixture(), d = p.app.data;
	try {
		const task = d.createItem(p.source, 'Task');
		const foreign = d.createItem(p.target, 'Foreign');
		const divider = d.createList('Divider', p.folder, 'divider');
		const archivedFolder = d.createFolder('Archived folder', null);
		const archivedList = d.createList('Archived list', archivedFolder, 'plain');
		d.updateFolder(archivedFolder, { archived: true });
		const before = Y.encodeStateAsUpdate(p.app.doc);
		for (const [ids, destination] of [
			[[task], { listId: 'deleted', parentId: null }],
			[[task], { listId: divider, parentId: null }],
			[[task], { listId: archivedList, parentId: null }],
			[[task, 'missing'], p.destination], [[task, foreign], p.destination],
			[[], p.destination], [[task], { listId: p.target, parentId: 'missing' }]
		]) assert.equal(d.moveItemsToDestination(p.source, ids, destination), false);
		assert.deepEqual(Y.encodeStateAsUpdate(p.app.doc), before);
	} finally { p.app.dispose(); }
});

test('moving between folder checkbox configurations retains completion and matches checkbox names', () => {
	const p = fixture(), d = p.app.data;
	try {
		const bought = d.addFolderCheckbox(p.folder, 'Bought');
		const packed = d.addFolderCheckbox(p.folder, 'Packed');
		const otherFolder = d.createFolder('Other', null);
		const otherBought = d.addFolderCheckbox(otherFolder, 'BOUGHT');
		const otherPacked = d.addFolderCheckbox(otherFolder, 'Packed');
		const destination = d.createList('Destination', otherFolder, 'plain');
		const task = d.createItem(p.source, 'Task');
		d.setItemCheckboxState(task, bought, true);
		d.setItemCheckboxState(task, packed, false);
		assert.equal(d.moveItemsToDestination(p.source, [task], { listId: destination, parentId: null }), true);
		let item = d.readItems(destination)[0];
		assert.equal(item.checks[otherBought], true);
		assert.equal(item.checks[otherPacked], false);
		d.setItemCheckboxState(task, otherPacked, true);
		const plainFolder = d.createFolder('Plain', null);
		const plain = d.createList('Plain', plainFolder, 'plain');
		assert.equal(d.moveItemsToDestination(destination, [task], { listId: plain, parentId: null }), true);
		item = d.readItems(plain)[0];
		assert.equal(item.checked, true);
		assert.equal(d.moveItemsToDestination(plain, [task], { listId: destination, parentId: null }), true);
		item = d.readItems(destination)[0];
		assert.equal(item.checks[otherBought], true);
		assert.equal(item.checks[otherPacked], true);
	} finally { p.app.dispose(); }
});

test('moves merge with concurrent note edits without duplicating text or IDs', () => {
	const p = fixture(), peer = createApp(), d = p.app.data;
	try {
		const note = d.createItem(p.source, 'Note', null, null, true);
		Y.applyUpdate(peer.doc, Y.encodeStateAsUpdate(p.app.doc), 'peer');
		peer.data.getItemYText(peer.doc, note).insert(4, ' edited elsewhere');
		assert.equal(d.moveItemsToDestination(p.source, [note], p.destination), true);
		merge(p.app.doc, peer.doc);
		for (const app of [p.app, peer]) {
			assert.equal(app.data.readItems(p.source).length, 0);
			assert.deepEqual(app.data.readItems(p.target).map((item) => [item.id, item.name]), [[note, 'Note edited elsewhere']]);
		}
	} finally { p.app.dispose(); peer.dispose(); }
});

function selectionProbe() {
	const p = fixture();
	const task = p.app.data.createItem(p.source, 'Task');
	const state = {
		listId: p.source, canEditList: true, selectedIds: new Set([task]), selectedMoveMark: 'work',
		selectionMode: true, showSelectionPanel: true, markMoveError: '',
		settings: { addItemPosition: 'bottom', addListPosition: 'bottom' },
		DEFAULT_MARK_NAME: p.app.load('src/lib/destinationMarks.ts').DEFAULT_MARK_NAME,
		destinationMarks: { work: { kind: 'list', id: p.target } },
		readLists: p.app.data.readLists, readFolders: p.app.data.readFolders, readAllItems: p.app.data.readAllItems,
		isListEffectivelyArchived: p.app.data.isListEffectivelyArchived,
		moveItemsToDestination: p.app.data.moveItemsToDestination, reparentItems: p.app.data.reparentItems, ...p.moving,
		get allLists() { return this.readLists(); }, get allFolders() { return this.readFolders(); },
		get allItemsAll() { return this.readAllItems(); }, get items() { return p.app.data.readItems(p.source); }
	};
	state.latestMarks = state.destinationMarks;
	state.getDestinationMark = (name) => state.latestMarks[name] ?? null;
	state.readDestinationMarks = () => state.latestMarks;
	const source = componentFunctions('src/lib/components/ListScreen.svelte', ['moveSelectedToMark', 'reparentSelectedTo', 'refreshDestinationMarks', 'exitSelectionMode']);
	const handlers = new Function('state', `with (state) { ${transpile(source)}; return { moveSelectedToMark, reparentSelectedTo }; }`)(state);
	const script = readFileSync(path.join(root, 'src/lib/components/ListScreen.svelte'), 'utf8').match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];
	const ast = ts.createSourceFile('ListScreen.ts', script, ts.ScriptTarget.Latest, true);
	const derived = ast.statements.filter(ts.isVariableStatement).flatMap((node) => [...node.declarationList.declarations]).find((node) => node.name.getText(ast) === 'compatibleMoveMarks').initializer.arguments[0];
	const choices = new Function('state', `with (state) { ${transpile('const choices = ' + derived.getText(ast))}; return choices; }`)(state);
	return { ...p, task, state, handlers, choices };
}

test('the picker lists only marks that can accept the current selection', () => {
	const p = selectionProbe(), d = p.app.data;
	try {
		const parent = d.createItem(p.source, 'Parent');
		const child = d.createItem(p.source, 'Child', null, parent);
		const note = d.createItem(p.target, 'Destination note', null, null, true);
		const divider = d.createList('Divider', p.folder, 'divider');
		const archived = d.createList('Archived', p.folder, 'plain');
		d.updateList(archived, { archived: true });
		p.state.selectedIds = new Set([parent]);
		p.state.destinationMarks = {
			work: { kind: 'list', id: p.target }, note: { kind: 'note', id: note },
			folder: { kind: 'folder', id: p.folder }, sheet: { kind: 'sheet', id: 'sheet' },
			deleted: { kind: 'list', id: 'deleted' }, divider: { kind: 'list', id: divider },
			archived: { kind: 'list', id: archived }, cycle: { kind: 'todo', id: child },
			wrongKind: { kind: 'todo', id: note }
		};
		assert.deepEqual(p.choices().map((mark) => mark.name), ['note', 'work']);
	} finally { p.app.dispose(); }
});

test('the move button uses the chosen mark and closes selection only on success', () => {
	const p = selectionProbe();
	try {
		p.handlers.moveSelectedToMark();
		assert.deepEqual(p.app.data.readItems(p.target).map((item) => item.id), [p.task]);
		assert.equal(p.state.selectionMode, false);
		assert.equal(p.state.showSelectionPanel, false);
		assert.equal(p.state.selectedIds.size, 0);
		assert.equal(p.state.selectedMoveMark, '');
	} finally { p.app.dispose(); }
});

for (const position of ['top', 'bottom']) {
	for (const action of ['mark', 'reparent']) {
		test(`the ${action} action uses the current Add items to ${position} setting and displayed selection order`, () => {
			const p = selectionProbe(), d = p.app.data;
			try {
				const second = d.createItem(p.source, 'Second');
				const parent = action === 'reparent' ? d.createItem(p.source, 'Destination') : null;
				const target = action === 'reparent' ? p.source : p.target;
				const existing = d.createItem(target, 'Existing', null, parent);
				p.state.selectedIds = new Set([second, p.task]);
				p.state.settings.addItemPosition = position;
				p.state.settings.addListPosition = position === 'top' ? 'bottom' : 'top';
				if (action === 'mark') p.handlers.moveSelectedToMark();
				else p.handlers.reparentSelectedTo(parent);
				assert.deepEqual(d.readItems(target).filter((item) => item.parentId === parent).map((item) => item.id),
					position === 'top' ? [p.task, second, existing] : [existing, p.task, second]);
				assert.equal(p.state.selectionMode, false);
			} finally { p.app.dispose(); }
		});
	}
}

for (const change of ['removed mark', 'incompatible mark', 'deleted destination', 'historical view']) {
	test(`a ${change} between picking and moving preserves the selection and source data`, () => {
		const p = selectionProbe();
		try {
			if (change === 'removed mark') p.state.latestMarks = {};
			if (change === 'incompatible mark') p.state.latestMarks = { work: { kind: 'folder', id: p.folder } };
			if (change === 'deleted destination') p.app.data.deleteList(p.target);
			if (change === 'historical view') p.state.canEditList = false;
			const before = Y.encodeStateAsUpdate(p.app.doc);
			p.handlers.moveSelectedToMark();
			assert.deepEqual(Y.encodeStateAsUpdate(p.app.doc), before);
			assert.deepEqual([...p.state.selectedIds], [p.task]);
			assert.equal(p.state.selectionMode, true);
			if (change !== 'historical view') assert.match(p.state.markMoveError, /no longer compatible/);
		} finally { p.app.dispose(); }
	});
}
