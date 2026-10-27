import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installDataRefresh } from '../src/lib/dataRefresh.ts';

function fixture() {
	const target = new EventTarget();
	let ready = true;
	let refreshes = 0;
	const stop = installDataRefresh(target as unknown as Window, () => ready, async () => { refreshes++; });
	function key(key: string, modifiers: Record<string, boolean> = {}) {
		const event = Object.assign(new Event('keydown', { cancelable: true }), { key, ...modifiers });
		target.dispatchEvent(event);
		return event;
	}
	return { key, stop, setReady: (value: boolean) => { ready = value; }, get refreshes() { return refreshes; } };
}

for (const [name, key, modifiers] of [
	['F5', 'F5', {}], ['Ctrl+R', 'r', { ctrlKey: true }], ['Cmd+R', 'R', { metaKey: true }]
] as const) {
	test(`${name} refreshes data instead of reloading the document`, () => {
		const f = fixture();
		assert.equal(f.key(key, modifiers).defaultPrevented, true);
		assert.equal(f.refreshes, 1);
		assert.equal(f.key(key, { ...modifiers, repeat: true }).defaultPrevented, true);
		assert.equal(f.refreshes, 1, 'Holding the key must not repeat refreshes');
		f.stop();
	});
}

for (const [key, modifiers] of [
	['F5', { ctrlKey: true }], ['F5', { shiftKey: true }],
	['r', { ctrlKey: true, shiftKey: true }], ['r', { metaKey: true, shiftKey: true }]
] as const) {
	test(`forced reload ${key} ${JSON.stringify(modifiers)} keeps browser behavior`, () => {
		const f = fixture();
		assert.equal(f.key(key, modifiers).defaultPrevented, false);
		assert.equal(f.refreshes, 0);
		f.stop();
	});
}

test('unrelated keys keep browser behavior', () => {
	const f = fixture();
	assert.equal(f.key('r').defaultPrevented, false);
	assert.equal(f.key('F5', { altKey: true }).defaultPrevented, false);
	assert.equal(f.refreshes, 0);
	f.stop();
});

test('startup/sign-out leave reload alone, and disposal removes the shortcut listener', () => {
	const f = fixture();
	f.setReady(false);
	assert.equal(f.key('F5').defaultPrevented, false);
	f.setReady(true);
	f.stop();
	assert.equal(f.key('F5').defaultPrevented, false);
	assert.equal(f.refreshes, 0);
});
