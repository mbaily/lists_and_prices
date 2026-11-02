import { test } from 'node:test';
import { strictEqual, deepStrictEqual } from 'node:assert';
import {
	cleanNamespaceSlug,
	getNamespace,
	getPageBaseName,
	getNamespaceSegments,
	resolveNamespaceLink,
	findNamespaceStartPage,
	buildNamespaceTree
} from '../src/lib/wiki/namespaces';
import type { WikiPage } from '../src/lib/wiki/data';

test('cleanNamespaceSlug normalizes slugs with namespace colons', () => {
	strictEqual(cleanNamespaceSlug('projects:client_a:specs'), 'projects:client_a:specs');
	strictEqual(cleanNamespaceSlug('  Projects : Client A : Specs  '), 'projects:client_a:specs');
	strictEqual(cleanNamespaceSlug(':projects::specs:'), 'projects:specs');
	strictEqual(cleanNamespaceSlug(''), 'start');
	strictEqual(cleanNamespaceSlug(':::'), 'start');
});

test('getNamespace and getPageBaseName extract components correctly', () => {
	strictEqual(getNamespace('projects:client_a:specs'), 'projects:client_a');
	strictEqual(getPageBaseName('projects:client_a:specs'), 'specs');

	strictEqual(getNamespace('projects:specs'), 'projects');
	strictEqual(getPageBaseName('projects:specs'), 'specs');

	strictEqual(getNamespace('start'), '');
	strictEqual(getPageBaseName('start'), 'start');
});

test('getNamespaceSegments extracts hierarchical breadcrumbs', () => {
	const segs = getNamespaceSegments('work:projects:client_a:specs');
	deepStrictEqual(segs, [
		{ name: 'work', fullPath: 'work' },
		{ name: 'projects', fullPath: 'work:projects' },
		{ name: 'client_a', fullPath: 'work:projects:client_a' }
	]);

	deepStrictEqual(getNamespaceSegments('start'), []);
});

test('resolveNamespaceLink handles absolute, relative, and plain links', () => {
	const existing = new Set(['start', 'projects:specs', 'projects:client:notes', 'recipes:cake']);
	const pageExists = (s: string) => existing.has(s);

	// 1. Explicitly absolute with leading colon
	strictEqual(resolveNamespaceLink(':projects:specs', 'other:page'), 'projects:specs');
	strictEqual(resolveNamespaceLink(':start', 'projects:specs'), 'start');

	// 2. Relative with . (current namespace)
	strictEqual(resolveNamespaceLink('.:notes', 'projects:client:specs'), 'projects:client:notes');
	strictEqual(resolveNamespaceLink('.:', 'projects:client:specs'), 'projects:client:start');

	// 3. Relative with .. (parent namespace)
	strictEqual(resolveNamespaceLink('..:specs', 'projects:client:notes'), 'projects:specs');
	strictEqual(resolveNamespaceLink('..:', 'projects:client:notes'), 'projects:start');
	strictEqual(resolveNamespaceLink('..:..:recipes:cake', 'projects:client:notes'), 'recipes:cake');

	// 4. Plain link inside a namespace
	// Existing in current namespace:
	strictEqual(resolveNamespaceLink('notes', 'projects:client:specs', pageExists), 'projects:client:notes');
	// Existing at root namespace:
	strictEqual(resolveNamespaceLink('start', 'projects:client:specs', pageExists), 'start');
	// New page (neither exists): defaults to current namespace
	strictEqual(resolveNamespaceLink('new_page', 'projects:client:specs', pageExists), 'projects:client:new_page');

	// 5. Plain link at root
	strictEqual(resolveNamespaceLink('specs', 'start'), 'specs');
	strictEqual(resolveNamespaceLink('wiki:projects:specs', 'start'), 'projects:specs');
});

test('findNamespaceStartPage resolves candidate start pages', () => {
	const pages: WikiPage[] = [
		{ id: 'start', title: 'Start', content: '', createdAt: '', updatedAt: '' },
		{ id: 'projects:start', title: 'Projects Home', content: '', createdAt: '', updatedAt: '' },
		{ id: 'clients:clients', title: 'Clients Hub', content: '', createdAt: '', updatedAt: '' },
		{ id: 'docs:index', title: 'Docs Index', content: '', createdAt: '', updatedAt: '' }
	];

	strictEqual(findNamespaceStartPage('', pages), 'start');
	strictEqual(findNamespaceStartPage('projects', pages), 'projects:start');
	strictEqual(findNamespaceStartPage('clients', pages), 'clients:clients');
	strictEqual(findNamespaceStartPage('docs', pages), 'docs:index');
	strictEqual(findNamespaceStartPage('nonexistent', pages), null);
});

test('buildNamespaceTree constructs hierarchical structure', () => {
	const pages: WikiPage[] = [
		{ id: 'start', title: 'Home', content: '', createdAt: '', updatedAt: '' },
		{ id: 'projects:overview', title: 'Projects Overview', content: '', createdAt: '', updatedAt: '' },
		{ id: 'projects:client_a:notes', title: 'Client A Notes', content: '', createdAt: '', updatedAt: '' },
		{ id: 'projects:client_b:specs', title: 'Client B Specs', content: '', createdAt: '', updatedAt: '' },
		{ id: 'personal:recipes', title: 'Recipes', content: '', createdAt: '', updatedAt: '' }
	];

	const tree = buildNamespaceTree(pages);
	strictEqual(tree.isRoot, true);
	strictEqual(tree.pages.length, 1); // 'start'
	strictEqual(tree.pages[0].id, 'start');
	strictEqual(tree.totalPageCount, 5);

	// Subnamespaces under root: 'personal' and 'projects'
	strictEqual(tree.subNamespaces.length, 2);
	strictEqual(tree.subNamespaces[0].name, 'personal');
	strictEqual(tree.subNamespaces[0].totalPageCount, 1);
	strictEqual(tree.subNamespaces[1].name, 'projects');
	strictEqual(tree.subNamespaces[1].totalPageCount, 3);

	// Under 'projects': overview page, client_a, client_b
	const proj = tree.subNamespaces[1];
	strictEqual(proj.pages.length, 1); // 'projects:overview'
	strictEqual(proj.subNamespaces.length, 2); // 'client_a', 'client_b'
	strictEqual(proj.subNamespaces[0].name, 'client_a');
	strictEqual(proj.subNamespaces[0].pages[0].id, 'projects:client_a:notes');
});

