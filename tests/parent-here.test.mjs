// @ts-nocheck -- Exercise the component handlers against real Yjs list data.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp, componentFunctions, transpile } from './helpers/app.mjs';

function parentProbe() {
	const app = createApp();
	const listId = app.data.createList('Tasks', null, 'plain');
	const state = {
		listId, canEditList: true, inputMode: 'add', universalValue: '',
		parentHereId: null, newItemParentId: null, newItemIsNote: false,
		editingId: null, pricingItemId: null, qtyItemId: null, infoItem: null, priceBuffer: '', qtyBuffer: '',
		universalInputEl: null, settings: { addItemPosition: 'top', parentHerePosition: 'bottom' }, focusInput() {},
		createItem: app.data.createItem, updateItem: app.data.updateItem, readItems: app.data.readItems,
		get listMeta() { return app.data.readLists().find((list) => list.id === listId); },
		get addParentId() { return this.newItemParentId ?? this.parentHereId; }
	};
	const source = componentFunctions('src/lib/components/ListScreen.svelte', [
		'setParentHere', 'cancelParentHere', 'getInfoPinMenuItem', 'toggleNoteTask', 'addItem',
		'startEditName', 'submitEditName', 'cancelEdit'
	]);
	const handlers = new Function('state', `with (state) { ${transpile(source)}; return {
		setParentHere, cancelParentHere, getInfoPinMenuItem, addItem,
		startEditName, submitEditName, cancelEdit
	}; }`)(state);
	const item = (id) => app.data.readItems(listId).find((entry) => entry.id === id);
	const add = (name) => { state.universalValue = name; handlers.addItem(); };
	return { app, listId, state, handlers, item, add };
}

for (const note of [false, true]) {
	test(`Parent here keeps adding children to a ${note ? 'note' : 'todo'} until cancelled`, () => {
		const p = parentProbe();
		try {
			const parent = p.app.data.createItem(p.listId, 'Parent', null, null, note);
			p.handlers.setParentHere(p.item(parent));
			p.add('First child');
			p.add('Second child');
			p.app.data.updateList(p.listId, { defaultIsNote: true });
			p.state.newItemIsNote = true;
			p.add('Child note');
			const children = p.app.data.readItems(p.listId).filter((item) => item.parentId === parent);
			assert.deepEqual(children.map((item) => [item.name, item.note]), [
				['First child', false], ['Second child', false], ['Child note', true]
			]);
			assert.equal(p.state.parentHereId, parent);
			assert.equal(p.state.universalValue, '');

			p.state.universalValue = 'Root draft';
			p.handlers.cancelParentHere();
			assert.equal(p.state.universalValue, 'Root draft', 'Cancelling the parent keeps the draft');
			p.handlers.addItem();
			const root = p.app.data.readItems(p.listId).find((item) => item.name === 'Root draft');
			assert.equal(root.parentId, null);
			assert.equal(root.note, true);
			assert.ok(root.order < p.item(parent).order, 'Root additions still honor the top position setting');
		} finally { p.app.dispose(); }
	});
}

test('editing and cancelling a draft keep Parent here active; selecting another parent exits editing', () => {
	const p = parentProbe();
	try {
		const first = p.app.data.createItem(p.listId, 'First parent');
		const second = p.app.data.createItem(p.listId, 'Second parent');
		p.handlers.setParentHere(p.item(first));
		p.handlers.startEditName(p.item(second));
		p.state.universalValue = 'Renamed parent';
		p.handlers.submitEditName();
		p.add('After edit');
		assert.equal(p.app.data.readItems(p.listId).find((item) => item.name === 'After edit').parentId, first);
		p.state.universalValue = 'Discard this draft';
		p.handlers.cancelEdit();
		assert.equal(p.state.parentHereId, first);

		p.handlers.startEditName(p.item(first));
		p.handlers.setParentHere(p.item(second));
		assert.equal(p.state.inputMode, 'add');
		p.add('Under second');
		assert.equal(p.item(first).name, 'First parent');
		assert.equal(p.app.data.readItems(p.listId).find((item) => item.name === 'Under second').parentId, second);
	} finally { p.app.dispose(); }
});

test('a one-off subnote uses its chosen parent then returns to Parent here', () => {
	const p = parentProbe();
	try {
		const first = p.app.data.createItem(p.listId, 'First parent');
		const second = p.app.data.createItem(p.listId, 'Second parent');
		p.handlers.setParentHere(p.item(first));
		p.state.newItemParentId = second;
		p.state.newItemIsNote = true;
		p.add('One-off note');
		p.add('Regular child');
		const items = p.app.data.readItems(p.listId);
		assert.equal(items.find((item) => item.name === 'One-off note').parentId, second);
		assert.equal(items.find((item) => item.name === 'One-off note').note, true);
		assert.equal(items.find((item) => item.name === 'Regular child').parentId, first);
		assert.equal(items.find((item) => item.name === 'Regular child').note, false);
	} finally { p.app.dispose(); }
});

test('Info & Pin opens item info and toggles Pin/Unpin through the submenu', () => {
	const p = parentProbe();
	try {
		const id = p.app.data.createItem(p.listId, 'Task');
		const menu = p.handlers.getInfoPinMenuItem(p.item(id));
		assert.equal(menu.action, undefined);
		assert.deepEqual(menu.submenu.map((item) => item.label), ['ℹ️ Info', '📍 Pin', '📝 Note/Task']);
		menu.submenu[0].action();
		assert.equal(p.state.infoItem.id, id);
		menu.submenu[1].action();
		assert.equal(p.item(id).pinned, true);
		const unpin = p.handlers.getInfoPinMenuItem(p.item(id)).submenu[1];
		assert.equal(unpin.label, '📍 Unpin');
		unpin.action();
		assert.equal(p.item(id).pinned, false);

		p.state.canEditList = false;
		menu.submenu[1].action();
		menu.submenu[2].action();
		p.handlers.setParentHere(p.item(id));
		p.add('Read-only task');
		assert.equal(p.item(id).pinned, false);
		assert.equal(p.item(id).note, false);
		assert.equal(p.state.parentHereId, null);
		assert.equal(p.app.data.readItems(p.listId).length, 1);
	} finally { p.app.dispose(); }
});

test('Note/Task conversion keeps rich text, task details, children and Parent here and undoes atomically', () => {
	const p = parentProbe(), d = p.app.data;
	try {
		const folder = d.createFolder('Folder', null);
		const checkbox = d.addFolderCheckbox(folder, 'Packed');
		d.updateList(p.listId, { folderId: folder, type: 'priced' });
		const id = d.createItem(p.listId, 'Rich note\nwith two lines', 7.5, null, true);
		d.updateItem(id, { qty: 3, checked: true, pinned: true, fullScreen: true });
		d.setItemCheckboxState(id, checkbox, true);
		const child = d.createItem(p.listId, 'Child task', null, id);
		const subnote = d.createItem(p.listId, 'Child note', null, id, true);
		const text = d.getItemYText(p.app.doc, id);
		text.format(0, 4, { bold: true });
		const delta = text.toDelta(), before = d.readItems(p.listId);
		p.handlers.setParentHere(p.item(id));
		const menu = p.handlers.getInfoPinMenuItem(p.item(id));
		p.app.store.getUndoManager().clear();
		menu.submenu[2].action();
		assert.equal(p.item(id).note, false);
		assert.equal(p.item(id).fullScreen, false);
		for (const key of ['id', 'listId', 'name', 'price', 'qty', 'checked', 'checks', 'pinned', 'parentId', 'order', 'createdAt']) {
			assert.deepEqual(p.item(id)[key], before.find((item) => item.id === id)[key], key);
		}
		assert.equal(p.item(child).parentId, id); assert.equal(p.item(subnote).parentId, id);
		assert.equal(p.state.parentHereId, id);
		assert.equal(d.getItemYText(p.app.doc, id), text); assert.deepEqual(text.toDelta(), delta);
		assert.equal(p.app.store.getUndoCount(), 1);
		p.app.store.undoLastAction();
		assert.deepEqual(d.readItems(p.listId), before);

		// A stale menu still toggles the current type rather than its captured type.
		menu.submenu[2].action();
		p.state.pricingItemId = id; p.state.priceBuffer = '99';
		p.state.qtyItemId = id; p.state.qtyBuffer = '5';
		menu.submenu[2].action();
		assert.equal(p.item(id).note, true);
		assert.equal(p.state.pricingItemId, null); assert.equal(p.state.priceBuffer, '');
		assert.equal(p.state.qtyItemId, null); assert.equal(p.state.qtyBuffer, '');
		assert.deepEqual(text.toDelta(), delta);
		p.add('After conversion');
		assert.equal(d.readItems(p.listId).find((item) => item.name === 'After conversion').parentId, id);
	} finally { p.app.dispose(); }
});
