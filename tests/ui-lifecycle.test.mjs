// @ts-nocheck -- Exercise actual component functions with explicit UI state.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp, componentFunctions, transpile } from './helpers/app.mjs';

function clipboardState(readText) {
	const calls = [], alerts = [];
	const state = {
		isPasting: false, canEditList: true, listId: 'list-a', listContextVersion: 0, isActive: true,
		settings: { addItemPosition: 'bottom' }, commitState: { isHistorical: false },
		navigator: { clipboard: { readText } }, readLists: () => [{ id: 'list-a' }, { id: 'list-b' }],
		createItemsBatch: (...args) => calls.push(['text', ...args]),
		createItemsFromExport: (...args) => calls.push(['json', ...args]),
		alert: (message) => alerts.push(message), copyMessage: '', copyStatus: 'idle', importFeedbackTimer: null,
		setTimeout: () => 1, clearTimeout: () => {}
	};
	const source = componentFunctions('src/lib/components/ListScreen.svelte', ['importFromClipboard']);
	const run = new Function('state', `with (state) { ${transpile(source)}; return importFromClipboard; }`)(state);
	return { state, calls, alerts, run };
}

test('clipboard imports can be repeated after both plain text and JSON success', async () => {
	const probe = clipboardState(async () => 'First task');
	await probe.run(); assert.equal(probe.state.isPasting, false);
	probe.state.navigator.clipboard.readText = async () => JSON.stringify({ __list_app__: true, items: [{ id: 'old', name: 'Second task' }] });
	await probe.run(); assert.equal(probe.state.isPasting, false);
	assert.equal(probe.calls.length, 2); assert.equal(probe.calls[1][0], 'json');
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