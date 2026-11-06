import { test } from 'node:test';
import { strictEqual, deepStrictEqual } from 'node:assert';
import { searchWikiPages, tokenizeQuery, generateSnippet } from '../src/lib/wiki/search';
import type { WikiPage } from '../src/lib/wiki/data';

const samplePages: WikiPage[] = [
	{
		id: 'start',
		title: 'Main Dashboard',
		content: 'Welcome to our internal system. Here you can track tasks, manage projects and write docs.',
		createdAt: '2026-01-01T00:00:00Z',
		updatedAt: '2026-01-01T00:00:00Z',
		revisions: []
	},
	{
		id: 'projects:solar',
		title: 'Solar Panels Project',
		content: 'Detailed specifications for solar panel installations across residential roofs in Melbourne.',
		createdAt: '2026-01-02T00:00:00Z',
		updatedAt: '2026-01-02T00:00:00Z',
		revisions: []
	},
	{
		id: 'projects:wind',
		title: 'Wind Turbines Investigation',
		content: 'Wind power feasibility analysis. Includes wind speed charts and electrical inverter requirements.',
		createdAt: '2026-01-03T00:00:00Z',
		updatedAt: '2026-01-03T00:00:00Z',
		revisions: []
	},
	{
		id: 'recipes:pasta',
		title: 'Grandma Homemade Pasta',
		content: 'Ingredients: 400g semolina flour, 4 eggs, pinch of salt. Knead dough until smooth and elastic.',
		createdAt: '2026-01-04T00:00:00Z',
		updatedAt: '2026-01-04T00:00:00Z',
		revisions: []
	}
];

test('tokenizeQuery breaks string into lower-case alphanumeric terms', () => {
	const tokens = tokenizeQuery('Solar panel, "Melbourne" & roof!');
	deepStrictEqual(tokens, ['solar', 'panel', 'melbourne', 'roof']);
});

test('searchWikiPages matches by title and scores exact titles highest', () => {
	const results = searchWikiPages(samplePages, 'Solar Panels');
	strictEqual(results.length > 0, true);
	strictEqual(results[0].id, 'projects:solar');
	strictEqual(results[0].matchType, 'title');
});

test('searchWikiPages finds content words and produces highlighted snippets', () => {
	const results = searchWikiPages(samplePages, 'semolina flour');
	strictEqual(results.length, 1);
	strictEqual(results[0].id, 'recipes:pasta');
	strictEqual(results[0].snippet?.includes('<mark class="wiki-search-match">semolina</mark>'), true);
	strictEqual(results[0].snippet?.includes('<mark class="wiki-search-match">flour</mark>'), true);
});

test('searchWikiPages matches by namespace or slug prefix and scores higher than body mention', () => {
	const results = searchWikiPages(samplePages, 'projects');
	// projects:solar and projects:wind match by ID namespace, start matches by body word
	strictEqual(results.length, 3);
	strictEqual(results[0].id.startsWith('projects:'), true);
	strictEqual(results[1].id.startsWith('projects:'), true);
	strictEqual(results[2].id, 'start');
});

test('generateSnippet strips wiki syntax and highlights query keywords', () => {
	const content = `====== Introduction ======
In this chapter, we discuss **advanced thermodynamics** and the laws of heat transfer.
<code>
let x = 10;
</code>`;
	const snippet = generateSnippet(content, ['thermodynamics']);
	strictEqual(snippet !== undefined, true);
	strictEqual(snippet!.includes('<mark class="wiki-search-match">thermodynamics</mark>'), true);
	strictEqual(snippet!.includes('======'), false);
	strictEqual(snippet!.includes('**'), false);
});
