import assert from 'node:assert/strict';
import test from 'node:test';
import { getCompletedNoteIds } from '../src/lib/hierarchy.ts';
import type { Item } from '../src/lib/data.ts';

function makeItem(overrides: Partial<Item> & { id: string }): Item {
	return {
		listId: 'list-1',
		name: overrides.id,
		price: null,
		qty: null,
		checked: false,
		order: 0,
		heading: false,
		parentId: null,
		note: false,
		pinned: false,
		createdAt: null,
		updatedAt: null,
		checks: {},
		...overrides
	};
}

const isDone = (item: Item) => item.checked;

test('pure notes list without tasks does not grey out notes', () => {
	const items = [
		makeItem({ id: 'n1', note: true }),
		makeItem({ id: 'n2', note: true, parentId: 'n1' })
	];
	assert.deepEqual([...getCompletedNoteIds(items, isDone)], []);
});

test('top-level note is greyed out only when all sibling and child tasks are complete', () => {
	const items = [
		makeItem({ id: 'h1', heading: true }),
		makeItem({ id: 't1', checked: true }),
		makeItem({ id: 't2', checked: false }),
		makeItem({ id: 'n1', note: true })
	];
	assert.deepEqual([...getCompletedNoteIds(items, isDone)], []);

	items[2].checked = true;
	assert.deepEqual([...getCompletedNoteIds(items, isDone)], ['n1']);
});

test('subnote requires parent task, sibling subtasks, and child subtasks to be complete', () => {
	const items = [
		makeItem({ id: 'p1', checked: false }),
		makeItem({ id: 's1', parentId: 'p1', checked: true }),
		makeItem({ id: 'n1', parentId: 'p1', note: true }),
		makeItem({ id: 'c1', parentId: 'n1', checked: true })
	];
	// Parent p1 is incomplete
	assert.deepEqual([...getCompletedNoteIds(items, isDone)], []);

	// Parent complete, but sibling s1 incomplete
	items[0].checked = true;
	items[1].checked = false;
	assert.deepEqual([...getCompletedNoteIds(items, isDone)], []);

	// Sibling complete, but child c1 incomplete
	items[1].checked = true;
	items[3].checked = false;
	assert.deepEqual([...getCompletedNoteIds(items, isDone)], []);

	// All complete
	items[3].checked = true;
	assert.deepEqual([...getCompletedNoteIds(items, isDone)], ['n1']);
});

test('sibling note with incomplete descendant blocks note completion', () => {
	const items = [
		makeItem({ id: 'n1', note: true }),
		makeItem({ id: 'n2', note: true }),
		makeItem({ id: 'c1', parentId: 'n2', checked: false })
	];
	assert.deepEqual([...getCompletedNoteIds(items, isDone)], []);

	items[2].checked = true;
	assert.deepEqual([...getCompletedNoteIds(items, isDone)].sort(), ['n1', 'n2']);
});

test('subnote under a parent note respects parent note siblings', () => {
	const items = [
		makeItem({ id: 't1', checked: false }),
		makeItem({ id: 'n1', note: true }),
		makeItem({ id: 'n2', parentId: 'n1', note: true })
	];
	assert.deepEqual([...getCompletedNoteIds(items, isDone)], []);

	items[0].checked = true;
	assert.deepEqual([...getCompletedNoteIds(items, isDone)].sort(), ['n1', 'n2']);
});

test('handles cycles safely without infinite recursion', () => {
	const items = [
		makeItem({ id: 'a', note: true, parentId: 'b' }),
		makeItem({ id: 'b', checked: true, parentId: 'a' })
	];
	assert.deepEqual([...getCompletedNoteIds(items, isDone)], ['a']);
});
