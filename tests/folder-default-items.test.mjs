// @ts-nocheck -- Exercise real Yjs data and dialog handlers with explicit UI state.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp, merge, componentFunctions, transpile, Y } from './helpers/app.mjs';

function app(t) {
	const fixture = createApp();
	t.after(() => fixture.dispose());
	return fixture;
}

function defaults(fixture, folder) {
	return fixture.data.readFolders().find(entry => entry.id === folder).defaultItems;
}

test('new plain and priced lists copy ordered todos and multiline notes with fresh IDs and editable text', t => {
	const a = app(t), folder = a.data.createFolder('Packing', null);
	const todo = a.data.addFolderDefaultItem(folder, '  Passport  ');
	const note = a.data.addFolderDefaultItem(folder, 'Hotel\nBooking number', true);
	const last = a.data.addFolderDefaultItem(folder, 'Charger');
	a.data.moveFolderDefaultItem(folder, last, 'up');
	const templateIds = defaults(a, folder).map(item => item.id);
	const listIds = ['plain', 'priced'].map(type => a.data.createList(type, folder, type, '#123456', 'top', true));
	const copied = listIds.map(id => a.data.readItems(id));
	for (const rows of copied) {
		assert.deepEqual(rows.map(item => [item.name, item.note]), [['Passport', false], ['Charger', false], ['Hotel\nBooking number', true]]);
		assert.ok(rows.every(item => !item.checked && item.parentId === null && item.price === null && !templateIds.includes(item.id)));
		assert.deepEqual(rows.map(item => item.checks), [{}, {}, {}]);
		assert.deepEqual(rows.map(item => item.order), [0, 1, 2]);
		for (const item of rows) {
			assert.equal(a.doc.getMap('note-text-initialized').get(item.id), true);
			assert.equal(a.data.getItemYText(a.doc, item.id).toString(), item.name);
		}
	}
	assert.equal(new Set(copied.flat().map(item => item.id)).size, 6);
	a.data.updateItem(copied[0][0].id, { checked: true, name: 'Packed passport' });
	assert.equal(copied[1][0].name, a.data.readItems(listIds[1])[0].name);
	assert.deepEqual(defaults(a, folder).map(item => item.id), [todo, last, note]);
});

test('defaults apply to future lists in the direct folder, excluding dividers, existing lists and moved lists', t => {
	const a = app(t), folder = a.data.createFolder('Travel', null);
	const before = a.data.createList('Before defaults', folder, 'plain');
	const first = a.data.addFolderDefaultItem(folder, 'Original');
	const removed = a.data.addFolderDefaultItem(folder, 'Remove me', true);
	const original = a.data.createList('Original copies', folder, 'plain');
	const originalRows = a.data.readItems(original);
	a.data.updateFolderDefaultItem(folder, first, { name: 'Updated', note: true });
	a.data.removeFolderDefaultItem(folder, removed);
	const after = a.data.createList('After edits', folder, 'plain');
	assert.deepEqual(a.data.readItems(after).map(item => [item.name, item.note]), [['Updated', true]]);
	assert.deepEqual(a.data.readItems(original), originalRows);
	assert.deepEqual(a.data.readItems(before), []);
	const nested = a.data.createFolder('Nested', folder);
	for (const id of [a.data.createList('Nested', nested, 'plain'), a.data.createList('Root', null, 'plain'), a.data.createList('Divider', folder, 'divider')]) {
		assert.deepEqual(a.data.readItems(id), []);
	}
	const moved = a.data.createList('Move into Travel', nested, 'plain');
	a.data.updateList(moved, { folderId: folder });
	assert.deepEqual(a.data.readItems(moved), []);
});

test('creating a populated list is one undo action and leaves the folder defaults intact', t => {
	const a = app(t), folder = a.data.createFolder('Reusable', null);
	a.data.addFolderDefaultItem(folder, 'Todo');
	a.data.addFolderDefaultItem(folder, 'Note', true);
	const templates = defaults(a, folder);
	a.store.getUndoManager().clear();
	const id = a.data.createList('Trip', folder, 'plain');
	assert.equal(a.data.readItems(id).length, 2);
	assert.equal(a.store.getUndoCount(), 1);
	assert.equal(a.store.undoLastAction(), true);
	assert.deepEqual(a.data.readLists(), []);
	assert.deepEqual(a.data.readAllItems(), []);
	assert.deepEqual(defaults(a, folder), templates);
	assert.equal(a.data.readItems(a.data.createList('Next trip', folder, 'plain')).length, 2);
});

test('independent additions and edits converge, and removal wins over a concurrent edit', t => {
	const a = app(t), b = app(t), folder = a.data.createFolder('Shared', null);
	merge(a.doc, b.doc);
	const first = a.data.addFolderDefaultItem(folder, 'Alice');
	const second = b.data.addFolderDefaultItem(folder, 'Bob', true);
	merge(a.doc, b.doc);
	assert.deepEqual(defaults(a, folder), defaults(b, folder));
	assert.deepEqual(defaults(a, folder).map(item => item.name).sort(), ['Alice', 'Bob']);
	a.data.updateFolderDefaultItem(folder, first, { name: 'Anne' });
	b.data.updateFolderDefaultItem(folder, first, { note: true });
	merge(a.doc, b.doc);
	assert.deepEqual(defaults(a, folder).find(item => item.id === first), { id: first, name: 'Anne', note: true });
	a.data.removeFolderDefaultItem(folder, first);
	b.data.updateFolderDefaultItem(folder, first, { name: 'Concurrent edit' });
	merge(a.doc, b.doc);
	assert.deepEqual(defaults(a, folder), [{ id: second, name: 'Bob', note: true }]);
	assert.deepEqual(defaults(a, folder), defaults(b, folder));
	const state = Y.encodeStateAsUpdate(a.doc);
	defaults(a, folder);
	assert.deepEqual(Y.encodeStateAsUpdate(a.doc), state, 'reading defaults must not write migrations');
	const created = b.data.createList('From another device', folder, 'plain');
	merge(a.doc, b.doc);
	assert.deepEqual(a.data.readItems(created).map(item => [item.name, item.note]), [['Bob', true]]);
});

test('defaults round-trip through backups without seeding restored lists, with safe legacy and invalid imports', t => {
	const a = app(t), folder = a.data.createFolder('Backed up', null);
	const template = a.data.addFolderDefaultItem(folder, 'Remember', true);
	const list = a.data.createList('Existing', folder, 'plain');
	const savedRows = a.data.readItems(list);
	const backup = JSON.parse(JSON.stringify(a.data.exportBackup()));
	a.data.removeFolderDefaultItem(folder, template);
	a.data.importBackup(backup, 'merge');
	assert.deepEqual(defaults(a, folder), backup.folders[0].defaultItems);
	assert.deepEqual(a.data.readItems(list), savedRows);
	a.data.importBackup(backup, 'replace');
	assert.deepEqual(defaults(a, folder), backup.folders[0].defaultItems);
	assert.deepEqual(a.data.readItems(list), savedRows);
	const oldBackup = { ...backup, folders: backup.folders.map(({ defaultItems, ...record }) => record) };
	a.data.importBackup(oldBackup, 'merge');
	assert.equal(defaults(a, folder).length, 1);
	for (const invalid of [null, {}, [{ id: 'a', name: '', note: false }], [{ id: 'a', name: 'Name', note: 'true' }], [backup.folders[0].defaultItems[0], backup.folders[0].defaultItems[0]]]) {
		const before = Y.encodeStateAsUpdate(a.doc);
		assert.throws(() => a.data.importBackup({ ...backup, items: [], folders: [{ ...backup.folders[0], defaultItems: invalid }] }, 'replace'), /Invalid default items/);
		assert.deepEqual(Y.encodeStateAsUpdate(a.doc), before);
	}
	a.data.importBackup(oldBackup, 'replace');
	assert.deepEqual(defaults(a, folder), []);
	assert.deepEqual(a.data.readItems(a.data.createList('Legacy folder', folder, 'plain')), []);
});

test('array-backed defaults support edits, reordering, replacement and undo without resurrecting removed items', t => {
	const a = app(t), folder = a.data.createFolder('Imported', null);
	a.doc.getArray('folders').get(0).set('defaultItems', [{ id: 'one', name: 'First', note: false }, { id: 'two', name: 'Second', note: true }]);
	a.data.moveFolderDefaultItem(folder, 'two', 'up');
	a.data.updateFolderDefaultItem(folder, 'one', { name: 'Renamed' });
	assert.deepEqual(defaults(a, folder).map(item => item.name), ['Second', 'Renamed']);
	a.store.getUndoManager().clear();
	a.data.removeFolderDefaultItem(folder, 'one');
	assert.equal(defaults(a, folder).length, 1);
	a.store.undoLastAction();
	assert.equal(defaults(a, folder).length, 2);
	a.data.updateFolder(folder, { defaultItems: [] });
	assert.deepEqual(defaults(a, folder), []);
	assert.deepEqual(a.data.readItems(a.data.createList('No defaults', folder, 'plain')), []);
});

test('historical views show saved defaults and prohibit every default-item mutation and list creation', t => {
	const a = app(t), folder = a.data.createFolder('History', null), id = a.data.addFolderDefaultItem(folder, 'At commit');
	a.store.createCommit('Saved defaults');
	a.data.updateFolderDefaultItem(folder, id, { name: 'Live note', note: true });
	a.store.viewCommit(a.store.readCommits()[0].id);
	assert.deepEqual(defaults(a, folder), [{ id, name: 'At commit', note: false }]);
	for (const mutate of [
		() => a.data.addFolderDefaultItem(folder, 'Blocked'),
		() => a.data.updateFolderDefaultItem(folder, id, { note: true }),
		() => a.data.moveFolderDefaultItem(folder, id, 'down'),
		() => a.data.removeFolderDefaultItem(folder, id),
		() => a.data.updateFolder(folder, { defaultItems: [] }),
		() => a.data.createList('Blocked', folder, 'plain')
	]) assert.throws(mutate, /read-only/);
	a.store.exitCommitView();
	assert.deepEqual(defaults(a, folder), [{ id, name: 'Live note', note: true }]);
});

test('dialog type selection retains the draft and adds/edits the selected type, with history guards', t => {
	const a = app(t), folderId = a.data.createFolder('Dialog', null);
	const state = { folder: { id: folderId }, canEdit: true, name: '  Packing note  ', isNote: false, editingId: null, removeId: null, error: '', focusInput: async () => {},
		addFolderDefaultItem: a.data.addFolderDefaultItem, updateFolderDefaultItem: a.data.updateFolderDefaultItem, removeFolderDefaultItem: a.data.removeFolderDefaultItem };
	const source = componentFunctions('src/lib/components/FolderDefaultItemsDialog.svelte', ['resetInput', 'toggleType', 'startEdit', 'submitItem', 'confirmRemove']);
	const handlers = new Function('state', `with(state) { ${transpile(source)}; return { toggleType, startEdit, submitItem, confirmRemove }; }`)(state);
	handlers.toggleType();
	assert.equal(state.name, '  Packing note  ');
	handlers.submitItem();
	const added = defaults(a, folderId)[0];
	assert.equal(added.note, true);
	assert.equal(added.name, 'Packing note');
	assert.equal(state.name, '');
	handlers.startEdit(added);
	handlers.toggleType();
	state.name = 'Packing todo';
	handlers.submitItem();
	assert.deepEqual(defaults(a, folderId), [{ ...added, name: 'Packing todo', note: false }]);
	state.canEdit = false;
	state.name = 'Blocked';
	state.removeId = added.id;
	handlers.submitItem();
	handlers.confirmRemove();
	assert.equal(defaults(a, folderId).length, 1);
});
