/**
 * DokuWiki writer: shared, dependency-free logic used by both the browser and
 * the server. Nothing here imports Yjs, so the server's CJS Yjs instance and
 * the browser's ESM instance can both pass their documents in.
 *
 * Data model (all inside the user's Yjs document, so it syncs everywhere):
 *  - `doc.getMap('dokuwikiSettings')`: base URL and the templates.
 *  - item key `dokuwiki`: written by clients. `{ date, requestedAt }`.
 *  - item key `dokuwikiStatus`: written only by the server writer.
 *  - `doc.getMap('dokuwikiEditing')`: open edits, `{ itemId, expiresAt }` per
 *    editor session. Entries containing an item being edited are not written
 *    until the edit is saved or closed (or the hold expires).
 */

export interface DokuWikiSettings {
	/** Wiki root, e.g. https://wiki.example/ (doku.php links are accepted too). */
	baseUrl: string;
	pageTemplate: string;
	headingTemplate: string;
	lineTemplate: string;
}

export const DEFAULT_DOKUWIKI_SETTINGS: DokuWikiSettings = {
	baseUrl: '',
	pageTemplate: 'chronological:{yyyy}:{mon}:todo_{yyyy}_{month}',
	headingTemplate: '===== {yyyy}-{mm}-{dd} {ddd} =====',
	lineTemplate: '  * {text} {id}'
};

export const DOKUWIKI_SETTINGS_MAP = 'dokuwikiSettings';
export const DOKUWIKI_REQUEST_KEY = 'dokuwiki';
export const DOKUWIKI_STATUS_KEY = 'dokuwikiStatus';
/** Transaction origin of server status writes; they never re-trigger the writer. */
export const DOKUWIKI_ORIGIN = 'dokuwiki-writer';
export const DOKUWIKI_EDITING_MAP = 'dokuwikiEditing';
/** Transaction origin for edit holds; kept out of the undo history. */
export const DOKUWIKI_EDITING_ORIGIN = 'dokuwiki-editing';
/** An edit hold lapses unless renewed, so a closed tab can't block writes forever. */
export const DOKUWIKI_EDITING_TTL_MS = 15 * 60_000;

export interface DokuWikiEditHold { itemId: string; expiresAt: string }

export interface DokuWikiRequest {
	/** Local date (YYYY-MM-DD) chosen when the item was marked. */
	date: string;
	/** Changes whenever the user marks or retries, so the server notices. */
	requestedAt: string;
}

export type DokuWikiState = 'written' | 'error' | 'auth';

export interface DokuWikiStatus {
	state: DokuWikiState;
	/** The request this status answers. */
	requestedAt: string;
	pageId?: string;
	/** The section's #fragment on the page when last written (e.g. "tue2"). */
	anchor?: string;
	/** Hash of the entry text last written, used to detect later edits. */
	hash?: string;
	writtenAt?: string;
	message?: string;
	/** Network-type failures are retried automatically with backoff. */
	retryable?: boolean;
	attempts?: number;
	attemptedAt?: string;
	nextRetryAt?: string;
}

/** What the item badge shows. */
export type DokuWikiBadge = 'pending' | 'written' | 'error' | 'auth';

// ── Small structural types, so callers can pass CJS or ESM Yjs objects ─────

interface MapLike { get(key: string): unknown }
interface ItemMapLike extends MapLike { }
interface DocLike {
	getMap(name: string): MapLike & { forEach?(fn: (value: unknown, key: string) => void): void; has?(key: string): boolean };
	getArray(name: string): { toArray(): ItemMapLike[] };
	getText(name: string): { toString(): string };
	share: Map<string, unknown>;
}

// ── Dates and templates ─────────────────────────────────────────────────────

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const capitalise = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

export function localDateString(date = new Date()): string {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function isDateString(value: unknown): value is string {
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const [y, m, d] = value.split('-').map(Number);
	const date = new Date(Date.UTC(y, m - 1, d));
	return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export const DATE_VARIABLES = ['yyyy', 'mm', 'm', 'dd', 'd', 'mon', 'Mon', 'month', 'Month', 'ddd', 'Ddd', 'dddd', 'Dddd'] as const;

export function dateVariables(date: string): Record<string, string> {
	if (!isDateString(date)) throw new Error(`Invalid date: ${date}`);
	const [y, m, d] = date.split('-').map(Number);
	const month = MONTHS[m - 1];
	const day = DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
	return {
		yyyy: String(y), mm: String(m).padStart(2, '0'), m: String(m), dd: String(d).padStart(2, '0'), d: String(d),
		mon: month.slice(0, 3), Mon: capitalise(month.slice(0, 3)), month, Month: capitalise(month),
		// {ddd} gives "Tue" because that is what day headings use; {Ddd} is the same.
		ddd: capitalise(day.slice(0, 3)), Ddd: capitalise(day.slice(0, 3)),
		dddd: capitalise(day), Dddd: capitalise(day)
	};
}

/** Replace `{name}` placeholders; unknown placeholders are left as written. */
export function expandTemplate(template: string, variables: Record<string, string>): string {
	return template.replace(/\{([A-Za-z]+)\}/g, (whole, name: string) => Object.hasOwn(variables, name) ? variables[name] : whole);
}

export function readDokuWikiSettings(doc: Pick<DocLike, 'getMap'>): DokuWikiSettings {
	const map = doc.getMap(DOKUWIKI_SETTINGS_MAP);
	const read = (key: keyof DokuWikiSettings) => {
		const value = map.get(key);
		return typeof value === 'string' && (key === 'baseUrl' || value.trim()) ? value : DEFAULT_DOKUWIKI_SETTINGS[key];
	};
	return { baseUrl: read('baseUrl'), pageTemplate: read('pageTemplate'), headingTemplate: read('headingTemplate'), lineTemplate: read('lineTemplate') };
}

/** Accepts `https://wiki/`, `https://wiki/doku.php?id=x#y`, or `https://wiki/sub/`. */
export function normalizeBaseUrl(value: string): string | null {
	const trimmed = value.trim();
	if (!trimmed) return null;
	let url: URL;
	try { url = new URL(trimmed); } catch { return null; }
	if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
	url.search = ''; url.hash = '';
	url.pathname = url.pathname.replace(/\/(?:doku\.php|lib\/exe\/xmlrpc\.php)(?:\/.*)?$/, '/');
	if (!url.pathname.endsWith('/')) url.pathname += '/';
	return url.href;
}

export function xmlRpcUrl(baseUrl: string): string | null {
	const base = normalizeBaseUrl(baseUrl);
	return base ? `${base}lib/exe/xmlrpc.php` : null;
}

export function pageUrl(baseUrl: string, pageId: string, anchor?: string | null): string | null {
	const base = normalizeBaseUrl(baseUrl);
	return base ? `${base}doku.php?id=${encodeURIComponent(pageId).replace(/%3A/gi, ':')}${anchor ? `#${encodeURIComponent(anchor)}` : ''}` : null;
}

export function pageIdFor(settings: DokuWikiSettings, date: string): string {
	return expandTemplate(settings.pageTemplate, dateVariables(date)).trim();
}

export function headingFor(settings: DokuWikiSettings, date: string): string {
	return expandTemplate(settings.headingTemplate, dateVariables(date)).trim();
}

// ── Hashing and markers ─────────────────────────────────────────────────────

/** FNV-1a; stable and synchronous in both runtimes. Not a security hash. */
export function fnv1a(value: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < value.length; i++) {
		hash ^= value.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(16).padStart(8, '0');
}

/** The visible id that lets an entry be found again, e.g. `#3fa9c01`. */
export function markerFor(itemId: string): string {
	return `#${fnv1a(`lists-and-prices:${itemId}`).slice(0, 7)}`;
}

// ── Building an entry ───────────────────────────────────────────────────────

export interface EntryNode { text: string; children: EntryNode[]; id?: string }

/** The ids of an entry's item and all its subnotes. */
export function entryIds(node: EntryNode): string[] {
	return [...(node.id ? [node.id] : []), ...node.children.flatMap(entryIds)];
}

const oneLine = (text: string) => text.replace(/\r\n?/g, '\n').split('\n').map((line) => line.trim()).filter(Boolean).join(' \\\\ ');

/** One item line from the template, plus nested subnote bullets. The marker is
 * always present: `{id}` places it, otherwise it is appended to the line. */
export function renderEntry(lineTemplate: string, node: EntryNode, marker: string): string {
	const template = lineTemplate.includes('{text}') ? lineTemplate : `${lineTemplate.trimEnd()} {text}`;
	const withId = template.includes('{id}') ? template : `${template.trimEnd()} {id}`;
	const first = expandTemplate(withId, { text: oneLine(node.text), id: marker }).replace(/[ \t]+$/, '');
	const indent = /^\s*/.exec(first)![0].length;
	const lines = [first];
	const walk = (children: EntryNode[], depth: number) => {
		for (const child of children) {
			const text = oneLine(child.text);
			if (text) lines.push(`${' '.repeat(indent + 2 * depth)}* ${text}`);
			walk(child.children, depth + 1);
		}
	};
	// Nested bullets are indented further than the item line itself.
	walk(node.children, 1);
	return lines.join('\n');
}

const TEXT_PREFIX = 'note_text_';

/** Same logic as noteText.readItemName, without importing Yjs. */
function readName(doc: DocLike, item: ItemMapLike): string {
	const id = item.get('id') as string;
	const initialized = doc.getMap('note-text-initialized');
	const shared = doc.share.get(TEXT_PREFIX + id) as { _start?: unknown } | undefined;
	const hasText = (initialized.has?.(id) ?? initialized.get(id) !== undefined) || (shared !== undefined && shared._start != null);
	return hasText ? doc.getText(TEXT_PREFIX + id).toString().replace(/\n$/, '') : ((item.get('name') as string) ?? '');
}

/** The item with its descendants, in display order. Cycles are cut. */
export function readEntryNode(doc: DocLike, itemId: string): EntryNode | null {
	const all = doc.getArray('items').toArray();
	const byId = new Map(all.map((item) => [item.get('id') as string, item]));
	const root = byId.get(itemId);
	if (!root) return null;
	const children = new Map<string, ItemMapLike[]>();
	for (const item of all) {
		const parent = item.get('parentId') as string | null;
		if (!parent || !byId.has(parent)) continue;
		const list = children.get(parent) ?? [];
		list.push(item);
		children.set(parent, list);
	}
	const order = (item: ItemMapLike) => (item.get('order') as number) ?? 0;
	const seen = new Set<string>();
	const build = (item: ItemMapLike): EntryNode => {
		const id = item.get('id') as string;
		seen.add(id);
		const kids = (children.get(id) ?? [])
			.filter((child) => !seen.has(child.get('id') as string))
			.sort((a, b) => order(a) - order(b) || String(a.get('id')).localeCompare(String(b.get('id'))));
		return { id, text: readName(doc, item), children: kids.map(build) };
	};
	return build(root);
}

export function readRequest(item: MapLike): DokuWikiRequest | null {
	const value = item.get(DOKUWIKI_REQUEST_KEY) as Partial<DokuWikiRequest> | null | undefined;
	if (!value || typeof value !== 'object' || !isDateString(value.date) || typeof value.requestedAt !== 'string') return null;
	return { date: value.date, requestedAt: value.requestedAt };
}

export function readStatus(item: MapLike): DokuWikiStatus | null {
	const value = item.get(DOKUWIKI_STATUS_KEY) as DokuWikiStatus | null | undefined;
	return value && typeof value === 'object' && typeof value.state === 'string' && typeof value.requestedAt === 'string' ? value : null;
}

export interface PlannedEntry {
	itemId: string;
	request: DokuWikiRequest;
	pageId: string;
	heading: string;
	marker: string;
	text: string;
	hash: string;
	/** The item and its subnotes. */
	ids: string[];
}

export function planEntry(doc: DocLike, settings: DokuWikiSettings, item: ItemMapLike): PlannedEntry | null {
	const request = readRequest(item);
	if (!request) return null;
	const itemId = item.get('id') as string;
	const node = readEntryNode(doc, itemId);
	if (!node) return null;
	const marker = markerFor(itemId);
	const text = renderEntry(settings.lineTemplate, node, marker);
	const pageId = pageIdFor(settings, request.date);
	return { itemId, request, pageId, heading: headingFor(settings, request.date), marker, text, hash: fnv1a(`${pageId}\n${text}`), ids: entryIds(node) };
}

/** Items currently open in an editor, and when the soonest hold lapses. */
export function readEditHolds(doc: Pick<DocLike, 'getMap'>, now: number): { ids: Set<string>; nextExpiry: number | null } {
	const ids = new Set<string>();
	let nextExpiry: number | null = null;
	doc.getMap(DOKUWIKI_EDITING_MAP).forEach?.((value) => {
		const hold = value as Partial<DokuWikiEditHold> | null;
		if (!hold || typeof hold.itemId !== 'string' || typeof hold.expiresAt !== 'string') return;
		const expires = Date.parse(hold.expiresAt);
		if (!(expires > now)) return;
		ids.add(hold.itemId);
		if (nextExpiry === null || expires < nextExpiry) nextExpiry = expires;
	});
	return { ids, nextExpiry };
}

/** What the badge should show for an item. Null when it is not marked. */
export function badgeFor(plan: PlannedEntry | null, status: DokuWikiStatus | null): DokuWikiBadge | null {
	if (!plan) return null;
	if (!status || status.requestedAt !== plan.request.requestedAt) return 'pending';
	if (status.state === 'written') return status.hash === plan.hash ? 'written' : 'pending';
	return status.state;
}

// ── Editing page text ───────────────────────────────────────────────────────

const HEADING = /^[ \t]*(={2,6})(.*?)\1[ \t]*$/;
const normalizeHeading = (line: string) => line.trim().replace(/\s+/g, ' ');

function headingLevel(line: string): number | null {
	const match = HEADING.exec(line);
	return match ? match[1].length : null;
}

/** Line range of a section: the heading line, and the end (exclusive) at the
 * next heading of the same or a higher level, as DokuWiki's section edit. */
export function findSection(lines: string[], heading: string): { headingLine: number; end: number } | null {
	const wanted = normalizeHeading(heading);
	const start = lines.findIndex((line) => headingLevel(line) !== null && normalizeHeading(line) === wanted);
	if (start < 0) return null;
	const level = headingLevel(lines[start])!;
	let end = start + 1;
	// More "=" means a higher-level heading in DokuWiki.
	while (end < lines.length && !((headingLevel(lines[end]) ?? 0) >= level)) end++;
	return { headingLine: start, end };
}

// ── Section anchors (the #fragment DokuWiki gives each heading) ─────────────

/** DokuWiki's cleanID() with the default settings (sepchar "_", deaccent on). */
export function cleanId(raw: string): string {
	let id = raw.trim().toLowerCase().replace(/;/g, ':').replace(/\//g, '_');
	id = id.normalize('NFKD').replace(/\p{M}+/gu, '');
	id = id.replace(/[^\p{L}\p{N}._:-]+/gu, '_');
	id = id.replace(/_+/g, '_').replace(/:+/g, ':');
	id = id.replace(/^[:._-]+|[:._-]+$/g, '');
	return id.replace(/:[:._-]+/g, ':').replace(/[:._-]+:/g, ':');
}

/** DokuWiki's sectionID(): the anchor for a heading title. `seen` holds the
 * anchors already used on the page; repeats get 1, 2, … appended. */
export function sectionId(title: string, seen?: Set<string>): string {
	const clean = cleanId(title).replace(/[:.]/g, '');
	const trimmed = clean.replace(/^[0-9_-]+/, '');
	const id = trimmed || `section${clean.replace(/[^0-9]+/g, '')}`;
	if (!seen) return id;
	let candidate = id;
	for (let suffix = 1; seen.has(candidate); suffix++) candidate = `${id}${suffix}`;
	seen.add(candidate);
	return candidate;
}

/** The fragment DokuWiki renders for this heading on this page, or null if the
 * heading isn't there. Headings inside code, file and nowiki blocks don't count. */
export function sectionAnchor(page: string, heading: string): string | null {
	const wanted = normalizeHeading(heading);
	const seen = new Set<string>();
	let block: string | null = null;
	for (const line of page.replace(/\r\n?/g, '\n').split('\n')) {
		if (block) {
			if (line.includes(`</${block}>`)) block = null;
			continue;
		}
		const open = /<(code|file|nowiki)\b[^>]*>/.exec(line);
		if (open) {
			if (!line.slice(open.index).includes(`</${open[1]}>`)) block = open[1];
			continue;
		}
		const match = HEADING.exec(line);
		if (!match) continue;
		const id = sectionId(match[2].trim(), seen);
		if (normalizeHeading(line) === wanted) return id;
	}
	return null;
}

function hasMarker(line: string, marker: string): boolean {
	const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return new RegExp(`(^|\\s)${escaped}(?=\\s|$)`).test(line);
}

/** The marked line and the nested list lines that follow it. */
function findMarkedBlock(lines: string[], marker: string): { start: number; end: number } | null {
	const start = lines.findIndex((line) => headingLevel(line) === null && hasMarker(line, marker));
	if (start < 0) return null;
	const indent = /^\s*/.exec(lines[start])![0].length;
	let end = start + 1;
	while (end < lines.length) {
		const match = /^(\s+)[*-] /.exec(lines[end]);
		if (!match || match[1].length <= indent) break;
		end++;
	}
	return { start, end };
}

export type ApplyResult =
	| { ok: true; text: string; action: 'appended' | 'replaced' | 'unchanged' }
	| { ok: false; reason: 'page-missing' | 'section-missing' };

/**
 * Put an entry into page text. An entry already on the page (found by its
 * marker, anywhere on the page) is replaced in place. Otherwise the entry is
 * appended to the end of the day's section, before trailing blank lines, as a
 * DokuWiki section edit that adds a line at the bottom would.
 */
export function applyEntry(page: string, heading: string, marker: string, entry: string): ApplyResult {
	if (!page.trim()) return { ok: false, reason: 'page-missing' };
	const newline = page.includes('\r\n') ? '\r\n' : '\n';
	const lines = page.split(/\r?\n/);
	const entryLines = entry.split('\n');
	const existing = findMarkedBlock(lines, marker);
	if (existing) {
		const current = lines.slice(existing.start, existing.end);
		if (current.join('\n') === entryLines.join('\n')) return { ok: true, text: page, action: 'unchanged' };
		lines.splice(existing.start, existing.end - existing.start, ...entryLines);
		return { ok: true, text: lines.join(newline), action: 'replaced' };
	}
	const section = findSection(lines, heading);
	if (!section) return { ok: false, reason: 'section-missing' };
	let insertAt = section.end;
	while (insertAt > section.headingLine + 1 && !lines[insertAt - 1].trim()) insertAt--;
	const insert = [...entryLines];
	// Keep a blank line between the heading and the first entry of an empty section.
	if (insertAt === section.headingLine + 1) insert.unshift('');
	// A section that ran to the end of the page with no newline still gets one.
	if (insertAt === lines.length) insert.push('');
	lines.splice(insertAt, 0, ...insert);
	return { ok: true, text: lines.join(newline), action: 'appended' };
}
