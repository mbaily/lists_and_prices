import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parse } from 'svelte/compiler';
import { componentFunctions, transpile } from './helpers/app.mjs';

const source = readFileSync(new URL('../src/lib/components/ListScreen.svelte', import.meta.url), 'utf8');
const component = parse(source, { modern: true });

function findNodes(root, predicate) {
	const found = [];
	function visit(value) {
		if (!value || typeof value !== 'object') return;
		if (predicate(value)) found.push(value);
		for (const [key, child] of Object.entries(value)) {
			if (key === 'metadata' || key === 'parent') continue;
			if (Array.isArray(child)) child.forEach(visit);
			else visit(child);
		}
	}
	visit(root);
	return found;
}

function hasClass(node, name) {
	return node.type === 'RegularElement' && node.attributes.some((attribute) =>
		attribute.name === 'class' && attribute.value[0]?.data?.split(' ').includes(name)
	);
}

function guardFor(className) {
	const guards = findNodes(component.fragment, (node) =>
		node.type === 'IfBlock' && findNodes(node.consequent, (child) => hasClass(child, className)).length > 0
	);
	return guards.at(-1);
}

function evaluateGuard(guard, values) {
	const expression = source.slice(guard.test.start, guard.test.end);
	return Function(...Object.keys(values), `return (${expression});`)(...Object.values(values));
}

test('browse toggle follows the menu and exposes its pressed state', () => {
	const header = findNodes(component.fragment, (node) => node.type === 'RegularElement' && node.name === 'header')[0];
	const menu = findNodes(header, (node) => hasClass(node, 'header-menu-wrap'))[0];
	const button = findNodes(header, (node) => hasClass(node, 'browse-view-btn'))[0];
	assert.ok(menu && button);
	assert.match(source.slice(menu.end, button.start), /^\s*$/);
	assert.ok(button.attributes.some((attribute) => attribute.name === 'aria-pressed'));
	assert.match(source.slice(button.start, button.end), /browseView\s*=\s*!browseView/);
});

test('browse mode hides shortcuts and summary while retaining selection controls', () => {
	for (const [className, collection] of [['pin-bar', 'allPinnedItems'], ['fav-bar', 'favouriteItems']]) {
		const guard = guardFor(className);
		assert.ok(guard);
		assert.equal(evaluateGuard(guard, { browseView: false, [collection]: [{}] }), true);
		assert.equal(evaluateGuard(guard, { browseView: true, [collection]: [{}] }), false);
		assert.equal(evaluateGuard(guard, { browseView: false, [collection]: [] }), false);
	}
	const selection = guardFor('selection-bar');
	assert.equal(evaluateGuard(selection, { selectionMode: true, commitState: { isHistorical: false } }), true);
	const summary = selection.alternate.nodes.find((node) => node.type === 'IfBlock');
	assert.ok(summary && findNodes(summary.consequent, (node) => hasClass(node, 'check-counts')).length);
	assert.equal(evaluateGuard(summary, { browseView: false }), true);
	assert.equal(evaluateGuard(summary, { browseView: true }), false);
});

test('favourites wrap instead of scrolling horizontally', () => {
	const rule = findNodes(component.css, (node) =>
		node.type === 'Rule' && source.slice(node.prelude.start, node.prelude.end) === '.fav-bar'
	)[0];
	const css = source.slice(rule.block.start, rule.block.end);
	assert.match(css, /flex-wrap:\s*wrap\s*;/);
	assert.doesNotMatch(css, /overflow-x:\s*(auto|scroll)/);
});

test('list header adds no vertical padding around the breadcrumb', () => {
	const rule = findNodes(component.css, (node) =>
		node.type === 'Rule' && source.slice(node.prelude.start, node.prelude.end) === 'header'
	)[0];
	assert.ok(rule);
	const css = source.slice(rule.block.start, rule.block.end);
	assert.match(css, /padding:\s*0\s+1rem\s*;/);
});

test('favourite navigation wraps through the ordered lists and folders', () => {
	const functions = componentFunctions('src/lib/components/ListScreen.svelte', ['getFavouriteTarget', 'navigateFavourite']);
	const visits = [];
	const state = {
		favouriteItems: [
			{ type: 'folder', item: { id: 'folder-a' } },
			{ type: 'list', item: { id: 'list-a' } },
			{ type: 'folder', item: { id: 'folder-b' } },
			{ type: 'list', item: { id: 'list-b' } }
		],
		listId: 'list-a',
		onOpenList: (id) => visits.push(['list', id]),
		onNavigateTo: (id) => visits.push(['folder', id])
	};
	const { getFavouriteTarget, navigateFavourite } = new Function(
		'state', `with (state) { ${transpile(functions)}; return { getFavouriteTarget, navigateFavourite }; }`
	)(state);

	assert.equal(getFavouriteTarget(-1).item.id, 'folder-a');
	assert.equal(getFavouriteTarget(1).item.id, 'folder-b');
	navigateFavourite(-1);
	navigateFavourite(1);
	assert.deepEqual(visits, [['folder', 'folder-a'], ['folder', 'folder-b']]);
	state.listId = 'list-b';
	assert.equal(getFavouriteTarget(1).item.id, 'folder-a');
	state.listId = 'not-a-favourite';
	assert.equal(getFavouriteTarget(-1).item.id, 'list-b');
	assert.equal(getFavouriteTarget(1).item.id, 'folder-a');
	navigateFavourite(-1);
	assert.deepEqual(visits.at(-1), ['list', 'list-b']);
	state.favouriteItems = [{ type: 'list', item: { id: 'list-b' } }];
	state.listId = 'list-b';
	assert.equal(getFavouriteTarget(-1), null);
	assert.equal(getFavouriteTarget(1), null);
	state.listId = 'other';
	assert.equal(getFavouriteTarget(1).item.id, 'list-b');
	state.favouriteItems = [];
	assert.equal(getFavouriteTarget(-1), null);
	assert.equal(getFavouriteTarget(1), null);
});

test('favourite navigation appears before the input only in browse view', () => {
	const guard = guardFor('favourite-nav');
	assert.ok(guard);
	assert.equal(evaluateGuard(guard, { browseView: true }), true);
	assert.equal(evaluateGuard(guard, { browseView: false }), false);
	const input = findNodes(component.fragment, (node) => hasClass(node, 'input-wrap'))[0];
	assert.match(source.slice(guard.end, input.start), /^\s*$/);
	const buttons = findNodes(guard.consequent, (node) => node.type === 'RegularElement' && node.name === 'button');
	assert.equal(buttons.length, 2);
	for (const button of buttons) {
		assert.ok(button.attributes.some((attribute) => attribute.name === 'disabled'));
		assert.ok(button.attributes.some((attribute) => attribute.name === 'aria-label'));
	}
});
