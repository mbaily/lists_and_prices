import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parse } from 'svelte/compiler';

function elements(file) {
	const root = parse(readFileSync(new URL(file, import.meta.url), 'utf8'), { modern: true }).fragment;
	const found = [];
	function visit(value) {
		if (!value || typeof value !== 'object') return;
		if (value.type === 'RegularElement' || value.type === 'Component') found.push(value);
		for (const [key, child] of Object.entries(value)) {
			if (key === 'metadata' || key === 'parent') continue;
			if (Array.isArray(child)) child.forEach(visit);
			else visit(child);
		}
	}
	visit(root);
	return found;
}

function attribute(element, name) {
	return element.attributes.find((entry) => entry.name === name);
}

function cssRules(file) {
	const source = readFileSync(new URL(file, import.meta.url), 'utf8');
	const rules = new Map();
	function visit(value) {
		if (!value || typeof value !== 'object') return;
		if (value.type === 'Rule') {
			rules.set(source.slice(value.prelude.start, value.prelude.end), source.slice(value.block.start, value.block.end));
		}
		for (const [key, child] of Object.entries(value)) {
			if (key === 'metadata' || key === 'parent') continue;
			if (Array.isArray(child)) child.forEach(visit);
			else visit(child);
		}
	}
	visit(parse(source, { modern: true }).css);
	return rules;
}

test('each non-heading item layout places refresh immediately after its include pill', () => {
	const nodes = elements('../src/lib/components/ListScreen.svelte');
	const wrappers = nodes.filter((node) => node.name === 'span' && attribute(node, 'class')?.value[0]?.data === 'include-pill');
	assert.equal(wrappers.length, 6);
	const labels = wrappers.map((wrapper) => {
		const [link, button] = wrapper.fragment.nodes;
		assert.equal(wrapper.fragment.nodes.length, 2);
		assert.equal(link.name, 'a');
		assert.equal(button.name, 'button');
		assert.ok(attribute(button, 'onclick'));
		assert.ok(attribute(button, 'onkeydown'));
		return attribute(button, 'aria-label').value[0].data;
	});
	assert.equal(labels.filter((label) => label === 'Refresh bills').length, 3);
	assert.equal(labels.filter((label) => label === 'Refresh calendar').length, 3);
	for (const component of ['BillsInclude', 'CalendarInclude']) {
		const instance = nodes.find((node) => node.type === 'Component' && node.name === component);
		assert.ok(instance?.attributes.some((entry) => entry.type === 'BindDirective' && entry.name === 'this'));
	}
});

for (const component of ['BillsInclude', 'CalendarInclude']) {
	test(`${component} has no duplicate visible section heading or bottom refresh button`, () => {
		const nodes = elements(`../src/lib/components/${component}.svelte`);
		assert.equal(nodes.filter((node) => node.name === 'strong').length, 0);
		assert.equal(nodes.filter((node) => node.name === 'button' && attribute(node, 'class')?.value[0]?.data === 'refresh').length, 0);
		assert.ok(nodes.some((node) => node.name === 'section' && attribute(node, 'aria-label')));
	});

	test(`${component} has no vertical padding or list margins`, () => {
		const rules = cssRules(`../src/lib/components/${component}.svelte`);
		const selector = component === 'BillsInclude' ? '.bills-includes' : '.calendar-includes';
		assert.match(rules.get(selector), /padding:\s*0\s+[^;]+\s+0\s+[^;]+;/);
		assert.match(rules.get('p, ul'), /margin:\s*0\s*;/);
		assert.doesNotMatch(rules.get('section') ?? '', /margin/);
	});
}

test('items with includes have no bottom padding, including priced touch layouts', () => {
	const rules = cssRules('../src/lib/components/ListScreen.svelte');
	assert.match(rules.get('.item-row.has-bills'), /padding-bottom:\s*0\s*;/);
	assert.match(rules.get('.item-row.priced-row.has-bills'), /padding-bottom:\s*0\s*;/);
});
