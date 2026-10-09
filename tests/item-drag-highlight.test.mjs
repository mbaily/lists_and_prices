import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp, componentFunctions, transpile } from './helpers/app.mjs';

function fixture(t) {
	const app = createApp();
	t.after(() => app.dispose());
	const list = app.data.createList('Drag fixture', null, 'plain');
	const add = (name, parent = null, note = false) => app.data.createItem(list, name, null, parent, note);
	const source = add('Source');
	const parent = add('Parent', null, true);
	const child = add('Child', parent, true);
	const grandchild = add('Grandchild', child, true);
	const lastChild = add('Last child', parent);
	const next = add('Next parent');
	const nextChild = add('Next child', next);
	const treeItems = app.hierarchy.buildItemTreeOrder(app.data.readItems(list));
	const state = { treeItems, filteredTreeItems: treeItems, touchDragFrom: 0, touchDragOver: 1, touchDragParentKey: '__top__' };
	const code = componentFunctions('src/lib/components/ListScreen.svelte', ['getDragBelowId']);
	const marker = new Function('state', `with(state) { ${transpile(code)}; return getDragBelowId; }`)(state);
	return { app, list, add, source, parent, child, grandchild, lastChild, next, nextChild, state, marker };
}

test('downward sibling highlight follows the entire target subtree and matches the reordered position', t => {
	const f = fixture(t);
	assert.equal(f.marker(), f.lastChild, 'highlight belongs after all branches, rather than between the parent and first child');
	f.app.data.reorderSiblings(f.list, null, 0, 1);
	const order = f.app.hierarchy.buildItemTreeOrder(f.app.data.readItems(f.list)).map(({ item }) => item.id);
	assert.deepEqual(order, [f.parent, f.child, f.grandchild, f.lastChild, f.source, f.next, f.nextChild]);
	assert.equal(order[order.indexOf(f.source) - 1], f.marker(), 'highlight identifies the actual drop boundary');
});

test('nested sibling highlight includes grandchildren and stops before the next sibling subtree', t => {
	const f = fixture(t);
	const siblingLeaf = f.add('Sibling leaf', f.lastChild, true);
	f.state.treeItems = f.app.hierarchy.buildItemTreeOrder(f.app.data.readItems(f.list));
	f.state.filteredTreeItems = f.state.treeItems;
	f.state.touchDragParentKey = f.parent;
	assert.equal(f.marker(), siblingLeaf);
	f.state.touchDragOver = 2;
	assert.equal(f.marker(), null, 'missing sibling is not a drop boundary');
});

test('filtered highlight uses the last visible descendant without including children of a hidden next parent', t => {
	const f = fixture(t);
	f.state.filteredTreeItems = f.state.treeItems.filter(({ item }) => item.id !== f.lastChild && item.id !== f.next);
	assert.equal(f.marker(), f.grandchild);
	f.state.filteredTreeItems = f.state.filteredTreeItems.filter(({ item }) => item.id !== f.child && item.id !== f.grandchild);
	assert.equal(f.marker(), f.parent, 'target without visible descendants highlights its own bottom');
	f.state.filteredTreeItems = f.state.filteredTreeItems.filter(({ item }) => item.id !== f.parent);
	assert.equal(f.marker(), null, 'fully hidden target has no highlight');
});

test('upward, unchanged and cancelled drags have no downward highlight', t => {
	const f = fixture(t);
	for (const patch of [
		{ touchDragFrom: 2 },
		{ touchDragFrom: 1 },
		{ touchDragFrom: null },
		{ touchDragOver: null },
		{ touchDragParentKey: null }
	]) {
		Object.assign(f.state, { touchDragFrom: 0, touchDragOver: 1, touchDragParentKey: '__top__' }, patch);
		assert.equal(f.marker(), null);
	}
});
