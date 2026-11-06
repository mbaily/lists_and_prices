import { test } from 'node:test';
import { strictEqual, deepStrictEqual } from 'node:assert';
import {
	renderDokuWiki,
	extractWikiLinks,
	slugifyWikiPage,
	toggleWikiTask,
	extractWikiHeadings,
	getWikiSection,
	replaceWikiSection,
	INTERWIKI_MAP
} from '../src/lib/wiki/dokuwiki';

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
	strictEqual(html.includes('<li>First bullet</li><li>Second bullet'), true);
	strictEqual(html.split('<ul class="wiki-list">').length - 1, 2);
	strictEqual(html.split('<ol class="wiki-list">').length - 1, 1);
	strictEqual(html.includes('<li>First number</li><li>Second number</li>'), true);
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

test('renderDokuWiki renders task lists with open, checked and cancelled checkboxes', () => {
	const markup = `
  [ ] Buy groceries
  [x] Cook dinner
  [X] Wash dishes
  [c] Cancelled errand
  [C] Another cancelled
    [ ] Nested task
	`;
	const html = renderDokuWiki(markup);
	strictEqual(html.includes('<ul class="wiki-list wiki-task-list">'), true);
	strictEqual(html.includes('class="wiki-task-item wiki-task-open" data-line="1"'), true);
	strictEqual(html.includes('class="wiki-checkbox" data-line="1" data-state="open" aria-label="Task item" />'), true);
	strictEqual(html.includes('<span class="wiki-task-text">Buy groceries</span>'), true);

	// Checked [x] and [X]
	strictEqual(html.includes('class="wiki-task-item wiki-task-checked" data-line="2"'), true);
	strictEqual(html.includes('class="wiki-checkbox" data-line="2" data-state="checked" checked'), true);
	strictEqual(html.includes('class="wiki-task-item wiki-task-checked" data-line="3"'), true);
	strictEqual(html.includes('class="wiki-checkbox" data-line="3" data-state="checked" checked'), true);

	// Cancelled [c] and [C]
	strictEqual(html.includes('class="wiki-task-item wiki-task-cancelled" data-line="4"'), true);
	strictEqual(html.includes('class="wiki-checkbox" data-line="4" data-state="cancelled"'), true);
	strictEqual(html.includes('class="wiki-task-item wiki-task-cancelled" data-line="5"'), true);
	strictEqual(html.includes('class="wiki-checkbox" data-line="5" data-state="cancelled"'), true);

	// Nested task
	strictEqual(html.includes('class="wiki-task-item wiki-task-open" data-line="6"'), true);
	strictEqual(html.includes('<span class="wiki-task-text">Nested task</span>'), true);
});

test('renderDokuWiki respects disableCheckboxes option', () => {
	const markup = `  [ ] Task 1\n  [x] Task 2`;
	const html = renderDokuWiki(markup, { disableCheckboxes: true });
	strictEqual(html.includes('disabled'), true);
});

test('toggleWikiTask toggles task states accurately', () => {
	const text = [
		'====== Tasks ======',
		'  [ ] Task 1',
		'  [x] Task 2',
		'  [X] Task 3',
		'  [c] Task 4',
		'  [C] Task 5',
		'  * [ ] Task 6 with bullet',
		'    [ ] Nested task'
	].join('\n');

	// [ ] -> [x]
	strictEqual(toggleWikiTask(text, 1, false), text.replace('  [ ] Task 1', '  [x] Task 1'));
	// [x] -> [ ]
	strictEqual(toggleWikiTask(text, 2, false), text.replace('  [x] Task 2', '  [ ] Task 2'));
	// [X] -> [ ]
	strictEqual(toggleWikiTask(text, 3, false), text.replace('  [X] Task 3', '  [ ] Task 3'));
	// [c] -> [ ]
	strictEqual(toggleWikiTask(text, 4, false), text.replace('  [c] Task 4', '  [ ] Task 4'));
	// [C] -> [ ]
	strictEqual(toggleWikiTask(text, 5, false), text.replace('  [C] Task 5', '  [ ] Task 5'));
	// * [ ] -> * [x]
	strictEqual(toggleWikiTask(text, 6, false), text.replace('  * [ ] Task 6', '  * [x] Task 6'));
	// Nested task
	strictEqual(toggleWikiTask(text, 7, false), text.replace('    [ ] Nested task', '    [x] Nested task'));

	// Shift-click tests:
	// [ ] -> [c]
	strictEqual(toggleWikiTask(text, 1, true), text.replace('  [ ] Task 1', '  [c] Task 1'));
	// [x] -> [c]
	strictEqual(toggleWikiTask(text, 2, true), text.replace('  [x] Task 2', '  [c] Task 2'));
	// [c] -> [ ]
	strictEqual(toggleWikiTask(text, 4, true), text.replace('  [c] Task 4', '  [ ] Task 4'));
	// [C] -> [ ]
	strictEqual(toggleWikiTask(text, 5, true), text.replace('  [C] Task 5', '  [ ] Task 5'));

	// Non-task line returns null
	strictEqual(toggleWikiTask(text, 0, false), null);
	// Out of bounds index returns null
	strictEqual(toggleWikiTask(text, 99, false), null);
	strictEqual(toggleWikiTask(text, -1, false), null);
});

test('renderDokuWiki renders indented text without a bullet as normal unindented paragraph', () => {
	const markup = `
  This is indented with two spaces.
    This line is indented with four spaces.
	`;
	const html = renderDokuWiki(markup);
	strictEqual(html.includes('<p>This is indented with two spaces. This line is indented with four spaces.</p>'), true);
	// Leading spaces should not be preserved inside paragraph
	strictEqual(html.includes('<p> '), false);
	strictEqual(html.includes('<p>  '), false);
});

test('renderDokuWiki performs auto-typographical replacements while protecting code and URLs', () => {
	const markup = `
Arrows: -> and <- and <-> and => and <=>
Quotes and symbols: <<quote>> (c) (C) (r) (R) (tm) (TM)
Dashes and dots: en--dash and em---dash and dots...
Dimensions: screen resolution is 1920x1080 and photo is 640 x 480
Code protected: ''monospace -> not arrow and 640x480''
URL protected: https://example.com/path--with-dashes/640x480
	`;
	const html = renderDokuWiki(markup);

	// Prose typography applied
	strictEqual(html.includes('→ and ← and ↔ and ⇒ and ⇔'), true);
	strictEqual(html.includes('«quote» © © ® ® ™ ™'), true);
	strictEqual(html.includes('en–dash and em—dash and dots…'), true);
	strictEqual(html.includes('1920×1080 and photo is 640×480'), true);

	// Code protected
	strictEqual(html.includes('<code class="wiki-inline-code">monospace -&gt; not arrow and 640x480</code>'), true);

	// URL protected
	strictEqual(html.includes('href="https://example.com/path--with-dashes/640x480"'), true);
});

test('extractWikiLinks and renderDokuWiki handle interwiki links', () => {
	const markup = `
Check [[wp>Svelte (programming language)|Wikipedia Svelte]] and [[gh>sveltejs/svelte]]
Also [[doku>syntax]] and [[google>test query]].
	`;
	const links = extractWikiLinks(markup);
	strictEqual(links.length, 4);
	strictEqual(links[0].type, 'interwiki');
	strictEqual(links[0].target, 'https://en.wikipedia.org/wiki/Svelte%20(programming%20language)');
	strictEqual(links[0].label, 'Wikipedia Svelte');

	strictEqual(links[1].type, 'interwiki');
	strictEqual(links[1].target, 'https://github.com/sveltejs/svelte');

	const html = renderDokuWiki(markup);
	strictEqual(html.includes('href="https://en.wikipedia.org/wiki/Svelte%20(programming%20language)"'), true);
	strictEqual(html.includes('class="wiki-external-link wiki-interwiki-link"'), true);
	strictEqual(html.includes('>Wikipedia Svelte</a>'), true);
	strictEqual(html.includes('href="https://github.com/sveltejs/svelte"'), true);
	strictEqual(html.includes('href="https://www.dokuwiki.org/syntax"'), true);
	strictEqual(html.includes('href="https://www.google.com/search?q=test%20query"'), true);
});

test('renderDokuWiki renders footnotes and footnote section with backlinks', () => {
	const markup = `
This is a sentence((First footnote with **bold** text)).
Another sentence((Second footnote with [[https://example.com|link]])).
	`;
	const html = renderDokuWiki(markup);

	// Inline footnote markers
	strictEqual(html.includes('<sup class="wiki-fn-ref"><a href="#fn__1" id="fnt__1" class="wiki-fn-link">[1]</a></sup>'), true);
	strictEqual(html.includes('<sup class="wiki-fn-ref"><a href="#fn__2" id="fnt__2" class="wiki-fn-link">[2]</a></sup>'), true);

	// Footnotes section at bottom
	strictEqual(html.includes('<aside class="wiki-footnotes" aria-label="Footnotes">'), true);
	strictEqual(html.includes('<li id="fn__1">First footnote with <strong>bold</strong> text <a href="#fnt__1" class="wiki-fn-backref" title="Back to text" aria-label="Back to reference">↩</a></li>'), true);
	strictEqual(html.includes('<li id="fn__2">Second footnote with <a href="https://example.com" class="wiki-external-link" target="_blank" rel="noopener noreferrer">link</a> <a href="#fnt__2" class="wiki-fn-backref" title="Back to text" aria-label="Back to reference">↩</a></li>'), true);
});

test('renderDokuWiki renders advanced tables with colspan, rowspan and text alignment', () => {
	const markup = `
^ Heading 1 ^ Heading 2 ^ Heading 3 ^
|  Right aligned |  Centered  | Left aligned  |
| Colspan 2 cols || Normal col |
| Rowspan 2 rows | Col B | Col C |
| ::: | Col B2 | Col C2 |
	`;
	const html = renderDokuWiki(markup);

	// Table structure
	strictEqual(html.includes('<table class="wiki-table"><thead><tr><th>Heading 1</th><th>Heading 2</th><th>Heading 3</th></tr></thead><tbody>'), true);

	// Alignment classes
	strictEqual(html.includes('<td class="wiki-align-right">Right aligned</td>'), true);
	strictEqual(html.includes('<td class="wiki-align-center">Centered</td>'), true);
	strictEqual(html.includes('<td class="wiki-align-left">Left aligned</td>'), true);

	// Colspan
	strictEqual(html.includes('<td colspan="2">Colspan 2 cols</td><td>Normal col</td>'), true);

	// Rowspan
	strictEqual(html.includes('<td rowspan="2">Rowspan 2 rows</td><td>Col B</td><td>Col C</td>'), true);
	// In the second row, the rowspan placeholder cell is omitted
	strictEqual(html.includes('<tr><td>Col B2</td><td>Col C2</td></tr>'), true);
});

test('renderDokuWiki generates table of contents and heading anchors when enabled', () => {
	const markup = `
====== Main Page ======
Introduction here.
===== Chapter One =====
Content 1
===== Chapter Two =====
Content 2
==== Subsection 2.1 ====
Content 2.1
	`;

	// Default render without toc option: basic headings, no TOC block
	const plainHtml = renderDokuWiki(markup);
	strictEqual(plainHtml.includes('class="wiki-toc"'), false);

	// With toc: true and headingAnchors: true
	const tocHtml = renderDokuWiki(markup, { toc: true, headingAnchors: true, sectionEdit: true });
	strictEqual(tocHtml.includes('<nav class="wiki-toc" aria-label="Table of Contents">'), true);
	strictEqual(tocHtml.includes('<a href="#main-page">Main Page</a>'), true);
	strictEqual(tocHtml.includes('<a href="#chapter-one">Chapter One</a>'), true);
	strictEqual(tocHtml.includes('<a href="#chapter-two">Chapter Two</a>'), true);
	strictEqual(tocHtml.includes('<a href="#subsection-2-1">Subsection 2.1</a>'), true);

	// Headings have anchors and section edit buttons
	strictEqual(tocHtml.includes('id="main-page"'), true);
	strictEqual(tocHtml.includes('<a href="#main-page" class="wiki-heading-anchor" title="Link to this section" aria-hidden="true">#</a>'), true);
	strictEqual(tocHtml.includes('<button type="button" class="wiki-section-edit-btn" data-section="0" title="Edit this section">[edit]</button>'), true);

	// ~~NOTOC~~ disables TOC even with 4 headings
	const noTocHtml = renderDokuWiki(`~~NOTOC~~\n` + markup, { toc: true });
	strictEqual(noTocHtml.includes('class="wiki-toc"'), false);

	// ~~TOC~~ forces TOC even with fewer than 3 headings
	const forceTocMarkup = `
~~TOC~~
====== Only One Heading ======
Text
	`;
	const forceTocHtml = renderDokuWiki(forceTocMarkup);
	strictEqual(forceTocHtml.includes('<nav class="wiki-toc" aria-label="Table of Contents">'), true);
	strictEqual(forceTocHtml.includes('<a href="#only-one-heading">Only One Heading</a>'), true);
});

test('extractWikiHeadings, getWikiSection and replaceWikiSection handle section editing', () => {
	const markup = `====== Doc Title ======
Intro paragraph.

===== Section 1 =====
Section 1 text.
==== Subsection 1.1 ====
Details 1.1.

===== Section 2 =====
Section 2 text.`;

	const headings = extractWikiHeadings(markup);
	strictEqual(headings.length, 4);
	strictEqual(headings[0].title, 'Doc Title');
	strictEqual(headings[0].level, 1);
	strictEqual(headings[1].title, 'Section 1');
	strictEqual(headings[1].level, 2);
	strictEqual(headings[2].title, 'Subsection 1.1');
	strictEqual(headings[2].level, 3);
	strictEqual(headings[3].title, 'Section 2');
	strictEqual(headings[3].level, 2);

	// Section 1 (level 2) includes its subsection (level 3) up until Section 2 (level 2)
	const sec1 = getWikiSection(markup, 1);
	strictEqual(sec1 !== null, true);
	strictEqual(sec1!.content, `===== Section 1 =====\nSection 1 text.\n==== Subsection 1.1 ====\nDetails 1.1.\n`);

	// Section 2 goes until end of doc
	const sec2 = getWikiSection(markup, 3);
	strictEqual(sec2 !== null, true);
	strictEqual(sec2!.content, `===== Section 2 =====\nSection 2 text.`);

	// Replace Section 1
	const replaced = replaceWikiSection(markup, 1, `===== Section 1 Edited =====\nUpdated text.`);
	strictEqual(replaced.includes('===== Section 1 Edited ====='), true);
	strictEqual(replaced.includes('Updated text.'), true);
	strictEqual(replaced.includes('===== Section 2 ====='), true);
	strictEqual(replaced.includes('====== Doc Title ======'), true);
	strictEqual(replaced.includes('Details 1.1.'), false); // replaced along with section 1
});




