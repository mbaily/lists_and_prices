import { test } from 'node:test';
import { strictEqual, deepStrictEqual } from 'node:assert';
import * as Y from 'yjs';
import { readWikiPages, readWikiPage, saveWikiPage, deleteWikiPage, findWikiBacklinks } from '../src/lib/wiki/data';
import { splitWithTags } from '../src/lib/tags';

test('splitWithTags parses wiki-ref with and without labels', () => {
	const segs = splitWithTags('Check [[wiki:project_x]] and [[wiki:start|Start Page]] now');
	strictEqual(segs.length, 5);
	deepStrictEqual(segs[0], { type: 'text', value: 'Check ' });
	deepStrictEqual(segs[1], { type: 'wiki-ref', value: 'project_x' });
	deepStrictEqual(segs[2], { type: 'text', value: ' and ' });
	deepStrictEqual(segs[3], { type: 'wiki-ref', value: 'start', label: 'Start Page' });
	deepStrictEqual(segs[4], { type: 'text', value: ' now' });
});

test('saveWikiPage, readWikiPage, readWikiPages and deleteWikiPage work on Y.Doc', () => {
	const doc = new Y.Doc();

	// Initially empty
	strictEqual(readWikiPages(doc).length, 0);
	strictEqual(readWikiPage(doc, 'start'), null);

	// Create a page
	saveWikiPage(doc, 'start', {
		title: 'Home / Start',
		content: '====== Start Page ======\nWelcome to the wiki!',
		summary: 'Initial page creation',
		isMinor: false
	});

	const page = readWikiPage(doc, 'start');
	strictEqual(page !== null, true);
	strictEqual(page?.id, 'start');
	strictEqual(page?.title, 'Home / Start');
	strictEqual(page?.lastSummary, 'Initial page creation');
	strictEqual(page?.isMinor, false);
	strictEqual(page?.revisions?.length ?? 0, 0);

	// Edit page: should record previous version into revisions
	saveWikiPage(doc, 'start', {
		title: 'Home / Start (Updated)',
		content: '====== Start Page ======\nWelcome to the wiki!\nNew section here.',
		summary: 'Added new section',
		isMinor: false
	});

	const updated = readWikiPage(doc, 'start');
	strictEqual(updated?.revisions?.length, 1);
	strictEqual(updated?.revisions?.[0].content, '====== Start Page ======\nWelcome to the wiki!');
	strictEqual(updated?.revisions?.[0].summary, 'Initial page creation');

	// Create second page
	saveWikiPage(doc, 'tasks', {
		title: 'Tasks',
		content: 'Link back to [[start]] and todo [[item:item1]].',
		summary: 'Added link',
		isMinor: true
	});

	const all = readWikiPages(doc);
	strictEqual(all.length, 2);

	// Test backlinks
	// Add an item that points to [[wiki:start]]
	const items = doc.getArray<Y.Map<unknown>>('items');
	const itemMap = new Y.Map<unknown>();
	itemMap.set('id', 'item1');
	itemMap.set('name', 'Check the [[wiki:start]] doc');
	itemMap.set('listId', 'list1');
	itemMap.set('isNote', false);
	items.push([itemMap]);

	const backlinks = findWikiBacklinks(doc, 'start');
	strictEqual(backlinks.wikiPages.length, 1);
	strictEqual(backlinks.wikiPages[0].id, 'tasks');
	strictEqual(backlinks.items.length, 1);
	strictEqual(backlinks.items[0].id, 'item1');

	// Delete page
	const deleted = deleteWikiPage(doc, 'tasks');
	strictEqual(deleted, true);
	strictEqual(readWikiPages(doc).length, 1);
});

test('wiki hash formats parse consistently', () => {
	function parseWikiHash(hash: string): string | null {
		const clean = hash.startsWith('#') ? hash.slice(1) : hash;
		if (clean.startsWith('wiki:')) return decodeURIComponent(clean.slice(5));
		if (clean.startsWith('wiki/')) return decodeURIComponent(clean.slice(5));
		if (clean.startsWith('wiki=')) return decodeURIComponent(clean.slice(5));
		if (clean.startsWith('w/')) return decodeURIComponent(clean.slice(2));
		if (clean.startsWith('w:')) return decodeURIComponent(clean.slice(2));
		return null;
	}

	strictEqual(parseWikiHash('#wiki:start'), 'start');
	strictEqual(parseWikiHash('#wiki:recipes:pasta_sauce'), 'recipes:pasta_sauce');
	strictEqual(parseWikiHash('#wiki/recipes:pasta_sauce'), 'recipes:pasta_sauce');
	strictEqual(parseWikiHash('#wiki=item:abc-123'), 'item:abc-123');
	strictEqual(parseWikiHash('#w/list:456'), 'list:456');
	strictEqual(parseWikiHash('#w:start'), 'start');
	strictEqual(parseWikiHash('#l/123'), null);
	strictEqual(parseWikiHash('#f/abc'), null);
	strictEqual(parseWikiHash('#nearby'), null);
	strictEqual(parseWikiHash(''), null);
});
