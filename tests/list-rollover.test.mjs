import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp, componentFunctions, transpile } from './helpers/app.mjs';

const functions = componentFunctions('src/lib/components/ListScreen.svelte', [
	'parseDateFromListName', 'computeRolloverDate', 'pad2'
]);

const helpers = new Function('state', `with (state) {
	const DAY_NAMES_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
	const DAY_NAMES_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
	${transpile(functions)};
	return { parseDateFromListName, computeRolloverDate };
}`)({ allLists: [], listId: '' });

test('date parsing extracts DMY, ISO, and Day-prefixed patterns', () => {
	const p1 = helpers.parseDateFromListName('Sat 07/11/26');
	assert.ok(p1);
	assert.equal(p1.format, 'dmy');
	assert.equal(p1.hasDayName, 'short');
	assert.equal(p1.date.getFullYear(), 2026);
	assert.equal(p1.date.getMonth(), 10); // Nov (0-based)
	assert.equal(p1.date.getDate(), 7);

	const p2 = helpers.parseDateFromListName('Saturday, 07/11/2026');
	assert.ok(p2);
	assert.equal(p2.hasDayName, 'long');
	assert.equal(p2.yearDigits, 4);

	const p3 = helpers.parseDateFromListName('2026-11-07');
	assert.ok(p3);
	assert.equal(p3.format, 'iso');
	assert.equal(p3.hasDayName, false);

	const p4 = helpers.parseDateFromListName('Sprint Tasks');
	assert.equal(p4, null);
});

test('computeRolloverDate computes correct offsets across day, month, and year boundaries', () => {
	// Daily rollover (+1 day: Sat Nov 7 -> Sun Nov 8)
	const r1 = helpers.computeRolloverDate('Sat 07/11/26', 1);
	assert.equal(r1.targetName, 'Sun 08/11/26');

	// Weekend rollover (+2 days: Sat Nov 7 -> Mon Nov 9)
	const r2 = helpers.computeRolloverDate('Sat 07/11/26', 2);
	assert.equal(r2.targetName, 'Mon 09/11/26');

	// ISO format rollover
	const r3 = helpers.computeRolloverDate('2026-11-07', 1);
	assert.equal(r3.targetName, '2026-11-08');

	// Month boundary
	const r4 = helpers.computeRolloverDate('30/11/26', 1);
	assert.equal(r4.targetName, '01/12/26');

	// Year boundary
	const r5 = helpers.computeRolloverDate('31/12/26', 1);
	assert.equal(r5.targetName, '01/01/27');

	// Text prefix preserved
	const r6 = helpers.computeRolloverDate('Daily Notes 07/11/26 (Work)', 1);
	assert.equal(r6.targetName, 'Daily Notes 08/11/26 (Work)');

	// Explicit custom date (Nov 15 2026 is Sunday)
	const explicit = new Date(2026, 10, 15);
	const r7 = helpers.computeRolloverDate('Sat 07/11/26', 0, explicit);
	assert.equal(r7.targetName, 'Sun 15/11/26');
});

test('createList accepts null folderId for root-level lists', () => {
	const app = createApp();
	try {
		const rootId = app.data.createList('Root Daily', null, 'plain', '#6366f1', 'bottom');
		assert.ok(rootId);
		const lists = app.data.readLists();
		const created = lists.find((l) => l.id === rootId);
		assert.ok(created);
		assert.equal(created.folderId, null);
		assert.equal(created.name, 'Root Daily');
	} finally {
		app.dispose();
	}
});

test('rollover creates target list and moves incomplete items leaving checked items behind', () => {
	const app = createApp();
	try {
		const folderId = app.data.createFolder('Daily Sprints', null);
		const sourceListId = app.data.createList('Sat 07/11/26', folderId, 'plain', '#6366f1', 'bottom');

		const item1 = app.data.createItem(sourceListId, 'Task 1 (to do)');
		const item2 = app.data.createItem(sourceListId, 'Task 2 (done)');
		const item3 = app.data.createItem(sourceListId, 'Task 3 (to do)');
		app.data.updateItem(item2, { checked: true });

		// Perform rollover calculation
		const { targetName } = helpers.computeRolloverDate('Sat 07/11/26', 1);
		assert.equal(targetName, 'Sun 08/11/26');

		// Create target list
		const targetListId = app.data.createList(targetName, folderId, 'plain', '#6366f1', 'bottom', true);

		// Find incomplete items
		const itemsBefore = app.data.readItems(sourceListId);
		const incompleteIds = itemsBefore.filter((i) => !i.checked && !i.heading).map((i) => i.id);
		assert.deepEqual(incompleteIds, [item1, item3]);

		// Move incomplete items
		const success = app.data.moveItemsToDestination(sourceListId, incompleteIds, { listId: targetListId, parentId: null }, 'bottom');
		assert.equal(success, true);

		// Verify target list has the 2 incomplete items
		const targetItems = app.data.readItems(targetListId);
		assert.equal(targetItems.length, 2);
		assert.deepEqual(targetItems.map((i) => i.id), [item1, item3]);

		// Verify source list retained the checked item
		const sourceItemsAfter = app.data.readItems(sourceListId);
		assert.equal(sourceItemsAfter.length, 1);
		assert.equal(sourceItemsAfter[0].id, item2);
	} finally {
		app.dispose();
	}
});
