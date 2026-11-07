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

test('full-screen items do not clamp wrapped include entries', () => {
	const nodes = elements('../src/lib/components/ListScreen.svelte');
	const text = readFileSync(new URL('../src/lib/components/ListScreen.svelte', import.meta.url), 'utf8');
	const clamped = nodes.flatMap((node) => node.attributes.filter((entry) => entry.type === 'ClassDirective' && entry.name === 'fullscreen-clamp'));
	assert.equal(clamped.length, 3);
	for (const directive of clamped) {
		assert.match(text.slice(directive.expression.start, directive.expression.end), /!hasWrappedIncludes/);
	}
});

test('calendar layouts share date-title formatting and start wrapped entries with bullets and spacing', () => {
	const list = readFileSync(new URL('../src/lib/components/ListScreen.svelte', import.meta.url), 'utf8');
	const calendar = readFileSync(new URL('../src/lib/components/CalendarInclude.svelte', import.meta.url), 'utf8');
	assert.match(list, /calendarLine\(entry\.label, entry\.title\)/);
	assert.match(calendar, /calendarLine\(calendarOccurrenceLabel\(row, now\), row\.event\.title\)/);
	assert.match(list, /include-bullet[^{}]*•<\/[^>]+>\{'\s+'\}/);
});

test('icon notation parses alongside regular includes and leaves unknown options as text', () => {
	const app = createApp();
	try {
		const { splitWithTags } = app.load('src/lib/tags.ts');
		const { findBillSections } = app.load('src/lib/billsInclude.ts');
		const { findCalendarSections } = app.load('src/lib/calendarInclude.ts');
		const { findIncludeTokens } = app.load('src/lib/includeTokens.ts');
		const source = componentFunctions('src/lib/components/ListScreen.svelte', ['parseNameParts']);
		const parseNameParts = new Function('splitWithTags', 'findBillSections', 'findCalendarSections', 'findIncludeTokens',
			`${transpile(source)}; return parseNameParts;`)(splitWithTags, findBillSections, findCalendarSections, findIncludeTokens);
		assert.deepEqual(parseNameParts('[[bills:upcoming:icon:wrap]] [[CALENDAR:TODAY:WRAP:ICON]] [[calendar:today]] [[bills:upcoming:other]]'), [
			{ type: 'bills', value: 'upcoming', icon: true, wrap: true },
			{ type: 'text', value: ' ' },
			{ type: 'calendar', value: 'today', icon: true, wrap: true },
			{ type: 'text', value: ' ' },
			{ type: 'calendar', value: 'today', icon: false, wrap: false },
			{ type: 'text', value: ' [[bills:upcoming:other]]' }
		]);
	} finally {
		app.dispose();
	}
});

test('wrapped bills surface loading, errors, empty sections and formatted entries', () => {
	const app = createApp();
	try {
		const { billLine } = app.load('src/lib/billsInclude.ts');
		const source = componentFunctions('src/lib/components/BillsInclude.svelte', ['sectionView'])
			.replace('export function ', 'function ');
		const state = { loading: true, error: '', data: null, billLine };
		const sectionView = new Function('state', `with (state) { ${transpile(source)}; return sectionView; }`)(state);
		assert.deepEqual(sectionView('upcoming'), { status: 'loading' });
		state.loading = false;
		state.error = 'Unavailable';
		assert.deepEqual(sectionView('upcoming'), { status: 'error', message: 'Unavailable' });
		state.error = '';
		state.data = { upcoming: [] };
		assert.deepEqual(sectionView('upcoming'), { status: 'ready', entries: [] });
		assert.deepEqual(sectionView('overdue'), { status: 'unavailable' });
		state.data.upcoming = [{ name: 'Power', effective_amount: 25, currency_symbol: '$' }, null];
		assert.deepEqual(sectionView('upcoming'), { status: 'error', message: 'Invalid bills response.' });
		state.data.upcoming.pop();
		assert.deepEqual(sectionView('upcoming'), { status: 'ready', entries: ['Power, $25.00'] });
		state.data.overdue = [{ name: 'Exetel', effective_amount: 30, currency_symbol: '$', next_due_date: '2026-11-01' }];
		assert.deepEqual(sectionView('upcoming'), { status: 'ready', entries: ['Exetel, $30.00, due 2026-11-01', 'Power, $25.00'] });
	} finally {
		app.dispose();
	}
});

test('wrapped calendar keeps the selected range and completed occurrence information', () => {
	const app = createApp();
	try {
		const { calendarRange, calendarOccurrenceLabel } = app.load('src/lib/calendarInclude.ts');
		const source = componentFunctions('src/lib/components/CalendarInclude.svelte', ['sectionRows', 'sectionView'])
			.replace('export function ', 'function ');
		const state = {
			loading: false, error: '', now: new Date(2026, 10, 1, 12), calendarRange, calendarOccurrenceLabel,
			occurrences: [
				{ event: { title: 'Meeting', all_day: false }, occurrence_at: '2026-11-01T09:30:00', completed: false },
				{ event: { title: 'Done', all_day: true }, occurrence_at: '2026-11-01T00:00:00', completed: true },
				{ event: { title: 'Tomorrow', all_day: true }, occurrence_at: '2026-11-02T00:00:00', completed: false }
			]
		};
		const sectionView = new Function('state', `with (state) { ${transpile(source)}; return sectionView; }`)(state);
		assert.deepEqual(sectionView('today'), {
			status: 'ready',
			entries: [
				{ label: 'Today 09:30', title: 'Meeting', completed: false },
				{ label: 'Today', title: 'Done', completed: true }
			]
		});
		state.error = 'Sign in';
		assert.deepEqual(sectionView('today'), { status: 'error', message: 'Sign in' });
		state.loading = true;
		assert.deepEqual(sectionView('today'), { status: 'loading' });

		// Late important occurrences remain indefinitely until completed
		state.loading = false;
		state.error = '';
		state.occurrences = [
			// Past uncompleted important event (from yesterday)
			{ event: { title: 'Overdue bill review', all_day: false, important_if_late: true }, occurrence_at: '2026-10-31T09:00:00', completed: false, is_late: true, is_important: true },
			// Past uncompleted normal event (should NOT be retained in 'today')
			{ event: { title: 'Old normal meeting', all_day: false, important_if_late: false }, occurrence_at: '2026-10-31T10:00:00', completed: false, is_late: true, is_important: false },
			// Past completed important event (checked in calendar - should NOT be retained)
			{ event: { title: 'Done task', all_day: false, important_if_late: true }, occurrence_at: '2026-10-31T11:00:00', completed: true, is_late: false, is_important: false },
			// Today normal event
			{ event: { title: 'Today call', all_day: false }, occurrence_at: '2026-11-01T14:00:00', completed: false }
		];
		assert.deepEqual(sectionView('today'), {
			status: 'ready',
			entries: [
				{ label: 'Yesterday 09:00', title: 'Overdue bill review', completed: false, isImportant: true },
				{ label: 'Today 14:00', title: 'Today call', completed: false }
			]
		});
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

test('filtered tree items each block is keyed by item id to maintain inclusion identity', () => {
	const text = readFileSync(new URL('../src/lib/components/ListScreen.svelte', import.meta.url), 'utf8');
	assert.match(text, /\{#each\s+filteredTreeItems\s+as\s+\{[^}]+\}\s*\(\s*item\.id\s*\)\s*\}/);
});

test('include refresh button has spinning animation when refreshed', () => {
	const rules = cssRules('../src/lib/components/ListScreen.svelte');
	assert.match(rules.get('.include-refresh.spinning'), /animation:\s*spin\b/);
	const text = readFileSync(new URL('../src/lib/components/ListScreen.svelte', import.meta.url), 'utf8');
	assert.match(text, /triggerRefreshInclude/);
	assert.match(text, /class:spinning=\{refreshingIncludes\[/);
});

