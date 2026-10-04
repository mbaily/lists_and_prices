// @ts-nocheck -- Exercise actual component functions with explicit UI state.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp, componentFunctions, transpile } from './helpers/app.mjs';

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

function clipboardState(readText) {
	const calls = [], alerts = [];
	const state = {
		isPasting: false, canEditList: true, listId: 'list-a', listContextVersion: 0, isActive: true,
		settings: { addItemPosition: 'bottom' }, commitState: { isHistorical: false },
		navigator: { clipboard: { readText } }, readLists: () => [{ id: 'list-a' }, { id: 'list-b' }],
		readItems: () => [],
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

test('import mutation errors are reported, not retried as plain text', async () => {
	const probe = clipboardState(async () => '{"__list_app__":true,"items":[{"id":"x","name":"Task"}]}');
	probe.state.createItemsFromExport = () => { throw new Error('Invalid record'); };
	await probe.run(); assert.equal(probe.state.isPasting, false);
	assert.deepEqual(probe.calls, []); assert.match(probe.alerts[0], /Import failed: Invalid record/);
});

for (const transition of ['navigation', 'history', 'unmount', 'deletion', 'round-trip navigation']) {
	test(`pending clipboard import is cancelled after ${transition}`, async () => {
		let resolve;
		const probe = clipboardState(() => new Promise((done) => { resolve = done; }));
		const pending = probe.run();
		if (transition === 'navigation') probe.state.listId = 'list-b';
		if (transition === 'history') probe.state.commitState.isHistorical = true;
		if (transition === 'unmount') probe.state.isActive = false;
		if (transition === 'deletion') probe.state.readLists = () => [];
		if (transition === 'round-trip navigation') probe.state.listContextVersion++;
		resolve('Task'); await pending;
		assert.deepEqual(probe.calls, []); assert.equal(probe.state.isPasting, false);
	});
}

test('concurrent clipboard clicks issue only one read', async () => {
	let resolve, reads = 0;
	const probe = clipboardState(() => { reads++; return new Promise((done) => { resolve = done; }); });
	const first = probe.run(); await probe.run(); assert.equal(reads, 1);
	resolve('Task'); await first; assert.equal(probe.calls.length, 1);
});

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
