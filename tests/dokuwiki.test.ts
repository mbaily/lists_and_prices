import { test } from 'node:test';
import { strictEqual, deepStrictEqual } from 'node:assert';
import { renderDokuWiki, extractWikiLinks, slugifyWikiPage } from '../src/lib/wiki/dokuwiki';

test('slugifyWikiPage normalizes names to lower-case slugs', () => {
	strictEqual(slugifyWikiPage('Main Page'), 'main_page');
	strictEqual(slugifyWikiPage('  Special / Section:Subpage  '), 'special_section:subpage');
	strictEqual(slugifyWikiPage(''), 'start');
});

test('extractWikiLinks finds wiki, item, list, folder and external links', () => {
	const markup = `
====== Welcome ======
Check [[start]] or [[projects:2026|Our Projects]].
Also check item [[item:12345|Buy Milk]] and list [[list:67890]] and folder [[folder:abcde]].
External site: [[https://example.com|Example Website]].
	`;
	const links = extractWikiLinks(markup);
	strictEqual(links.length, 6);
	deepStrictEqual(links[0], { raw: '[[start]]', type: 'wiki', target: 'start', label: undefined });
	deepStrictEqual(links[1], { raw: '[[projects:2026|Our Projects]]', type: 'wiki', target: 'projects:2026', label: 'Our Projects' });
	deepStrictEqual(links[2], { raw: '[[item:12345|Buy Milk]]', type: 'item', target: '12345', label: 'Buy Milk' });
	deepStrictEqual(links[3], { raw: '[[list:67890]]', type: 'list', target: '67890', label: undefined });
	deepStrictEqual(links[4], { raw: '[[folder:abcde]]', type: 'folder', target: 'abcde', label: undefined });
	deepStrictEqual(links[5], { raw: '[[https://example.com|Example Website]]', type: 'external', target: 'https://example.com', label: 'Example Website' });
});

test('renderDokuWiki renders headings h1 through h5', () => {
	const markup = `
====== Heading 1 ======
===== Heading 2 =====
==== Heading 3 ====
=== Heading 4 ===
== Heading 5 ==
	`;
	const html = renderDokuWiki(markup);
	strictEqual(html.includes('<h1 class="wiki-heading">Heading 1</h1>'), true);
	strictEqual(html.includes('<h2 class="wiki-heading">Heading 2</h2>'), true);
	strictEqual(html.includes('<h3 class="wiki-heading">Heading 3</h3>'), true);
	strictEqual(html.includes('<h4 class="wiki-heading">Heading 4</h4>'), true);
	strictEqual(html.includes('<h5 class="wiki-heading">Heading 5</h5>'), true);
});

test('renderDokuWiki renders inline formatting and escapes HTML', () => {
	const markup = `This is **bold**, //italic//, __underlined__, ''monospace'', <del>deleted</del>, <sub>sub</sub>, <sup>sup</sup>. <script>alert(1)</script>`;
	const html = renderDokuWiki(markup);
	strictEqual(html.includes('<strong>bold</strong>'), true);
	strictEqual(html.includes('<em>italic</em>'), true);
	strictEqual(html.includes('<u>underlined</u>'), true);
	strictEqual(html.includes('<code class="wiki-inline-code">monospace</code>'), true);
	strictEqual(html.includes('<del>deleted</del>'), true);
	strictEqual(html.includes('<sub>sub</sub>'), true);
	strictEqual(html.includes('<sup>sup</sup>'), true);
	strictEqual(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), true);
	strictEqual(html.includes('<script>'), false);
});

test('renderDokuWiki renders code blocks without interpreting markup inside', () => {
	const markup = `
<code>
function test() {
    return **not bold** <tag>;
}
</code>
	`;
	const html = renderDokuWiki(markup);
	strictEqual(html.includes('<pre class="wiki-code-block"><code>'), true);
	strictEqual(html.includes('return **not bold** &lt;tag&gt;;'), true);
	strictEqual(html.includes('<strong>'), false);
});

test('renderDokuWiki renders unordered and ordered lists', () => {
	const markup = `
  * First bullet
  * Second bullet
    * Sub bullet
  - First number
  - Second number
	`;
	const html = renderDokuWiki(markup);
	strictEqual(html.includes('<ul class="wiki-list">'), true);
	strictEqual(html.includes('<li>First bullet'), true);
	strictEqual(html.includes('<ol class="wiki-list">'), true);
	strictEqual(html.includes('<li>First number'), true);
});

test('renderDokuWiki renders tables with headers and data rows', () => {
	const markup = `
^ Name ^ Age ^ Role ^
| Alice | 30 | Engineer |
| Bob | 25 | Designer |
	`;
	const html = renderDokuWiki(markup);
	strictEqual(html.includes('<table class="wiki-table">'), true);
	strictEqual(html.includes('<thead><tr><th>Name</th><th>Age</th><th>Role</th></tr></thead>'), true);
	strictEqual(html.includes('<td>Alice</td><td>30</td><td>Engineer</td>'), true);
	strictEqual(html.includes('<td>Bob</td><td>25</td><td>Designer</td>'), true);
});

test('renderDokuWiki handles links with custom labels and missing pages', () => {
	const markup = `See [[my_page|Documentation]] and [[todo_list]] and [[item:123|My Task]].`;
	const html = renderDokuWiki(markup, {
		pageExists: (slug) => slug === 'my_page',
		resolveRefName: (type, id) => (id === '123' ? 'Resolved Task Name' : undefined)
	});
	strictEqual(html.includes('data-wiki-page="my_page"'), true);
	strictEqual(html.includes('Documentation'), true);
	strictEqual(html.includes('wiki-link-missing'), true); // for todo_list
	strictEqual(html.includes('data-ref-type="item" data-ref-id="123"'), true);
	strictEqual(html.includes('My Task'), true);
});

test('renderDokuWiki and extractWikiLinks resolve relative namespace links', () => {
	const markup = `Check [[.:specs|Specifications]], [[..:overview]], and [[:start]].`;
	const currentSlug = 'work:projects:client_a:notes';
	const links = extractWikiLinks(markup, currentSlug);
	strictEqual(links[0].target, 'work:projects:client_a:specs');
	strictEqual(links[1].target, 'work:projects:overview');
	strictEqual(links[2].target, 'start');

	const html = renderDokuWiki(markup, { currentSlug });
	strictEqual(html.includes('data-wiki-page="work:projects:client_a:specs"'), true);
	strictEqual(html.includes('data-wiki-page="work:projects:overview"'), true);
	strictEqual(html.includes('data-wiki-page="start"'), true);
});

