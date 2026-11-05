/**
 * DokuWiki markup parser and renderer for the Mini Wiki.
 * Supports:
 * - Headings: ====== H1 ===== down to == H5 ==
 * - Text styles: **bold**, //italic//, __underline__, ''monospace'', <del>strike</del>, <sub>sub</sub>, <sup>sup</sup>
 * - Lists: Unordered ('  * ') and Ordered ('  - ') with nesting based on 2-space increments
 * - Tables: ^ Header ^ and | Cell |
 * - Blockquotes: > quote
 * - Horizontal rule: ----
 * - Line breaks: \\\\
 * - Code & file blocks: <code>...</code>, <file>...</file>
 * - Internal links: [[page_slug]] or [[page_slug|Title]]
 * - App entity links: [[item:id]], [[list:id]], [[folder:id]], [[wiki:slug]]
 * - External links: [[url|Title]] and bare URLs
 */

import { cleanNamespaceSlug, resolveNamespaceLink } from './namespaces';

export interface WikiLinkRef {
	raw: string;
	type: 'wiki' | 'item' | 'list' | 'folder' | 'external';
	target: string;
	label?: string;
}

export interface RenderOptions {
	currentSlug?: string;
	resolveWikiTitle?: (slug: string) => string | undefined;
	resolveRefName?: (type: string, id: string) => string | undefined;
	pageExists?: (slug: string) => boolean;
	disableCheckboxes?: boolean;
}

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
			const resolved = resolveNamespaceLink(target, currentSlug, pageExists);
			results.push({ raw: match[0], type: 'wiki', target: resolved, label });
		}
	}

	return results;
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
 * - Normal click: [ ] -> [x], [x]/[X] -> [ ], [c]/[C] -> [ ]
 * - Shift click: [ ]/[x]/[X] -> [c], [c]/[C] -> [ ]
 * Returns the modified markup, or null if lineIndex was invalid or not a task line.
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

/**
 * Render DokuWiki markup into sanitized HTML.
 */
export function renderDokuWiki(markup: string, options: RenderOptions = {}): string {
	if (!markup) return '';

	// Normalize CRLF to LF
	const normalizedMarkup = markup.replace(/\r\n/g, '\n');

	// 1. Extract and preserve code blocks
	const codeBlocks: string[] = [];
	let text = normalizedMarkup.replace(/<(code|file)(?:\s+([a-zA-Z0-9_\-]+))?>([\s\S]*?)<\/\1>/gi, (match, tag, lang, codeContent) => {
		const idx = codeBlocks.length;
		const langAttr = lang ? ` class="language-${escapeAttribute(lang)}"` : '';
		codeBlocks.push(`<pre class="wiki-code-block"><code${langAttr}>${escapeHtml(codeContent.replace(/^\r?\n|\r?\n$/g, ''))}</code></pre>`);
		const matchLines = match.split('\n').length - 1;
		return `\x00CODE_${idx}\x00` + '\n\x00CODE_PAD\x00'.repeat(matchLines);
	});

	// Split into lines
	const lines = text.split('\n');
	const outputBlocks: string[] = [];

	let currentParagraph: string[] = [];
	let currentList: WikiListItem[] = [];
	let currentTable: { isHeader: boolean; cells: string[] }[] = [];
	let currentQuote: string[] = [];

	function flushParagraph() {
		if (currentParagraph.length > 0) {
			const content = currentParagraph.join(' ');
			if (content.trim()) {
				outputBlocks.push(`<p>${renderInline(content, options)}</p>`);
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
			let html = '<table class="wiki-table">';
			let hasThead = false;
			let tbodyOpen = false;

			for (const row of currentTable) {
				if (row.isHeader) {
					if (!hasThead) {
						html += '<thead><tr>';
						for (const cell of row.cells) {
							html += `<th>${renderInline(cell, options)}</th>`;
						}
						html += '</tr></thead>';
						hasThead = true;
					} else {
						// Header row within body
						if (!tbodyOpen) { html += '<tbody>'; tbodyOpen = true; }
						html += '<tr>';
						for (const cell of row.cells) {
							html += `<th>${renderInline(cell, options)}</th>`;
						}
						html += '</tr>';
					}
				} else {
					if (!tbodyOpen) { html += '<tbody>'; tbodyOpen = true; }
					html += '<tr>';
					for (const cell of row.cells) {
						html += `<td>${renderInline(cell, options)}</td>`;
					}
					html += '</tr>';
				}
			}
			if (tbodyOpen) html += '</tbody>';
			html += '</table>';
			outputBlocks.push(html);
			currentTable = [];
		}
	}

	function flushQuote() {
		if (currentQuote.length > 0) {
			const quoteContent = currentQuote.map(line => renderInline(line, options)).join('<br />');
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
			const level = 7 - headingMatch[1].length; // 6 -> h1, 5 -> h2, 4 -> h3, 3 -> h4, 2 -> h5
			const tag = `h${Math.max(1, Math.min(5, level))}`;
			const headingText = renderInline(headingMatch[2], options);
			outputBlocks.push(`<${tag} class="wiki-heading">${headingText}</${tag}>`);
			continue;
		}

		// Table rows: line starting with ^ (header) or | (data) and ending with ^ or |
		const tableMatch = line.trim().match(/^([\^\|])(.*)([\^\|])$/);
		if (tableMatch) {
			flushParagraph();
			flushList();
			flushQuote();

			const sep = tableMatch[1];
			const isHeader = sep === '^';
			const inner = tableMatch[2];
			// Split by either ^ or |
			const rawCells = inner.split(/[\^\|]/);
			const cells = rawCells.map(c => c.trim());
			currentTable.push({ isHeader, cells });
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
		currentParagraph.push(line);
	}

	flushAll();

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
function renderListHierarchy(
	items: WikiListItem[],
	options: RenderOptions
): string {
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
 * Render inline DokuWiki markup (bold, italic, links, etc.)
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

		return renderLink(target, label, options);
	});

	// Bare URLs: https://... or http://...
	// Avoid matching URLs that are already part of attributes or tags
	out = out.replace(/(?<!["'=])\b(https?:\/\/[^\s<]+)(?<![.,!?;:'")])/gi, (match) => {
		return `<a href="${match}" class="wiki-external-link" target="_blank" rel="noopener noreferrer">${match}</a>`;
	});

	// Bold: **bold**
	out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

	// Underline: __underline__
	out = out.replace(/__([^_]+)__/g, '<u>$1</u>');

	// Italic: //italic//
	// Make sure we don't match https:// or http://
	out = out.replace(/(?<!https?:)\/\/([^\/]+)\/\//g, '<em>$1</em>');

	// Restore monospace blocks
	out = out.replace(/\x00MONO_(\d+)\x00/g, (_, idx) => {
		return monospaceBlocks[Number(idx)] || '';
	});

	return out;
}

function renderLink(target: string, label: string | undefined, options: RenderOptions): string {
	// External link
	if (/^https?:\/\//i.test(target)) {
		const display = label || target;
		return `<a href="${escapeAttribute(target)}" class="wiki-external-link" target="_blank" rel="noopener noreferrer">${display}</a>`;
	}

	// Entity link: item:UUID
	if (target.startsWith('item:')) {
		const id = target.slice(5).trim();
		const resolved = options.resolveRefName ? options.resolveRefName('item-ref', id) : undefined;
		const display = label || resolved || `Todo: ${id.slice(0, 8)}…`;
		return `<a href="#" class="wiki-link wiki-ref-link wiki-ref-item" data-ref-type="item" data-ref-id="${escapeAttribute(id)}"><span class="wiki-ref-icon">☑️</span> ${display}</a>`;
	}

	// Entity link: list:UUID
	if (target.startsWith('list:')) {
		const id = target.slice(5).trim();
		const resolved = options.resolveRefName ? options.resolveRefName('list-ref', id) : undefined;
		const display = label || resolved || `List: ${id.slice(0, 8)}…`;
		return `<a href="#" class="wiki-link wiki-ref-link wiki-ref-list" data-ref-type="list" data-ref-id="${escapeAttribute(id)}"><span class="wiki-ref-icon">📋</span> ${display}</a>`;
	}

	// Entity link: folder:UUID
	if (target.startsWith('folder:')) {
		const id = target.slice(7).trim();
		const resolved = options.resolveRefName ? options.resolveRefName('folder-ref', id) : undefined;
		const display = label || resolved || `Folder: ${id.slice(0, 8)}…`;
		return `<a href="#" class="wiki-link wiki-ref-link wiki-ref-folder" data-ref-type="folder" data-ref-id="${escapeAttribute(id)}"><span class="wiki-ref-icon">📁</span> ${display}</a>`;
	}

	// Wiki link (explicit wiki: or ordinary page target)
	let pageTarget = target;
	if (pageTarget.startsWith('wiki:')) {
		pageTarget = pageTarget.slice(5).trim();
	}
	const normalizedSlug = resolveNamespaceLink(pageTarget, options.currentSlug || 'start', options.pageExists);
	const resolvedTitle = options.resolveWikiTitle ? options.resolveWikiTitle(normalizedSlug) : undefined;
	const display = label || resolvedTitle || pageTarget;
	const exists = options.pageExists ? options.pageExists(normalizedSlug) : true;
	const missingClass = exists ? '' : ' wiki-link-missing';

	return `<a href="#" class="wiki-link${missingClass}" data-wiki-page="${escapeAttribute(normalizedSlug)}" title="Wiki: ${escapeAttribute(display)}"><span class="wiki-ref-icon">📖</span> ${display}</a>`;
}

