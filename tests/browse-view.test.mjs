import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parse } from 'svelte/compiler';

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
