import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parse } from 'svelte/compiler';
import { componentFunctions, createApp, transpile } from './helpers/app.mjs';

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
		assert.ok(attribute(link, 'aria-label'));
		assert.ok(attribute(link, 'title'));
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
		assert.match(rules.get('ul'), /padding-left:\s*0\s*;/);
		assert.doesNotMatch(rules.get('section') ?? '', /margin/);
	});

}

test('include containers align to the item text without a fixed nesting offset', () => {
	const nodes = elements('../src/lib/components/ListScreen.svelte');
	const container = nodes.find((node) => node.name === 'div' && attribute(node, 'class')?.value[0]?.data === 'item-bills');
	assert.ok(container?.attributes.some((entry) => entry.type === 'UseDirective' && entry.name === 'alignIncludes'));
	assert.equal(attribute(container, 'style'), undefined);
});

test('icon notation parses alongside regular includes and leaves unknown options as text', () => {
	const app = createApp();
	try {
		const { splitWithTags } = app.load('src/lib/tags.ts');
		const { findBillSections } = app.load('src/lib/billsInclude.ts');
		const { findCalendarSections } = app.load('src/lib/calendarInclude.ts');
		const source = componentFunctions('src/lib/components/ListScreen.svelte', ['parseNameParts']);
		const parseNameParts = new Function('splitWithTags', 'findBillSections', 'findCalendarSections',
			`${transpile(source)}; return parseNameParts;`)(splitWithTags, findBillSections, findCalendarSections);
		assert.deepEqual(parseNameParts('[[bills:upcoming:icon]] [[CALENDAR:TODAY:ICON]] [[calendar:today]] [[bills:upcoming:other]]'), [
			{ type: 'bills', value: 'upcoming', icon: true },
			{ type: 'text', value: ' ' },
			{ type: 'calendar', value: 'today', icon: true },
			{ type: 'text', value: ' ' },
			{ type: 'calendar', value: 'today', icon: false },
			{ type: 'text', value: ' [[bills:upcoming:other]]' }
		]);
	} finally {
		app.dispose();
	}
});

test('include alignment follows text position changes and disconnects observers', () => {
	class Element {
		constructor(left) { this.left = left; this.style = {}; }
		getBoundingClientRect() { return { left: this.left }; }
	}
	let resize, mutation;
	class Resize {
		constructor(callback) { this.callback = callback; this.targets = new Set(); resize = this; }
		observe(target) { this.targets.add(target); }
		unobserve(target) { this.targets.delete(target); }
		disconnect() { this.disconnected = true; }
	}
	class Mutation {
		constructor(callback) { this.callback = callback; mutation = this; }
		observe(target, options) { this.target = target; this.options = options; }
		disconnect() { this.disconnected = true; }
	}
	const source = componentFunctions('src/lib/components/ListScreen.svelte', ['alignIncludes']);
	const alignIncludes = new Function('HTMLElement', 'ResizeObserver', 'MutationObserver',
		`${transpile(source)}; return alignIncludes;`)(Element, Resize, Mutation);
	const row = new Element(0);
	let name = new Element(80);
	row.querySelector = () => name;
	const container = new Element(10);
	container.previousElementSibling = row;
	const action = alignIncludes(container);
	assert.equal(container.style.paddingLeft, '70px');
	assert.ok(resize.targets.has(name));
	name.left = 105;
	resize.callback();
	assert.equal(container.style.paddingLeft, '95px');
	const oldName = name;
	name = new Element(55);
	mutation.callback();
	assert.equal(container.style.paddingLeft, '45px');
	assert.equal(resize.targets.has(oldName), false);
	assert.equal(resize.targets.has(name), true);
	action.destroy();
	assert.equal(resize.disconnected, true);
	assert.equal(mutation.disconnected, true);
});

test('items with includes have no bottom padding, including priced touch layouts', () => {
	const rules = cssRules('../src/lib/components/ListScreen.svelte');
	assert.match(rules.get('.item-row.has-bills'), /padding-bottom:\s*0\s*;/);
	assert.match(rules.get('.item-row.priced-row.has-bills'), /padding-bottom:\s*0\s*;/);
});
