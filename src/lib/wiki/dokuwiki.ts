/**
 * DokuWiki markup parser and renderer for the Mini Wiki.
 * Supports:
 * - Headings: ====== H1 ===== down to == H5 ==
 * - Text styles: **bold**, //italic//, __underline__, ''monospace'', <del>strike</del>, <sub>sub</sub>, <sup>sup</sup>
 * - Lists: Unordered ('  * ') and Ordered ('  - ') with nesting based on 2-space increments
 * - Advanced Tables: ^ Header ^ and | Cell |, colspan (||), rowspan (:::), and cell alignments
 * - Blockquotes: > quote
 * - Horizontal rule: ----
 * - Line breaks: \\\\
 * - Code & file blocks: <code>...</code>, <file>...</file>
 * - Internal links: [[page_slug]] or [[page_slug|Title]]
 * - App entity links: [[item:id]], [[list:id]], [[folder:id]], [[wiki:slug]]
 * - Interwiki links: [[wp>Page]], [[doku>syntax]], [[google>query]], [[github>repo]], etc.
 * - External links: [[url|Title]] and bare URLs
 * - Footnotes: ((footnote text))
 * - Auto-typographical replacements: ->, <-, <->, =>, <=>, (c), (tm), (r), 640x480, ---, --, ...
 * - Table of Contents (TOC) & Section Editing helpers
 */

import { cleanNamespaceSlug, resolveNamespaceLink } from './namespaces';

export interface WikiLinkRef {
	raw: string;
	type: 'wiki' | 'item' | 'list' | 'folder' | 'external' | 'interwiki';
	target: string;
	label?: string;
}

export interface RenderOptions {
	currentSlug?: string;
	resolveWikiTitle?: (slug: string) => string | undefined;
	resolveRefName?: (type: string, id: string) => string | undefined;
	pageExists?: (slug: string) => boolean;
	disableCheckboxes?: boolean;
	disableToc?: boolean;
	toc?: boolean;
	sectionEdit?: boolean;
	headingAnchors?: boolean;
}

export interface WikiHeading {
	index: number;
	title: string;
	level: number; // 1 to 5
	id: string;
	startLine: number;
	endLine: number; // exclusive
}

export const INTERWIKI_MAP: Record<string, (target: string) => string> = {
	wp: (target) => `https://en.wikipedia.org/wiki/${encodeURIComponent(target)}`,
	wikipedia: (target) => `https://en.wikipedia.org/wiki/${encodeURIComponent(target)}`,
	doku: (target) => `https://www.dokuwiki.org/${target}`,
	dokuwiki: (target) => `https://www.dokuwiki.org/${target}`,
	google: (target) => `https://www.google.com/search?q=${encodeURIComponent(target)}`,
	github: (target) => `https://github.com/${target}`,
	gh: (target) => `https://github.com/${target}`,
	arch: (target) => `https://wiki.archlinux.org/title/${encodeURIComponent(target)}`,
	osm: (target) => `https://www.openstreetmap.org/search?query=${encodeURIComponent(target)}`,
};

export function slugifyWikiPage(name: string): string {
	return cleanNamespaceSlug(name);
}

/**
 * Extract all links from DokuWiki markup.
 */
export function extractWikiLinks(
	markup: string,
	currentSlug = 'start',
	pageExists?: (slug: string) => boolean
): WikiLinkRef[] {
	const results: WikiLinkRef[] = [];
	const linkRegex = /\[\[([^\]]+)\]\]/g;
	let match: RegExpExecArray | null;

	while ((match = linkRegex.exec(markup)) !== null) {
		const rawInside = match[1].trim();
		let target = rawInside;
		let label: string | undefined;

		const pipeIdx = rawInside.indexOf('|');
		if (pipeIdx !== -1) {
			target = rawInside.slice(0, pipeIdx).trim();
			label = rawInside.slice(pipeIdx + 1).trim();
		}

		if (/^https?:\/\//i.test(target)) {
			results.push({ raw: match[0], type: 'external', target, label });
		} else if (target.startsWith('item:')) {
			results.push({ raw: match[0], type: 'item', target: target.slice(5).trim(), label });
		} else if (target.startsWith('list:')) {
			results.push({ raw: match[0], type: 'list', target: target.slice(5).trim(), label });
		} else if (target.startsWith('folder:')) {
			results.push({ raw: match[0], type: 'folder', target: target.slice(7).trim(), label });
		} else if (target.startsWith('wiki:')) {
			const resolved = resolveNamespaceLink(target.slice(5), currentSlug, pageExists);
			results.push({ raw: match[0], type: 'wiki', target: resolved, label });
		} else {
			const iwMatch = target.match(/^([a-zA-Z0-9_\-]+)\s*(?:>|:)\s*(.*)$/);
			if (iwMatch && INTERWIKI_MAP[iwMatch[1].toLowerCase()]) {
				const resolvedUrl = INTERWIKI_MAP[iwMatch[1].toLowerCase()](iwMatch[2].trim());
				results.push({ raw: match[0], type: 'interwiki', target: resolvedUrl, label });
			} else {
				const resolved = resolveNamespaceLink(target, currentSlug, pageExists);
				results.push({ raw: match[0], type: 'wiki', target: resolved, label });
			}
		}
	}

	return results;
}

/**
 * Extract all headings and their section boundaries from DokuWiki markup.
 */
export function extractWikiHeadings(markup: string): WikiHeading[] {
	if (!markup) return [];
	const lines = markup.replace(/\r\n/g, '\n').split('\n');
	const headings: WikiHeading[] = [];
	const idCounts: Record<string, number> = {};

	let inCodeBlock = false;
	const headingRegex = /^(={2,6})\s*(.+?)\s*\1$/;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].trim();
		if (/<(code|file)(?:\s+[^>]+)?>/i.test(line)) {
			inCodeBlock = true;
		}
		if (/<\/(code|file)>/i.test(line)) {
			inCodeBlock = false;
			continue;
		}
		if (inCodeBlock) continue;

		const match = line.match(headingRegex);
		if (match) {
			const level = 7 - match[1].length;
			const title = match[2].trim();
			const baseId =
				title
					.toLowerCase()
					.replace(/[^a-z0-9]+/g, '-')
					.replace(/^-|-$/g, '') || 'section';
			let id = baseId;
			if (idCounts[baseId] !== undefined) {
				idCounts[baseId]++;
				id = `${baseId}-${idCounts[baseId]}`;
			} else {
				idCounts[baseId] = 0;
			}

			headings.push({
				index: headings.length,
				title,
				level: Math.max(1, Math.min(5, level)),
				id,
				startLine: i,
				endLine: lines.length
			});
		}
	}

	// Calculate section boundaries: section extends to the next heading of equal or higher level
	for (let i = 0; i < headings.length; i++) {
		for (let j = i + 1; j < headings.length; j++) {
			if (headings[j].level <= headings[i].level) {
				headings[i].endLine = headings[j].startLine;
				break;
			}
		}
	}

	return headings;
}

/**
 * Get section content by heading index.
 */
export function getWikiSection(
	markup: string,
	headingIndex: number
): { heading: WikiHeading; content: string } | null {
	const headings = extractWikiHeadings(markup);
	if (headingIndex < 0 || headingIndex >= headings.length) return null;
	const heading = headings[headingIndex];
	const lines = markup.replace(/\r\n/g, '\n').split('\n');
	const content = lines.slice(heading.startLine, heading.endLine).join('\n');
	return { heading, content };
}

/**
 * Replace a section's content in markup by heading index.
 */
export function replaceWikiSection(
	markup: string,
	headingIndex: number,
	newSectionContent: string
): string {
	const headings = extractWikiHeadings(markup);
	if (headingIndex < 0 || headingIndex >= headings.length) return markup;
	const heading = headings[headingIndex];
	const lines = markup.replace(/\r\n/g, '\n').split('\n');
	const replacementLines = newSectionContent.replace(/\r\n/g, '\n').split('\n');
	lines.splice(heading.startLine, heading.endLine - heading.startLine, ...replacementLines);
	return lines.join('\n');
}

function escapeHtml(str: string): string {
	return str
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function escapeAttribute(str: string): string {
	return escapeHtml(str);
}

export interface WikiListItem {
	type: 'ul' | 'ol' | 'task';
	level: number;
	items: string[];
	taskState?: 'open' | 'checked' | 'cancelled';
	lineIndex?: number;
}

/**
 * Toggle task state at a specific line in DokuWiki markup.
 */
export function toggleWikiTask(content: string, lineIndex: number, shiftKey = false): string | null {
	const lines = content.replace(/\r\n/g, '\n').split('\n');
	if (lineIndex < 0 || lineIndex >= lines.length) return null;

	const line = lines[lineIndex];
	const match = line.match(/^(\s{2,}(?:\*\s+)?)\[([ xXcC])\](.*)$/);
	if (!match) return null;

	const prefix = match[1];
	const currentState = match[2];
	const rest = match[3];

	let newState: string;
	if (shiftKey) {
		newState = currentState.toLowerCase() === 'c' ? ' ' : 'c';
	} else {
		newState = currentState === ' ' ? 'x' : ' ';
	}

	lines[lineIndex] = `${prefix}[${newState}]${rest}`;
	return lines.join('\n');
}

interface RawTableCell {
	isHeader: boolean;
	rawContent: string;
}

interface TableCell {
	tag: 'th' | 'td';
	content: string;
	align?: 'left' | 'right' | 'center';
	colspan: number;
	rowspan: number;
	isRowspanPlaceholder?: boolean;
}

function parseTableRow(line: string): RawTableCell[] | null {
	const trimmed = line.trim();
	if (!/^[\^\|].*[\^\|]$/.test(trimmed)) return null;

	const cells: RawTableCell[] = [];
	let i = 0;
	while (i < trimmed.length) {
		const char = trimmed[i];
		if (char === '^' || char === '|') {
			const isHeader = char === '^';
			let j = i + 1;
			while (j < trimmed.length && trimmed[j] !== '^' && trimmed[j] !== '|') {
				j++;
			}
			if (j >= trimmed.length) break;
			const rawContent = trimmed.slice(i + 1, j);
			cells.push({ isHeader, rawContent });
			i = j;
		} else {
			i++;
		}
	}
	return cells.length > 0 ? cells : null;
}

function renderTableBlock(rawRows: RawTableCell[][], options: RenderOptions): string {
	const grid: (TableCell | null)[][] = [];
	const rows: TableCell[][] = [];

	for (let r = 0; r < rawRows.length; r++) {
		const rawRow = rawRows[r];
		const rowCells: TableCell[] = [];
		grid[r] = [];
		let c = 0;

		for (let cellIdx = 0; cellIdx < rawRow.length; cellIdx++) {
			const raw = rawRow[cellIdx];
			const trimmed = raw.rawContent.trim();

			// Advance c past any cell occupied by an earlier row's rowspan
			while (grid[r][c] !== undefined) {
				c++;
			}

			// Colspan: empty content between consecutive delimiters
			if (raw.rawContent === '' && rowCells.length > 0) {
				const prevCell = rowCells[rowCells.length - 1];
				prevCell.colspan++;
				grid[r][c] = prevCell;
				c++;
				continue;
			}

			// Rowspan: :::
			if (trimmed === ':::' && r > 0) {
				let aboveCell: TableCell | null = null;
				for (let prevR = r - 1; prevR >= 0; prevR--) {
					if (grid[prevR][c] && !grid[prevR][c]!.isRowspanPlaceholder) {
						aboveCell = grid[prevR][c];
						break;
					}
				}
				if (aboveCell) {
					aboveCell.rowspan++;
					const placeholder: TableCell = {
						tag: raw.isHeader ? 'th' : 'td',
						content: '',
						colspan: 1,
						rowspan: 1,
						isRowspanPlaceholder: true
					};
					rowCells.push(placeholder);
					grid[r][c] = placeholder;
					c++;
					continue;
				}
			}

			// Alignment from cell whitespace:
			// 2+ spaces left, 2+ spaces right -> center
			// 2+ spaces left, <=1 space right -> right
			// <=1 space left, 2+ spaces right -> left
			let align: 'left' | 'right' | 'center' | undefined;
			const leftSpaces = raw.rawContent.match(/^\s*/)?.[0].length ?? 0;
			const rightSpaces = raw.rawContent.match(/\s*$/)?.[0].length ?? 0;
			if (leftSpaces >= 2 && rightSpaces >= 2) {
				align = 'center';
			} else if (leftSpaces >= 2 && rightSpaces <= 1) {
				align = 'right';
			} else if (leftSpaces <= 1 && rightSpaces >= 2) {
				align = 'left';
			}

			const cell: TableCell = {
				tag: raw.isHeader ? 'th' : 'td',
				content: trimmed,
				align,
				colspan: 1,
				rowspan: 1
			};
			rowCells.push(cell);
			grid[r][c] = cell;
			c++;
		}
		rows.push(rowCells);
	}

	let html = '<table class="wiki-table">';
	const theadRows: string[] = [];
	const tbodyRows: string[] = [];
	let inThead = true;

	for (let r = 0; r < rows.length; r++) {
		const rowCells = rows[r];
		const allHeaders = rowCells.length > 0 && rowCells.every((c) => c.tag === 'th');

		if (inThead && allHeaders) {
			let rowHtml = '<tr>';
			for (const cell of rowCells) {
				if (cell.isRowspanPlaceholder) continue;
				const colspanAttr = cell.colspan > 1 ? ` colspan="${cell.colspan}"` : '';
				const rowspanAttr = cell.rowspan > 1 ? ` rowspan="${cell.rowspan}"` : '';
				const alignClass = cell.align ? ` class="wiki-align-${cell.align}"` : '';
				rowHtml += `<th${colspanAttr}${rowspanAttr}${alignClass}>${renderInline(cell.content, options)}</th>`;
			}
			rowHtml += '</tr>';
			theadRows.push(rowHtml);
		} else {
			inThead = false;
			let rowHtml = '<tr>';
			for (const cell of rowCells) {
				if (cell.isRowspanPlaceholder) continue;
				const tag = cell.tag;
				const colspanAttr = cell.colspan > 1 ? ` colspan="${cell.colspan}"` : '';
				const rowspanAttr = cell.rowspan > 1 ? ` rowspan="${cell.rowspan}"` : '';
				const alignClass = cell.align ? ` class="wiki-align-${cell.align}"` : '';
				rowHtml += `<${tag}${colspanAttr}${rowspanAttr}${alignClass}>${renderInline(cell.content, options)}</${tag}>`;
			}
			rowHtml += '</tr>';
			tbodyRows.push(rowHtml);
		}
	}

	if (theadRows.length > 0) {
		html += `<thead>${theadRows.join('')}</thead>`;
	}
	if (tbodyRows.length > 0) {
		html += `<tbody>${tbodyRows.join('')}</tbody>`;
	}
	html += '</table>';
	return html;
}

function renderTocHtml(headings: WikiHeading[]): string {
	if (headings.length === 0) return '';
	let html = '<nav class="wiki-toc" aria-label="Table of Contents">';
	html += '<div class="wiki-toc-header">';
	html += '<span class="wiki-toc-title">Table of Contents</span>';
	html += '<button type="button" class="wiki-toc-toggle" aria-expanded="true" title="Toggle Table of Contents">[-]</button>';
	html += '</div>';
	html += '<ul class="wiki-toc-list">';
	for (const h of headings) {
		html += `<li class="wiki-toc-item wiki-toc-level-${h.level}"><a href="#${escapeAttribute(h.id)}">${escapeHtml(h.title)}</a></li>`;
	}
	html += '</ul></nav>';
	return html;
}

/**
 * Render DokuWiki markup into sanitized HTML.
 */
export function renderDokuWiki(markup: string, options: RenderOptions = {}): string {
	if (!markup) return '';

	// Normalize CRLF to LF
	const normalizedMarkup = markup.replace(/\r\n/g, '\n');

	// Extract headings before processing
	const headings = extractWikiHeadings(normalizedMarkup);
	let headingCursor = 0;

	// Check TOC directives
	const hasNoToc = /~~NOTOC~~/i.test(normalizedMarkup);
	const hasForceToc = /~~TOC~~/i.test(normalizedMarkup);
	const shouldRenderToc = !options.disableToc && !hasNoToc && (hasForceToc || (options.toc && headings.length >= 3));

	// 1. Extract and preserve code blocks
	const codeBlocks: string[] = [];
	let text = normalizedMarkup.replace(
		/<(code|file)(?:\s+([a-zA-Z0-9_\-]+))?>([\s\S]*?)<\/\1>/gi,
		(match, tag, lang, codeContent) => {
			const idx = codeBlocks.length;
			const langAttr = lang ? ` class="language-${escapeAttribute(lang)}"` : '';
			codeBlocks.push(
				`<pre class="wiki-code-block"><code${langAttr}>${escapeHtml(codeContent.replace(/^\r?\n|\r?\n$/g, ''))}</code></pre>`
			);
			const matchLines = match.split('\n').length - 1;
			return `\x00CODE_${idx}\x00` + '\n\x00CODE_PAD\x00'.repeat(matchLines);
		}
	);

	// 2. Extract footnotes: ((footnote content))
	const footnotes: string[] = [];
	text = text.replace(/\(\(([\s\S]*?)\)\)/g, (_, fnContent) => {
		const idx = footnotes.length;
		footnotes.push(fnContent);
		return `\x00FN_${idx}\x00`;
	});

	// Split into lines
	const lines = text.split('\n');
	const outputBlocks: string[] = [];

	let currentParagraph: string[] = [];
	let currentList: WikiListItem[] = [];
	let currentTable: RawTableCell[][] = [];
	let currentQuote: string[] = [];
	let firstHeadingIndex = -1;

	function flushParagraph() {
		if (currentParagraph.length > 0) {
			const content = currentParagraph.join(' ');
			if (content.trim()) {
				outputBlocks.push(`<p>${renderInline(content.trim(), options)}</p>`);
			}
			currentParagraph = [];
		}
	}

	function flushList() {
		if (currentList.length > 0) {
			outputBlocks.push(renderListHierarchy(currentList, options));
			currentList = [];
		}
	}

	function flushTable() {
		if (currentTable.length > 0) {
			outputBlocks.push(renderTableBlock(currentTable, options));
			currentTable = [];
		}
	}

	function flushQuote() {
		if (currentQuote.length > 0) {
			const quoteContent = currentQuote.map((line) => renderInline(line, options)).join('<br />');
			outputBlocks.push(`<blockquote>${quoteContent}</blockquote>`);
			currentQuote = [];
		}
	}

	function flushAll() {
		flushParagraph();
		flushList();
		flushTable();
		flushQuote();
	}

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		// Check for code placeholder
		const codeMatch = line.trim().match(/^\x00CODE_(\d+)\x00$/);
		if (codeMatch) {
			flushAll();
			outputBlocks.push(line.trim());
			continue;
		}
		if (line.trim() === '\x00CODE_PAD\x00') {
			continue;
		}

		// TOC directives
		if (/^\s*~~NOTOC~~\s*$/i.test(line)) {
			continue;
		}
		if (/^\s*~~TOC~~\s*$/i.test(line)) {
			flushAll();
			if (shouldRenderToc) {
				outputBlocks.push('\x00TOC_PLACEHOLDER\x00');
			}
			continue;
		}

		// Horizontal rule: 4 or more hyphens
		if (/^----+\s*$/.test(line)) {
			flushAll();
			outputBlocks.push('<hr class="wiki-hr" />');
			continue;
		}

		// Headings: ====== Title ====== (h1) down to == Title == (h5)
		const headingMatch = line.trim().match(/^(={2,6})\s*(.+?)\s*\1$/);
		if (headingMatch) {
			flushAll();
			if (firstHeadingIndex === -1) {
				firstHeadingIndex = outputBlocks.length;
			}
			const level = 7 - headingMatch[1].length; // 6 -> h1, 5 -> h2, 4 -> h3, 3 -> h4, 2 -> h5
			const tag = `h${Math.max(1, Math.min(5, level))}`;
			const headingText = renderInline(headingMatch[2], options);
			const hObj = headings[headingCursor++];

			const hasFeatures = Boolean(
				options.toc ||
				options.sectionEdit ||
				options.headingAnchors ||
				hasForceToc
			);

			if (hasFeatures && hObj) {
				const anchorHtml = options.headingAnchors
					? ` <a href="#${escapeAttribute(hObj.id)}" class="wiki-heading-anchor" title="Link to this section" aria-hidden="true">#</a>`
					: '';
				const editHtml = options.sectionEdit
					? ` <button type="button" class="wiki-section-edit-btn" data-section="${hObj.index}" title="Edit this section">[edit]</button>`
					: '';
				outputBlocks.push(
					`<${tag} id="${escapeAttribute(hObj.id)}" class="wiki-heading" data-line="${i}" data-section="${hObj.index}"><span class="wiki-heading-text">${headingText}</span>${anchorHtml}${editHtml}</${tag}>`
				);
			} else {
				outputBlocks.push(`<${tag} class="wiki-heading">${headingText}</${tag}>`);
			}
			continue;
		}

		// Table rows: line starting with ^ (header) or | (data) and ending with ^ or |
		const parsedCells = parseTableRow(line);
		if (parsedCells) {
			flushParagraph();
			flushList();
			flushQuote();
			currentTable.push(parsedCells);
			continue;
		} else if (currentTable.length > 0) {
			flushTable();
		}

		// Task lists: at least two spaces followed by [ ], [x], [X], [c], [C] (or with optional * bullet)
		const taskMatch = line.match(/^(\s{2,})(?:\*\s+)?\[([ xXcC])\](?:\s+(.*))?$/);
		if (taskMatch) {
			flushParagraph();
			flushTable();
			flushQuote();

			const indentSpaces = taskMatch[1].length;
			const level = Math.floor(indentSpaces / 2);
			const stateChar = taskMatch[2].toLowerCase();
			const taskState: 'open' | 'checked' | 'cancelled' =
				stateChar === 'x' ? 'checked' : stateChar === 'c' ? 'cancelled' : 'open';
			const itemText = taskMatch[3] ?? '';

			currentList.push({ type: 'task', level, items: [itemText], taskState, lineIndex: i });
			continue;
		}

		// Lists: at least two spaces followed by * (ul) or - (ol)
		const listMatch = line.match(/^(\s{2,})([\*\-])\s+(.*)$/);
		if (listMatch) {
			flushParagraph();
			flushTable();
			flushQuote();

			const indentSpaces = listMatch[1].length;
			const level = Math.floor(indentSpaces / 2);
			const type = listMatch[2] === '*' ? 'ul' : 'ol';
			const itemText = listMatch[3];

			currentList.push({ type, level, items: [itemText] });
			continue;
		} else if (currentList.length > 0) {
			flushList();
		}

		// Blockquotes: lines starting with >
		const quoteMatch = line.match(/^>+\s*(.*)$/);
		if (quoteMatch) {
			flushParagraph();
			flushList();
			flushTable();
			currentQuote.push(quoteMatch[1]);
			continue;
		} else if (currentQuote.length > 0) {
			flushQuote();
		}

		// Blank lines
		if (!line.trim()) {
			flushAll();
			continue;
		}

		// Normal paragraph text
		currentParagraph.push(line.trim());
	}

	flushAll();

	// TOC insertion
	if (shouldRenderToc && headings.length > 0) {
		const tocHtml = renderTocHtml(headings);
		if (hasForceToc) {
			const placeholderIdx = outputBlocks.indexOf('\x00TOC_PLACEHOLDER\x00');
			if (placeholderIdx !== -1) {
				outputBlocks[placeholderIdx] = tocHtml;
			} else {
				outputBlocks.unshift(tocHtml);
			}
		} else {
			if (firstHeadingIndex !== -1) {
				outputBlocks.splice(firstHeadingIndex, 0, tocHtml);
			} else {
				outputBlocks.unshift(tocHtml);
			}
		}
	} else {
		// Clean up any unused placeholder
		const placeholderIdx = outputBlocks.indexOf('\x00TOC_PLACEHOLDER\x00');
		if (placeholderIdx !== -1) {
			outputBlocks.splice(placeholderIdx, 1);
		}
	}

	// Footnotes section at bottom
	if (footnotes.length > 0) {
		let fnHtml = '<aside class="wiki-footnotes" aria-label="Footnotes"><div class="wiki-footnotes-title">Footnotes</div><ol>';
		for (let f = 0; f < footnotes.length; f++) {
			const fnNum = f + 1;
			const renderedContent = renderInline(footnotes[f], options);
			fnHtml += `<li id="fn__${fnNum}">${renderedContent} <a href="#fnt__${fnNum}" class="wiki-fn-backref" title="Back to text" aria-label="Back to reference">↩</a></li>`;
		}
		fnHtml += '</ol></aside>';
		outputBlocks.push(fnHtml);
	}

	let html = outputBlocks.join('\n');

	// Restore code blocks
	html = html.replace(/\x00CODE_(\d+)\x00/g, (_, idx) => {
		return codeBlocks[Number(idx)] || '';
	});

	return html;
}

/**
 * Helper to build nested list HTML from list items with indentation levels.
 */
function renderListHierarchy(items: WikiListItem[], options: RenderOptions): string {
	if (items.length === 0) return '';

	let result = '';
	const stack: { type: 'ul' | 'ol' | 'task'; tag: 'ul' | 'ol'; level: number }[] = [];

	for (const item of items) {
		const currentLevel = item.level;
		const currentType = item.type;

		// Pop deeper levels or same level with different list type
		while (
			stack.length > 0 &&
			(stack[stack.length - 1].level > currentLevel ||
				(stack[stack.length - 1].level === currentLevel && stack[stack.length - 1].type !== currentType))
		) {
			const popped = stack.pop()!;
			result += `</li></${popped.tag}>`;
		}

		if (stack.length === 0 || stack[stack.length - 1].level < currentLevel) {
			const tag = currentType === 'ol' ? 'ol' : 'ul';
			const cls = currentType === 'task' ? 'wiki-list wiki-task-list' : 'wiki-list';
			result += `<${tag} class="${cls}">`;
			stack.push({ type: currentType, tag, level: currentLevel });
		} else {
			result += '</li>';
		}

		if (item.type === 'task') {
			const checked = item.taskState === 'checked' ? ' checked' : '';
			const disabled = options.disableCheckboxes ? ' disabled' : '';
			const stateClass = item.taskState ? ` wiki-task-${item.taskState}` : '';
			result += `<li class="wiki-task-item${stateClass}" data-line="${item.lineIndex ?? ''}">`;
			result += `<input type="checkbox" class="wiki-checkbox" data-line="${item.lineIndex ?? ''}" data-state="${item.taskState || 'open'}"${checked}${disabled} aria-label="Task item" />`;
			result += `<span class="wiki-task-text">${renderInline(item.items[0], options)}</span>`;
		} else {
			result += `<li>${renderInline(item.items[0], options)}`;
		}
	}

	while (stack.length > 0) {
		const popped = stack.pop()!;
		result += `</li></${popped.tag}>`;
	}

	return result;
}

/**
 * Render inline DokuWiki markup (bold, italic, links, typography, footnotes, etc.)
 */
function renderInline(text: string, options: RenderOptions): string {
	// First escape HTML entities
	let out = escapeHtml(text);

	// Line breaks: \\ or \\ followed by space/end of line
	out = out.replace(/\\\\(?:\s|$)/g, '<br />');

	// Preserve inline code: ''monospace''
	const monospaceBlocks: string[] = [];
	out = out.replace(/&#39;&#39;(.*?)&#39;&#39;|''((?:(?!\x00).)*?)''/g, (_, m1, m2) => {
		const codeText = m1 !== undefined ? m1 : m2;
		const idx = monospaceBlocks.length;
		monospaceBlocks.push(`<code class="wiki-inline-code">${codeText}</code>`);
		return `\x00MONO_${idx}\x00`;
	});

	// Del / strikethrough: &lt;del&gt;...&lt;/del&gt;
	out = out.replace(/&lt;del&gt;(.*?)&lt;\/del&gt;/gi, '<del>$1</del>');

	// Subscript & Superscript
	out = out.replace(/&lt;sub&gt;(.*?)&lt;\/sub&gt;/gi, '<sub>$1</sub>');
	out = out.replace(/&lt;sup&gt;(.*?)&lt;\/sup&gt;/gi, '<sup>$1</sup>');

	// Links: [[target|label]] or [[target]]
	const linkBlocks: string[] = [];
	out = out.replace(/\[\[([^\]]+)\]\]/g, (_, inner) => {
		const pipeIdx = inner.indexOf('|');
		let target = inner;
		let label: string | undefined;

		if (pipeIdx !== -1) {
			target = inner.slice(0, pipeIdx).trim();
			label = inner.slice(pipeIdx + 1).trim();
		} else {
			target = inner.trim();
		}

		const rendered = renderLink(target, label, options);
		const idx = linkBlocks.length;
		linkBlocks.push(rendered);
		return `\x00LINK_${idx}\x00`;
	});

	// Bare URLs: https://... or http://...
	const urlBlocks: string[] = [];
	out = out.replace(/(?<!["'=])\b(https?:\/\/[^\s<]+)(?<![.,!?;:'")])/gi, (match) => {
		const idx = urlBlocks.length;
		urlBlocks.push(
			`<a href="${match}" class="wiki-external-link" target="_blank" rel="noopener noreferrer">${match}</a>`
		);
		return `\x00URL_${idx}\x00`;
	});

	// Auto-typographical replacements (on regular prose, protected from URLs/links/code)
	out = out.replace(/&lt;-&gt;/g, '↔');
	out = out.replace(/&lt;=&gt;/g, '⇔');
	out = out.replace(/-&gt;/g, '→');
	out = out.replace(/&lt;-/g, '←');
	out = out.replace(/=&gt;/g, '⇒');
	out = out.replace(/&lt;&lt;/g, '«');
	out = out.replace(/&gt;&gt;/g, '»');
	out = out.replace(/\([cC]\)/g, '©');
	out = out.replace(/\([rR]\)/g, '®');
	out = out.replace(/\([tT][mM]\)/g, '™');
	out = out.replace(/---/g, '—');
	out = out.replace(/--/g, '–');
	out = out.replace(/\.\.\./g, '…');
	out = out.replace(/\b(\d+)\s*[xX]\s*(\d+)\b/g, '$1×$2');

	// Bold: **bold**
	out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

	// Underline: __underline__
	out = out.replace(/__([^_]+)__/g, '<u>$1</u>');

	// Italic: //italic//
	out = out.replace(/(?<!https?:)\/\/([^\/]+)\/\//g, '<em>$1</em>');

	// Footnotes placeholder replacement
	out = out.replace(/\x00FN_(\d+)\x00/g, (_, idx) => {
		const num = Number(idx) + 1;
		return `<sup class="wiki-fn-ref"><a href="#fn__${num}" id="fnt__${num}" class="wiki-fn-link">[${num}]</a></sup>`;
	});

	// Restore URLs
	out = out.replace(/\x00URL_(\d+)\x00/g, (_, idx) => {
		return urlBlocks[Number(idx)] || '';
	});

	// Restore Links
	out = out.replace(/\x00LINK_(\d+)\x00/g, (_, idx) => {
		return linkBlocks[Number(idx)] || '';
	});

	// Restore monospace blocks
	out = out.replace(/\x00MONO_(\d+)\x00/g, (_, idx) => {
		return monospaceBlocks[Number(idx)] || '';
	});

	return out;
}

function renderLink(target: string, label: string | undefined, options: RenderOptions): string {
	// If custom label is present, apply typographical formatting
	let renderedLabel = label;
	if (renderedLabel) {
		renderedLabel = renderedLabel
			.replace(/&lt;-&gt;|<->/g, '↔')
			.replace(/&lt;=&gt;|<=>/g, '⇔')
			.replace(/-&gt;|->/g, '→')
			.replace(/&lt;-|<-/g, '←')
			.replace(/=&gt;|=>/g, '⇒')
			.replace(/\([cC]\)/g, '©')
			.replace(/\([rR]\)/g, '®')
			.replace(/\([tT][mM]\)/g, '™')
			.replace(/---/g, '—')
			.replace(/--/g, '–')
			.replace(/\.\.\./g, '…');
	}

	// External link
	if (/^https?:\/\//i.test(target)) {
		const display = renderedLabel || target;
		return `<a href="${escapeAttribute(target)}" class="wiki-external-link" target="_blank" rel="noopener noreferrer">${display}</a>`;
	}

	// Interwiki link: prefix>target or prefix:target
	const iwMatch = target.match(/^([a-zA-Z0-9_\-]+)\s*(?:>|&gt;|:)\s*(.*)$/);
	if (iwMatch) {
		const prefix = iwMatch[1].toLowerCase();
		const resolver = INTERWIKI_MAP[prefix];
		if (resolver) {
			const resolvedUrl = resolver(iwMatch[2].trim());
			const display = renderedLabel || target.replace(/&gt;/g, '>');
			return `<a href="${escapeAttribute(resolvedUrl)}" class="wiki-external-link wiki-interwiki-link" target="_blank" rel="noopener noreferrer">${display}</a>`;
		}
	}

	// Entity link: item:UUID
	if (target.startsWith('item:')) {
		const id = target.slice(5).trim();
		const resolved = options.resolveRefName ? options.resolveRefName('item-ref', id) : undefined;
		const display = renderedLabel || resolved || `Todo: ${id.slice(0, 8)}…`;
		return `<a href="#item:${encodeURIComponent(id)}" class="wiki-link wiki-ref-link wiki-ref-item" data-ref-type="item" data-ref-id="${escapeAttribute(id)}"><span class="wiki-ref-icon">☑️</span> ${display}</a>`;
	}

	// Entity link: list:UUID
	if (target.startsWith('list:')) {
		const id = target.slice(5).trim();
		const resolved = options.resolveRefName ? options.resolveRefName('list-ref', id) : undefined;
		const display = renderedLabel || resolved || `List: ${id.slice(0, 8)}…`;
		return `<a href="#l/${encodeURIComponent(id)}" class="wiki-link wiki-ref-link wiki-ref-list" data-ref-type="list" data-ref-id="${escapeAttribute(id)}"><span class="wiki-ref-icon">📋</span> ${display}</a>`;
	}

	// Entity link: folder:UUID
	if (target.startsWith('folder:')) {
		const id = target.slice(7).trim();
		const resolved = options.resolveRefName ? options.resolveRefName('folder-ref', id) : undefined;
		const display = renderedLabel || resolved || `Folder: ${id.slice(0, 8)}…`;
		return `<a href="#f/${encodeURIComponent(id)}" class="wiki-link wiki-ref-link wiki-ref-folder" data-ref-type="folder" data-ref-id="${escapeAttribute(id)}"><span class="wiki-ref-icon">📁</span> ${display}</a>`;
	}

	// Wiki link (explicit wiki: or ordinary page target)
	let pageTarget = target;
	if (pageTarget.startsWith('wiki:')) {
		pageTarget = pageTarget.slice(5).trim();
	}
	const normalizedSlug = resolveNamespaceLink(pageTarget, options.currentSlug || 'start', options.pageExists);
	const resolvedTitle = options.resolveWikiTitle ? options.resolveWikiTitle(normalizedSlug) : undefined;
	const display = renderedLabel || resolvedTitle || pageTarget;
	const exists = options.pageExists ? options.pageExists(normalizedSlug) : true;
	const missingClass = exists ? '' : ' wiki-link-missing';

	return `<a href="#wiki:${encodeURI(normalizedSlug)}" class="wiki-link${missingClass}" data-wiki-page="${escapeAttribute(normalizedSlug)}" title="Wiki: ${escapeAttribute(display)}"><span class="wiki-ref-icon">📖</span> ${display}</a>`;
}
