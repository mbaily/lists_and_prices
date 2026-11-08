import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp, componentFunctions, transpile } from './helpers/app.mjs';

const functions = componentFunctions('src/lib/components/ListScreen.svelte', [
	'parseDateFromListName', 'computeRolloverDate', 'pad2',
	'selectRolloverIncompleteScope', 'selectRolloverAllScope', 'selectRolloverCustomScope',
	'deselectAllRolloverItems', 'selectIncompleteRolloverItems', 'selectAllRolloverItems',
	'toggleRolloverItem', 'confirmRolloverItemSelection', 'cancelRolloverItemSelection',
	'getRolloverItemIds', 'openRolloverModal'
]);

const helpers = new Function('state', `with (state) {
	const DAY_NAMES_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
	const DAY_NAMES_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
	${transpile(functions)};
	return {
		parseDateFromListName, computeRolloverDate,
		selectRolloverIncompleteScope, selectRolloverAllScope, selectRolloverCustomScope,
		deselectAllRolloverItems, selectIncompleteRolloverItems, selectAllRolloverItems,
		toggleRolloverItem, confirmRolloverItemSelection, cancelRolloverItemSelection,
		getRolloverItemIds, openRolloverModal
	};
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

test('rollover selection dialog supports Selected scope, pre-selection, preset overwrites and move', () => {
	const app = createApp();
	try {
		const folderId = app.data.createFolder('Sprint Folder', null);
		const sourceListId = app.data.createList('Sat 07/11/26', folderId, 'plain', '#6366f1', 'bottom');

		const item1 = app.data.createItem(sourceListId, 'Task 1 (incomplete)');
		const item2 = app.data.createItem(sourceListId, 'Task 2 (done)');
		const item3 = app.data.createItem(sourceListId, 'Task 3 (incomplete)');
		const item4 = app.data.createItem(sourceListId, 'Task 4 (heading)');
		const note1 = app.data.createItem(sourceListId, 'Note 1 (standalone note)', null, null, true);
		const subnote1 = app.data.createItem(sourceListId, 'Subnote 1 (under task 2)', null, item2, true);
		app.data.updateItem(item2, { checked: true });
		app.data.updateItem(item4, { heading: true });

		const items = app.data.readItems(sourceListId);
		const state = {
			canEditList: true,
			commitState: { isHistorical: false },
			listMeta: { name: 'Sat 07/11/26' },
			listId: sourceListId,
			items,
			incompleteItemCount: 2,
			selectedIds: new Set(),
			selectionMode: false,
			showRolloverModal: false,
			showRolloverItemSelectModal: false,
			rolloverScope: 'incomplete',
			rolloverSelectedIds: new Set(),
			rolloverSelectedBackup: new Set(),
			lastClickedScope: null,
			rolloverOffset: 1,
			rolloverCustomDate: '',
			showRolloverCustomPicker: false,
			rolloverTargetName: '',
			isDone: (item) => item.checked
		};

		const ctx = new Function('state', `with (state) {
			const DAY_NAMES_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
			const DAY_NAMES_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
			${transpile(functions)};
			return {
				openRolloverModal: () => openRolloverModal(),
				selectRolloverIncompleteScope: () => selectRolloverIncompleteScope(),
				selectRolloverAllScope: () => selectRolloverAllScope(),
				selectRolloverCustomScope: () => selectRolloverCustomScope(),
				deselectAllRolloverItems: () => deselectAllRolloverItems(),
				selectIncompleteRolloverItems: () => selectIncompleteRolloverItems(),
				selectAllRolloverItems: () => selectAllRolloverItems(),
				toggleRolloverItem: (id) => toggleRolloverItem(id),
				confirmRolloverItemSelection: () => confirmRolloverItemSelection(),
				cancelRolloverItemSelection: () => cancelRolloverItemSelection(),
				getRolloverItemIds: () => getRolloverItemIds(),
				getState: () => state
			};
		}`)(state);

		// 1. Initial open of rollover modal without clicking Incomplete or All
		// Notes and subnotes must default as completed, NOT incomplete.
		ctx.openRolloverModal();
		assert.equal(state.showRolloverModal, true);
		assert.equal(state.rolloverScope, 'incomplete');
		assert.equal(state.lastClickedScope, null);
		assert.deepEqual([...state.rolloverSelectedIds], [item1, item3]);

		// 2. Click 'Selected' without clicking Incomplete or All -> incomplete todos pre-selected automatically (no notes)
		ctx.selectRolloverCustomScope();
		assert.equal(state.showRolloverItemSelectModal, true);
		assert.deepEqual([...state.rolloverSelectedIds], [item1, item3]);

		// 3. In dialog, test preset icon buttons overwriting selection
		// Deselect all (None)
		ctx.deselectAllRolloverItems();
		assert.equal(state.rolloverSelectedIds.size, 0);

		// Select All (selects todos, heading, note, subnote)
		ctx.selectAllRolloverItems();
		assert.equal(state.rolloverSelectedIds.size, 6);
		assert.deepEqual([...state.rolloverSelectedIds].sort(), [item1, item2, item3, item4, note1, subnote1].sort());

		// Select Incomplete (must strictly select only incomplete todos, excluding notes/subnotes)
		ctx.selectIncompleteRolloverItems();
		assert.deepEqual([...state.rolloverSelectedIds], [item1, item3]);

		// Toggle item individual selection
		ctx.toggleRolloverItem(item1); // uncheck item1
		assert.deepEqual([...state.rolloverSelectedIds], [item3]);
		ctx.toggleRolloverItem(item2); // check item2
		assert.deepEqual([...state.rolloverSelectedIds].sort(), [item2, item3].sort());

		// Test Cancel reverts selection
		ctx.cancelRolloverItemSelection();
		assert.equal(state.showRolloverItemSelectModal, false);
		assert.deepEqual([...state.rolloverSelectedIds], [item1, item3]); // restored backup

		// Re-open and toggle item1, then confirm
		ctx.selectRolloverCustomScope();
		ctx.toggleRolloverItem(item1); // only item3 remains
		ctx.confirmRolloverItemSelection();
		assert.equal(state.showRolloverItemSelectModal, false);
		assert.equal(state.rolloverScope, 'selected');
		assert.deepEqual(ctx.getRolloverItemIds(), [item3]);

		// 4. Test clicking 'All' then 'Selected' -> all items pre-selected
		ctx.selectRolloverAllScope();
		assert.equal(state.rolloverScope, 'all');
		assert.equal(state.lastClickedScope, 'all');
		ctx.selectRolloverCustomScope();
		assert.equal(state.showRolloverItemSelectModal, true);
		assert.equal(state.rolloverSelectedIds.size, 6);

		// 5. Test clicking 'Incomplete' then 'Selected' -> incomplete items pre-selected
		ctx.selectRolloverIncompleteScope();
		assert.equal(state.rolloverScope, 'incomplete');
		assert.equal(state.lastClickedScope, 'incomplete');
		ctx.selectRolloverCustomScope();
		assert.equal(state.showRolloverItemSelectModal, true);
		assert.deepEqual([...state.rolloverSelectedIds], [item1, item3]);

		// 6. Confirm selection with custom items [item1] and perform move
		ctx.deselectAllRolloverItems();
		ctx.toggleRolloverItem(item1);
		ctx.confirmRolloverItemSelection();
		assert.equal(state.rolloverScope, 'selected');
		assert.deepEqual(ctx.getRolloverItemIds(), [item1]);

		// Target list creation & move
		const targetListId = app.data.createList('Sun 08/11/26', folderId, 'plain', '#6366f1', 'bottom', true);
		const moved = app.data.moveItemsToDestination(sourceListId, ctx.getRolloverItemIds(), { listId: targetListId, parentId: null }, 'bottom');
		assert.equal(moved, true);

		// Verify target list only has item1
		const targetItems = app.data.readItems(targetListId);
		assert.equal(targetItems.length, 1);
		assert.equal(targetItems[0].id, item1);

		// Verify source list retained item2, item3, item4, note1, subnote1
		const sourceItems = app.data.readItems(sourceListId);
		assert.equal(sourceItems.length, 5);
		assert.deepEqual(sourceItems.map((i) => i.id).sort(), [item2, item3, item4, note1, subnote1].sort());
	} finally {
		app.dispose();
	}
});
