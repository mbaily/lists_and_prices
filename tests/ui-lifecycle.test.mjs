// @ts-nocheck -- Exercise actual component functions with explicit UI state.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp, componentFunctions, transpile } from './helpers/app.mjs';
import { importNameKey } from '../server/import-text.ts';
import { parseClipboardTodos } from '../src/lib/importText.ts';

function uncheckProbe(selected = false, named = false) {
	const calls = [];
	const state = {
		canEditList: true, listId: 'list-a', listContextVersion: 0,
		confirmMsg: '', confirmLabel: '', confirmAction: null,
		selectedIds: new Set(selected ? ['todo', 'note'] : []),
		items: [{ id: 'todo' }, { id: 'other' }, { id: 'note', note: true }, { id: 'heading', heading: true }],
		folderCheckboxes: named ? [{ id: 'done' }, { id: 'packed' }] : [],
		setItemsChecked: (...args) => calls.push(['plain', ...args]),
		clearItemCheckboxes: (...args) => calls.push(['named', ...args])
	};
	const source = componentFunctions('src/lib/components/ListScreen.svelte', ['bulkUncheck', 'askDelete']);
	const run = new Function('state', `with(state) { ${transpile(source)}; return bulkUncheck; }`)(state);
	return { state, calls, run };
}

test('uncheck all waits for confirmation and excludes notes and headings', () => {
	const probe = uncheckProbe();
	probe.run();
	assert.match(probe.state.confirmMsg, /all items in this list/);
	assert.equal(probe.state.confirmLabel, 'Uncheck all');
	assert.deepEqual(probe.calls, []);
	probe.state.confirmAction();
	assert.deepEqual(probe.calls, [['plain', ['todo', 'other'], false]]);
});

test('cancelling uncheck preserves the selection and confirming clears only its named checks', () => {
	const probe = uncheckProbe(true, true);
	probe.run();
	probe.state.confirmAction = null;
	assert.deepEqual(probe.calls, []);
	assert.deepEqual([...probe.state.selectedIds], ['todo', 'note']);
	probe.run();
	probe.state.confirmAction();
	assert.deepEqual(probe.calls, [['named', ['todo'], ['done', 'packed']]]);
	assert.equal(probe.state.selectedIds.size, 0);
});

for (const transition of ['navigation', 'history', 'round-trip navigation']) {
	test(`uncheck confirmation cannot mutate after ${transition}`, () => {
		const probe = uncheckProbe();
		probe.run();
		if (transition === 'navigation') probe.state.listId = 'list-b';
		if (transition === 'history') probe.state.canEditList = false;
		if (transition === 'round-trip navigation') probe.state.listContextVersion++;
		probe.state.confirmAction();
		assert.deepEqual(probe.calls, []);
	});
}

function itemCopyProbe(item, folderCheckboxes = []) {
	const writes = [], refs = [];
	const state = {
		folderCheckboxes, isChecked: (item, id) => !!item.checks?.[id],
		navigator: { clipboard: { writeText: async (text) => { writes.push(text); } } },
		copyRefToClipboard: (id) => refs.push(id), copyStatus: 'idle', copyMessage: '', setTimeout: () => 1,
		selectedIds: new Set(), selectedItems: [], treeItems: [{ item }], showHeaderMenu: true
	};
	const source = componentFunctions('src/lib/components/ListScreen.svelte', [
		'serializeClipboardItems', 'writeClipboard', 'getCopyMenuItem', 'exportToClipboard'
	]);
	const api = new Function('state', `with (state) { ${transpile(source)}; return { getCopyMenuItem, exportToClipboard }; }`)(state);
	return { state, writes, refs, menu: api.getCopyMenuItem(item), exportList: api.exportToClipboard };
}

test('item copy submenu keeps Tag as Link and copies just the todo or note name as plain text', async () => {
	for (const note of [false, true]) {
		const item = { id: 'item-a', name: 'Buy milk #shopping', note };
		const probe = itemCopyProbe(item);
		assert.equal(probe.menu.action, undefined);
		assert.deepEqual(probe.menu.submenu.map((entry) => entry.label), ['🔗 Tag as Link', '📋 Copy', '📋 Copy JSON']);
		probe.menu.submenu[0].action();
		await probe.menu.submenu[1].action();
		assert.deepEqual(probe.refs, ['item-a']);
		assert.deepEqual(probe.writes, [item.name]);
	}
});

test('Copy JSON uses the list export format and preserves item attributes and named checkboxes', async () => {
	for (const named of [false, true]) {
		const item = {
			id: 'item-a', name: 'Milk #shopping', price: 3.5, qty: 2, checked: true,
			note: true, pinned: true, parentId: 'parent-a', checks: { bought: true, packed: false }
		};
		const probe = itemCopyProbe(item, named ? [{ id: 'bought', name: 'Bought' }, { id: 'packed', name: 'Packed' }] : []);
		await probe.menu.submenu[2].action();
		await probe.exportList();
		assert.equal(probe.writes[0], probe.writes[1]);
		assert.deepEqual(JSON.parse(probe.writes[0]), {
			__list_app__: true,
			items: [{ id: item.id, name: item.name, price: 3.5, qty: 2,
				...(named ? { checkedNames: ['Bought'] } : { checked: true }),
				note: true, pinned: true, parentId: 'parent-a' }]
		});
	}
});

test('item copy reports clipboard permission errors', async () => {
	const probe = itemCopyProbe({ id: 'item-a', name: 'Milk' });
	probe.state.navigator.clipboard.writeText = async () => { throw new Error('Permission denied'); };
	await probe.menu.submenu[1].action();
	assert.equal(probe.state.copyStatus, 'error');
	assert.equal(probe.state.copyMessage, '✗ Clipboard access denied.');
});

function clipboardState(readText) {
	const calls = [], alerts = [];
	const state = {
		isPasting: false, canEditList: true, listId: 'list-a', listContextVersion: 0, isActive: true,
		settings: { addItemPosition: 'bottom' }, commitState: { isHistorical: false },
		navigator: { clipboard: { readText } }, readLists: () => [{ id: 'list-a' }, { id: 'list-b' }],
		readItems: () => [],
		importNameKey, parseClipboardTodos,
		createItemsBatch: (...args) => calls.push(['text', ...args]),
		createItemsFromExport: (...args) => calls.push(['json', ...args]),
		alert: (message) => alerts.push(message), copyMessage: '', copyStatus: 'idle',
		setTimeout: () => 1, clearTimeout: () => {}
	};
	const source = componentFunctions('src/lib/components/ListScreen.svelte', ['importFromClipboard']);
	const run = new Function('state', `with (state) { ${transpile(source)}; return importFromClipboard; }`)(state);
	return { state, calls, alerts, run };
}

test('clipboard imports can be repeated after both plain text and JSON success', async () => {
	const probe = clipboardState(async () => 'First task');
	await probe.run(); assert.equal(probe.state.isPasting, false);
	assert.equal(probe.state.copyStatus, 'idle'); assert.equal(probe.state.copyMessage, '');
	probe.state.navigator.clipboard.readText = async () => JSON.stringify({ __list_app__: true, items: [{ id: 'old', name: 'Second task' }] });
	await probe.run(); assert.equal(probe.state.isPasting, false);
	assert.equal(probe.state.copyStatus, 'idle'); assert.equal(probe.state.copyMessage, '');
	assert.equal(probe.calls.length, 2); assert.equal(probe.calls[1][0], 'json');
});

test('clipboard todos import completion and omit cancelled items', async () => {
	const text = '[ ] Choc milk\n[X] Tomatoes\n[ ] Tuna can\n[ ] Zuchinni\n[C] Capsicum';
	const probe = clipboardState(async () => text);
	await probe.run('tasks');
	assert.deepEqual(probe.calls, [['json', 'list-a', [
		{ id: 'clipboard-0', name: 'Choc milk', checked: false, parentId: null },
		{ id: 'clipboard-1', name: 'Tomatoes', checked: true, parentId: null },
		{ id: 'clipboard-2', name: 'Tuna can', checked: false, parentId: null },
		{ id: 'clipboard-3', name: 'Zuchinni', checked: false, parentId: null }
	], { addPosition: 'bottom', skipExisting: true }]]);
	assert.deepEqual(probe.alerts, []);
	assert.equal(probe.state.isPasting, false);
});

test('normal clipboard import preserves checkbox markers as literal text', async () => {
	for (const text of [
		'[X] Tomatoes',
		'[ ] Milk\n[X] Tomatoes\n[C] Capsicum',
		'9:26 AM\n[X] Choc milk\n[X] Death of the outsider\n[X] Charge phone\n[X] Northland #northland',
		'Shopping\n[ ] Milk\n[X] Tomatoes\n[C] Capsicum',
		'[ ] Milk\n[?] Tomatoes\n[C] Capsicum',
		'[ ] Milk\n[X]Tomatoes\n[C] Capsicum',
		'Write about [X] and [C]\n[C] Capsicum'
	]) {
		const probe = clipboardState(async () => text);
		await probe.run();
		assert.deepEqual(probe.calls, [['text', 'list-a', text.split('\n'), 'bottom']]);
		assert.deepEqual(probe.alerts, []);
	}
});

test('task import extracts the example tasks without the timestamp or other text', async () => {
	const text = '9:26 AM\n[X] Choc milk\n[X] Death of the outsider\n[X] Charge phone\n[X] Northland #northland\nEnd of list';
	const probe = clipboardState(async () => text);
	await probe.run('tasks');
	assert.deepEqual(probe.calls, [['json', 'list-a', [
		{ id: 'clipboard-0', name: 'Choc milk', checked: true, parentId: null },
		{ id: 'clipboard-1', name: 'Death of the outsider', checked: true, parentId: null },
		{ id: 'clipboard-2', name: 'Charge phone', checked: true, parentId: null },
		{ id: 'clipboard-3', name: 'Northland #northland', checked: true, parentId: null }
	], { addPosition: 'bottom', skipExisting: true }]]);
	assert.deepEqual(probe.alerts, []);
	assert.equal(probe.state.isPasting, false);
});

test('task import reports missing tasks without importing literal text or app JSON', async () => {
	for (const text of ['9:26 AM\nShopping\nNo tasks here', '{"__list_app__":true,"items":[{"id":"x","name":"Task"}]}']) {
		const probe = clipboardState(async () => text);
		await probe.run('tasks');
		assert.deepEqual(probe.calls, []);
		assert.equal(probe.alerts.length, 1);
		assert.match(probe.alerts[0], /No tasks found in clipboard/);
		assert.equal(probe.state.isPasting, false);
		probe.state.navigator.clipboard.readText = async () => '[X] Single task';
		await probe.run('tasks');
		assert.deepEqual(probe.calls, [['json', 'list-a', [
			{ id: 'clipboard-0', name: 'Single task', checked: true, parentId: null }
		], { addPosition: 'bottom', skipExisting: true }]]);
	}
});

test('a cancelled clipboard subtree imports nothing and releases the guard', async () => {
	const probe = clipboardState(async () => '[C] Cancelled parent\n  [X] Completed child\n    [ ] Grandchild');
	await probe.run('tasks');
	assert.deepEqual(probe.calls, []);
	assert.deepEqual(probe.alerts, []);
	assert.equal(probe.state.isPasting, false);
	probe.state.navigator.clipboard.readText = async () => '[ ] Next task';
	await probe.run('tasks');
	assert.equal(probe.calls.length, 1);
});

for (const position of ['top', 'bottom']) {
	for (const named of [false, true]) {
		test(`indented clipboard todos preserve deep hierarchy, ${position} order and ${named ? 'named' : 'plain'} completion with one undo`, async () => {
			const c = createApp();
			try {
				const folderId = c.data.createFolder('Folder', null);
				const listId = c.data.createList('Shopping', folderId, 'plain');
				if (named) {
					c.data.addFolderCheckbox(folderId, 'Bought');
					c.data.addFolderCheckbox(folderId, 'Packed');
				}
				const rootId = c.data.createItem(listId, 'Existing root');
				const childId = c.data.createItem(listId, 'Existing child', null, rootId);
				const before = c.data.readItems(listId);
				const otherList = c.data.createList('Other', folderId, 'plain');
				c.data.createItem(otherList, 'Choc milk');
				const text = [
					'Shopping at 9:26 AM',
					'[ ] Existing root #shopping',
					'  [ ] Choc milk',
					'Notes between tasks are ignored',
					'    [X] Tomatoes',
					'      [ ] Great grandchild',
					'  [C] Capsicum',
					'    [ ] Cancelled descendant',
					'      [X] Cancelled grandchild',
					'  [ ] Tuna can',
					'[X] Zuchinni',
					'[ ] New root',
					'[ ] New root',
					'End of list'
				].join('\n');
				const probe = clipboardState(async () => text);
				Object.assign(probe.state, {
					listId, settings: { addItemPosition: position },
					readLists: c.data.readLists, readItems: c.data.readItems,
					createItemsFromExport: c.data.createItemsFromExport
				});
				c.store.getUndoManager().clear();
				await probe.run('tasks');
				assert.deepEqual(probe.alerts, []);
				const items = c.data.readItems(listId);
				const get = (name) => items.find((item) => item.name === name);
				assert.equal(items.length, 9);
				assert.equal(get('Choc milk').parentId, rootId);
				assert.equal(get('Tomatoes').parentId, get('Choc milk').id);
				assert.equal(get('Great grandchild').parentId, get('Tomatoes').id);
				assert.equal(get('Tuna can').parentId, rootId);
				assert.equal(get('Zuchinni').parentId, null);
				assert.equal(get('Existing root').checked, false);
				const folder = c.data.readFolders().find((entry) => entry.id === folderId);
				for (const item of items) {
					assert.equal(c.data.isItemDone(item, folder), ['Tomatoes', 'Zuchinni'].includes(item.name));
					assert.equal(c.notes.readItemName(c.doc, c.doc.getArray('items').toArray().find((record) => record.get('id') === item.id)), item.name);
				}
				assert.equal(items.filter((item) => item.name === 'New root').length, 2);
				assert.deepEqual(items.filter((item) => item.parentId === null).map((item) => item.name), position === 'top'
					? ['Zuchinni', 'New root', 'New root', 'Existing root']
					: ['Existing root', 'Zuchinni', 'New root', 'New root']);
				assert.deepEqual(items.filter((item) => item.parentId === rootId).map((item) => item.name), position === 'top'
					? ['Choc milk', 'Tuna can', 'Existing child']
					: ['Existing child', 'Choc milk', 'Tuna can']);
				assert.equal(c.store.getUndoCount(), 1);
				c.store.undoLastAction();
				assert.deepEqual(c.data.readItems(listId), before);
			} finally { c.dispose(); }
		});
	}
}

test('plain text skips existing list names but retains repeated new names and case differences', async () => {
	const probe = clipboardState(async () => ' Milk \nBread\nBread\nmilk\nChild task\n\n123');
	probe.state.settings.addItemPosition = 'top';
	probe.state.readItems = (listId) => {
		assert.equal(listId, 'list-a');
		return [{ name: ' Milk ' }, { name: 'Child task', parentId: 'parent' }];
	};
	await probe.run();
	assert.deepEqual(probe.calls, [['text', 'list-a', ['Bread', 'Bread', 'milk'], 'top']]);
	assert.equal(probe.state.copyStatus, 'idle');
});

test('plain text with only existing names does not create items and releases the import guard', async () => {
	const probe = clipboardState(async () => 'Milk\nMilk');
	probe.state.readItems = () => [{ name: 'Milk' }];
	await probe.run();
	assert.deepEqual(probe.calls, []);
	assert.deepEqual(probe.alerts, []);
	assert.equal(probe.state.copyStatus, 'idle');
	assert.equal(probe.state.isPasting, false);
});

test('plain text matches existing names regardless of trailing hashtags on either name', async () => {
	const probe = clipboardState(async () => 'Milk #shopping #weekly\nBread\nEggs #fresh\nCoffee #shopping\nCoffee #weekly');
	probe.state.readItems = () => [{ name: 'Milk' }, { name: 'Bread #bakery #weekly  ' }, { name: 'Eggs #shopping' }];
	await probe.run();
	assert.deepEqual(probe.calls, [['text', 'list-a', ['Coffee #shopping', 'Coffee #weekly'], 'bottom']]);
	assert.equal(probe.state.copyStatus, 'idle');
});

test('plain text preserves inline hashtags, URL fragments and different hashtag-only names when matching', async () => {
	const probe = clipboardState(async () => 'Buy milk\nhttps://example.com/#other\n#weekly\nMilk #shopping later\nMilk #shopping!');
	probe.state.readItems = () => [
		{ name: 'Buy #shopping milk' }, { name: 'https://example.com/#shopping' },
		{ name: '#shopping' }, { name: 'Milk' }
	];
	await probe.run();
	assert.deepEqual(probe.calls, [['text', 'list-a', [
		'Buy milk', 'https://example.com/#other', '#weekly', 'Milk #shopping later', 'Milk #shopping!'
	], 'bottom']]);
});

test('plain text checks current names after the clipboard read, while JSON still imports existing names', async () => {
	let resolve;
	const probe = clipboardState(() => new Promise((done) => { resolve = done; }));
	const pending = probe.run();
	probe.state.readItems = () => [{ name: 'Milk' }];
	resolve('Milk\nBread');
	await pending;
	const exportedItems = [{ id: 'old', name: 'Milk' }];
	probe.state.navigator.clipboard.readText = async () => JSON.stringify({ __list_app__: true, items: exportedItems });
	await probe.run();
	assert.deepEqual(probe.calls, [
		['text', 'list-a', ['Bread'], 'bottom'],
		['json', 'list-a', exportedItems]
	]);
});

test('clipboard permission rejection and invalid exports release the guard', async () => {
	const probe = clipboardState(async () => { throw new Error('Permission denied'); });
	await probe.run(); assert.equal(probe.state.isPasting, false);
	probe.state.navigator.clipboard.readText = async () => '{"__list_app__":true,"items":[]}';
	await probe.run(); assert.equal(probe.state.isPasting, false);
	probe.state.navigator.clipboard.readText = async () => 'Retry task'; await probe.run();
	assert.equal(probe.calls.length, 1); assert.equal(probe.alerts.length, 2);
});

for (const mode of ['items', 'tasks']) {
	test(`${mode} import mutation errors are reported, not retried as plain text`, async () => {
		const probe = clipboardState(async () => mode === 'tasks'
			? '[ ] Task'
			: '{"__list_app__":true,"items":[{"id":"x","name":"Task"}]}');
		probe.state.createItemsFromExport = () => { throw new Error('Invalid record'); };
		await probe.run(mode); assert.equal(probe.state.isPasting, false);
		assert.deepEqual(probe.calls, []); assert.match(probe.alerts[0], /Import failed: Invalid record/);
	});

	test(`${mode} clipboard permission errors release the guard for another import`, async () => {
		const probe = clipboardState(async () => { throw new Error('Permission denied'); });
		await probe.run(mode);
		assert.equal(probe.state.isPasting, false);
		assert.deepEqual(probe.calls, []);
		assert.match(probe.alerts[0], /Could not read clipboard/);
		probe.state.navigator.clipboard.readText = async () => '[ ] Task';
		await probe.run(mode);
		assert.equal(probe.calls.length, 1);
	});

	for (const transition of ['navigation', 'history', 'unmount', 'deletion', 'round-trip navigation']) {
		test(`pending ${mode} clipboard import is cancelled after ${transition}`, async () => {
			let resolve;
			const probe = clipboardState(() => new Promise((done) => { resolve = done; }));
			const pending = probe.run(mode);
			if (transition === 'navigation') probe.state.listId = 'list-b';
			if (transition === 'history') probe.state.commitState.isHistorical = true;
			if (transition === 'unmount') probe.state.isActive = false;
			if (transition === 'deletion') probe.state.readLists = () => [];
			if (transition === 'round-trip navigation') probe.state.listContextVersion++;
			resolve('[ ] Task'); await pending;
			assert.deepEqual(probe.calls, []); assert.equal(probe.state.isPasting, false);
		});
	}

	test(`concurrent clipboard imports share one read while importing ${mode}`, async () => {
		let resolve, reads = 0;
		const probe = clipboardState(() => { reads++; return new Promise((done) => { resolve = done; }); });
		const first = probe.run(mode);
		await probe.run('items'); await probe.run('tasks');
		assert.equal(reads, 1);
		resolve('[ ] Task'); await first; assert.equal(probe.calls.length, 1);
	});
}

for (const outcome of ['network-online', 'network-offline', 'server-error', 'success']) {
	test(`logout ${outcome} keeps authentication and document lifecycle consistent`, async () => {
		const c = createApp({
			username: 'alice', navigator: { onLine: outcome !== 'network-offline' },
			fetch: async () => {
				if (outcome.startsWith('network')) throw new Error('Network failure');
				return { ok: outcome === 'success', status: outcome === 'success' ? 200 : 503 };
			}
		});
		try {
			const auth = c.load('src/lib/auth.svelte.ts'); const alerts = [];
			const source = componentFunctions('src/routes/+page.svelte', ['handleLogout']);
			const logout = new Function('logout', 'destroyYjs', 'alert', transpile(source + '\nreturn handleLogout;'))(auth.logout, c.store.destroyYjs, (message) => alerts.push(message));
			await logout();
			if (outcome === 'success') {
				assert.equal(auth.auth.username, null); assert.throws(() => c.store.getDoc(), /not initialised/); assert.deepEqual(alerts, []);
			} else {
				assert.equal(auth.auth.username, 'alice'); assert.equal(c.store.getDoc(), c.doc); assert.equal(alerts.length, 1);
			}
		} finally { c.dispose(); }
	});
}

test('historical note editor save/cancel cannot mutate a document', () => {
	const calls = [];
	const source = componentFunctions('src/lib/components/FullScreenEditor.svelte', ['handleSave', 'discardChanges']);
	const state = { readOnly: true, commitState: { isHistorical: true }, binding: {}, editSession: { commit: () => calls.push('commit'), discard: () => calls.push('discard') } };
	const handlers = new Function('state', `with (state) { ${transpile(source)}; return { handleSave, discardChanges }; }`)(state);
	handlers.handleSave(); handlers.discardChanges(); assert.deepEqual(calls, []);
});
