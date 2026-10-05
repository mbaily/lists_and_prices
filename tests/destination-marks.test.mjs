// @ts-nocheck -- Execute the real local storage module and component handlers.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { parse } from 'svelte/compiler';
import { createApp, componentFunctions, root, transpile, Y } from './helpers/app.mjs';

function markStorage(auth = { username: 'alice' }) {
	const values = new Map();
	const storage = {
		getItem: (key) => values.get(key) ?? null,
		setItem: (key, value) => values.set(key, value)
	};
	const source = transpile(readFileSync(path.join(root, 'src/lib/destinationMarks.ts'), 'utf8'));
	function load(browserStorage = storage) {
		const module = { exports: {} };
		new Function('require', 'module', 'exports', 'localStorage', source)(
			(specifier) => { assert.equal(specifier, './auth.svelte'); return { auth }; },
			module, module.exports, browserStorage ?? undefined
		);
		return module.exports;
	}
	return { values, storage, auth, load, marks: load() };
}

test('destination registers survive reloads and replacing one name keeps other marks', () => {
	const p = markStorage();
	p.marks.setDestinationMark(p.marks.DEFAULT_MARK_NAME, { kind: 'list', id: 'list-a' });
	p.marks.setDestinationMark(' a ', { kind: 'list', id: 'list-b' });
	const reloaded = p.load();
	assert.deepEqual(reloaded.getDestinationMark(), { kind: 'list', id: 'list-a' });
	assert.deepEqual(reloaded.getDestinationMark('a'), { kind: 'list', id: 'list-b' });
	reloaded.setDestinationMark('a', { kind: 'list', id: 'list-c' });
	assert.deepEqual(p.marks.readDestinationMarks(), {
		default: { kind: 'list', id: 'list-a' }, a: { kind: 'list', id: 'list-c' }
	});
});

test('marks accept other entity kinds, case-sensitive names and prototype-like register names', () => {
	const p = markStorage();
	for (const [name, kind] of [['a', 'note'], ['A', 'folder'], ['__proto__', 'todo'], ['constructor', 'sheet'], ['Inbox 📥', 'future-entity']]) {
		p.marks.setDestinationMark(name, { kind, id: `${kind}-id` });
		assert.deepEqual(p.load().getDestinationMark(name), { kind, id: `${kind}-id` });
	}
	assert.equal(p.marks.getDestinationMark('toString'), null);
	assert.equal(p.marks.getDestinationMark('missing'), null);
	assert.equal({}.kind, undefined);
	assert.throws(() => p.marks.setDestinationMark('  ', { kind: 'list', id: 'x' }), /Enter a name/);
	assert.throws(() => p.marks.setDestinationMark('bad', { kind: '', id: 'x' }), /Invalid mark destination/);
});

test('destination marks are separated by signed-in user and guest', () => {
	const p = markStorage();
	p.marks.setDestinationMark('a', { kind: 'list', id: 'alice-list' });
	p.auth.username = 'bob';
	assert.deepEqual(p.marks.readDestinationMarks(), {});
	p.marks.setDestinationMark('a', { kind: 'list', id: 'bob-list' });
	p.auth.username = null;
	assert.equal(p.marks.getDestinationMark('a'), null);
	p.auth.username = 'alice';
	assert.deepEqual(p.marks.getDestinationMark('a'), { kind: 'list', id: 'alice-list' });
	assert.deepEqual([...p.values.keys()], ['pnl_destination_marks:alice', 'pnl_destination_marks:bob']);
});

test('malformed local storage is tolerated and invalid destinations are discarded', () => {
	const p = markStorage();
	for (const value of ['broken JSON', 'null', '[]', '42']) {
		p.values.set('pnl_destination_marks:alice', value);
		assert.deepEqual(p.marks.readDestinationMarks(), {});
	}
	p.values.set('pnl_destination_marks:alice', JSON.stringify({
		a: { kind: 'list', id: 'good' }, bad: null, missing: { kind: 'note' },
		'': { kind: 'list', id: 'empty-name' }, empty: { kind: 'folder', id: ' ' }
	}));
	assert.deepEqual(p.marks.readDestinationMarks(), { a: { kind: 'list', id: 'good' } });
});

test('unavailable storage reports save failures without overwriting existing marks', () => {
	const p = markStorage();
	p.marks.setDestinationMark('a', { kind: 'list', id: 'keep' });
	p.storage.setItem = () => { throw new Error('Storage blocked'); };
	assert.throws(() => p.marks.setDestinationMark('a', { kind: 'list', id: 'replacement' }), /Storage blocked/);
	assert.deepEqual(p.marks.getDestinationMark('a'), { kind: 'list', id: 'keep' });
	const server = p.load(null);
	assert.deepEqual(server.readDestinationMarks(), {});
	assert.throws(() => server.setDestinationMark('a', { kind: 'list', id: 'x' }), /Local storage/);
});

function listMarkProbe() {
	const app = createApp({ username: 'alice' });
	const auth = app.load('src/lib/auth.svelte.ts').auth;
	const p = markStorage(auth);
	const folder = app.data.createFolder('Folder', null);
	const id = app.data.createList('Inbox', folder, 'plain');
	const state = {
		DEFAULT_MARK_NAME: p.marks.DEFAULT_MARK_NAME, setDestinationMark: p.marks.setDestinationMark,
		commitState: { isHistorical: false }, markTarget: null, markName: '', markError: '', markFeedback: '',
		markNameInputEl: null, tick: async () => {},
		get allLists() { return app.data.readLists(); }
	};
	const source = componentFunctions('src/lib/components/HomeScreen.svelte', [
		'startNamedMark', 'markListDestination', 'submitNamedMark'
	]);
	const handlers = new Function('state', `with (state) { ${transpile(source)}; return {
		startNamedMark, markListDestination, submitNamedMark
	}; }`)(state);
	return { ...p, app, state, handlers, id, list: () => state.allLists.find((list) => list.id === id) };
}

test('Mark saves the default destination and Mark named pre-fills an editable name without touching Yjs', () => {
	const p = listMarkProbe();
	try {
		const before = Y.encodeStateAsUpdate(p.app.doc);
		const undoCount = p.app.store.getUndoCount();
		p.handlers.markListDestination(p.list());
		assert.deepEqual(p.marks.getDestinationMark(), { kind: 'list', id: p.id });
		assert.match(p.state.markFeedback, /Inbox.*default/);
		p.handlers.startNamedMark(p.list());
		assert.equal(p.state.markName, 'default');
		p.state.markName = ' archive ';
		p.handlers.submitNamedMark();
		assert.deepEqual(p.marks.getDestinationMark('archive'), { kind: 'list', id: p.id });
		assert.equal(p.state.markTarget, null);
		assert.deepEqual(Y.encodeStateAsUpdate(p.app.doc), before);
		assert.equal(p.app.store.getUndoCount(), undoCount);
	} finally { p.app.dispose(); }
});

test('cancelling or submitting a blank named mark does not save a destination', () => {
	const p = listMarkProbe();
	try {
		p.handlers.startNamedMark(p.list());
		p.state.markTarget = null;
		p.handlers.submitNamedMark();
		assert.deepEqual(p.marks.readDestinationMarks(), {});
		p.handlers.startNamedMark(p.list());
		p.state.markName = '  ';
		p.handlers.submitNamedMark();
		assert.deepEqual(p.marks.readDestinationMarks(), {});
	} finally { p.app.dispose(); }
});

test('historical views and deleted lists cannot receive a new destination mark', () => {
	const p = listMarkProbe();
	try {
		const list = p.list();
		p.handlers.startNamedMark(list);
		p.state.commitState.isHistorical = true;
		p.handlers.submitNamedMark();
		p.handlers.markListDestination(list);
		assert.deepEqual(p.marks.readDestinationMarks(), {});
		p.state.commitState.isHistorical = false;
		p.app.data.deleteList(p.id);
		p.handlers.submitNamedMark();
		p.handlers.markListDestination(list);
		assert.deepEqual(p.marks.readDestinationMarks(), {});
	} finally { p.app.dispose(); }
});

test('save errors keep the named mark dialog open for retry', () => {
	const p = listMarkProbe();
	try {
		p.storage.setItem = () => { throw new Error('Quota exceeded'); };
		p.handlers.markListDestination(p.list());
		assert.equal(p.state.markTarget.id, p.id);
		assert.equal(p.state.markName, 'default');
		assert.match(p.state.markError, /Could not save/);
		assert.equal(p.state.markFeedback, '');
		assert.deepEqual(p.marks.readDestinationMarks(), {});
	} finally { p.app.dispose(); }
});

test('the list menu places the Mark submenu above Delete, with Mark named second', () => {
	const source = readFileSync(path.join(root, 'src/lib/components/HomeScreen.svelte'), 'utf8');
	let menus = 0;
	function visit(node) {
		if (!node || typeof node !== 'object') return;
		if (node.type === 'Component' && node.name === 'RowMenu') {
			const value = node.attributes.find((attribute) => attribute.name === 'items').value;
			const expression = (Array.isArray(value) ? value[0] : value).expression;
			const code = source.slice(expression.start, expression.end);
			if (code.includes('markListDestination')) {
				const entries = new Function('list', 'hasTag', `return (${code});`)({ id: 'fixture' }, false);
				assert.equal(entries.at(-2).label, '🏷 Mark');
				assert.deepEqual(entries.at(-2).submenu.map((item) => item.label), ['🏷 Mark', '🏷 Mark named']);
				assert.equal(entries.at(-1).label, '🗑 Delete');
				menus++;
			}
		}
		for (const value of Object.values(node)) {
			if (Array.isArray(value)) value.forEach(visit);
			else if (value && typeof value === 'object') visit(value);
		}
	}
	visit(parse(source, { modern: true }).fragment);
	assert.equal(menus, 1);
});
