import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type * as Yjs from 'yjs';
import {
	DEFAULT_DOKUWIKI_SETTINGS, DOKUWIKI_EDITING_MAP, DOKUWIKI_ORIGIN, applyEntry, badgeFor, dateVariables, expandTemplate, headingFor, markerFor,
	normalizeBaseUrl, pageIdFor, pageUrl, planEntry, sectionAnchor, sectionId, readStatus, renderEntry, xmlRpcUrl, type DokuWikiStatus
} from '../src/lib/dokuwikiWriter.ts';
import { decodeResponse, encodeCall, XmlRpcFault } from '../server/xmlrpc.ts';
import { DokuWikiTokens, DokuWikiWriter, needsWrite, retryDelay } from '../server/dokuwiki.ts';
import type { TaskDocuments } from '../server/task-documents.ts';

const Y = createRequire(import.meta.url)('yjs') as typeof Yjs;

// ── Templates ────────────────────────────────────────────────────────────────

test('expands the page id and heading used for the chronological todo pages', () => {
	assert.equal(pageIdFor(DEFAULT_DOKUWIKI_SETTINGS, '2026-11-17'), 'chronological:2026:nov:todo_2026_november');
	assert.equal(headingFor(DEFAULT_DOKUWIKI_SETTINGS, '2026-11-17'), '===== 2026-11-17 Tue =====');
	assert.equal(headingFor(DEFAULT_DOKUWIKI_SETTINGS, '2027-01-03'), '===== 2027-01-03 Sun =====');
	const v = dateVariables('2026-02-05');
	assert.deepEqual([v.m, v.d, v.Mon, v.Month, v.dddd], ['2', '5', 'Feb', 'February', 'Thursday']);
	assert.equal(expandTemplate('{yyyy} {unknown}', v), '2026 {unknown}');
	assert.throws(() => dateVariables('2026-02-30'));
});

test('normalizes wiki URLs, including pasted doku.php links', () => {
	assert.equal(normalizeBaseUrl('https://wiki.example/doku.php?id=chronological:2026:nov:todo_2026_november#tue2'), 'https://wiki.example/');
	assert.equal(normalizeBaseUrl('https://example.com/wiki'), 'https://example.com/wiki/');
	assert.equal(xmlRpcUrl('https://example.com/wiki/'), 'https://example.com/wiki/lib/exe/xmlrpc.php');
	assert.equal(normalizeBaseUrl('ftp://x/'), null);
	assert.equal(normalizeBaseUrl('not a url'), null);
});

test('renders an item with a marker, joined lines and nested subnotes', () => {
	const marker = markerFor('abc');
	assert.match(marker, /^#[0-9a-f]{7}$/);
	const text = renderEntry('  * {text} {id}', { text: 'Call Bob\nabout car', children: [{ text: 'rego', children: [{ text: 'due Fri', children: [] }] }] }, marker);
	assert.equal(text, `  * Call Bob \\\\ about car ${marker}\n    * rego\n      * due Fri`);
	// The marker is added when the template has no {id}.
	assert.equal(renderEntry('  * {text}', { text: 'x', children: [] }, marker), `  * x ${marker}`);
});

// ── Section editing ──────────────────────────────────────────────────────────

const PAGE = [
	'====== November 2026 ======',
	'',
	'===== 2026-11-16 Mon =====',
	'',
	'  * old thing',
	'',
	'===== 2026-11-17 Tue =====',
	'',
	'  * first',
	'    * nested',
	'',
	'',
	'===== 2026-11-18 Wed =====',
	'  * tomorrow',
	''
].join('\n');

test('appends at the end of the section, before the blank lines and next heading', () => {
	const result = applyEntry(PAGE, '===== 2026-11-17 Tue =====', '#aaaaaaa', '  * new #aaaaaaa');
	assert.ok(result.ok);
	assert.equal(result.action, 'appended');
	const lines = result.text.split('\n');
	assert.deepEqual(lines.slice(6, 13), ['===== 2026-11-17 Tue =====', '', '  * first', '    * nested', '  * new #aaaaaaa', '', '']);
	assert.equal(lines[13], '===== 2026-11-18 Wed =====');
});

test('replaces an existing entry with its nested lines, wherever it is on the page', () => {
	const first = applyEntry(PAGE, '===== 2026-11-17 Tue =====', '#bbbbbbb', '  * v1 #bbbbbbb\n    * child');
	assert.ok(first.ok);
	const second = applyEntry(first.text, '===== 2026-11-17 Tue =====', '#bbbbbbb', '  * v2 #bbbbbbb');
	assert.ok(second.ok);
	assert.equal(second.action, 'replaced');
	assert.ok(second.text.includes('  * v2 #bbbbbbb\n\n'));
	assert.ok(!second.text.includes('v1') && !second.text.includes('child'));
	const same = applyEntry(second.text, 'ignored', '#bbbbbbb', '  * v2 #bbbbbbb');
	assert.ok(same.ok && same.action === 'unchanged');
});

test('appends again when the marked line was removed by hand', () => {
	const result = applyEntry(PAGE, '===== 2026-11-18 Wed =====', '#ccccccc', '  * again #ccccccc');
	assert.ok(result.ok && result.action === 'appended');
	assert.ok(result.text.endsWith('  * tomorrow\n  * again #ccccccc\n'));
});

test('handles empty sections, the last section, and fails on missing ones', () => {
	const empty = applyEntry('===== A =====\n===== B =====\n', '===== A =====', '#d', '  * x #d');
	assert.ok(empty.ok);
	assert.equal(empty.text, '===== A =====\n\n  * x #d\n===== B =====\n');
	const noNewline = applyEntry('===== A =====\n  * y', '=====  A =====', '#e', '  * x #e');
	assert.ok(noNewline.ok);
	assert.equal(noNewline.text, '===== A =====\n  * y\n  * x #e\n');
	assert.deepEqual(applyEntry(PAGE, '===== 2026-11-19 Thu =====', '#f', 'x'), { ok: false, reason: 'section-missing' });
	assert.deepEqual(applyEntry('', '===== A =====', '#f', 'x'), { ok: false, reason: 'page-missing' });
	// A marker that is part of a longer word is not a match.
	const partial = applyEntry('===== A =====\n  * keep #abc12345\n', '===== A =====', '#abc1234', '  * new #abc1234');
	assert.ok(partial.ok && partial.action === 'appended');
});

test('a subsection stays within its parent section', () => {
	const page = '==== Day ====\n  * a\n=== Sub ===\n  * b\n==== Next ====\n';
	const result = applyEntry(page, '==== Day ====', '#g', '  * new #g');
	assert.ok(result.ok);
	assert.equal(result.text, '==== Day ====\n  * a\n=== Sub ===\n  * b\n  * new #g\n==== Next ====\n');
});

// ── XML-RPC ──────────────────────────────────────────────────────────────────

test('encodes calls and decodes values and faults', () => {
	assert.equal(encodeCall('core.savePage', ['a<b', 1, true, { sum: 'x' }]),
		'<?xml version="1.0"?><methodCall><methodName>core.savePage</methodName><params><param><value><string>a&lt;b</string></value></param><param><value><int>1</int></value></param><param><value><boolean>1</boolean></value></param><param><value><struct><member><name>sum</name><value><string>x</string></value></member></struct></value></param></params></methodCall>');
	const response = `<?xml version="1.0"?>\n<methodResponse><params><param><value><struct>
		<member><name>login</name><value><string>mark &amp; co</string></value></member>
		<member><name>groups</name><value><array><data><value>user</value><value><string></string></value></data></array></value></member>
		<member><name>n</name><value><int>-3</int></value></member>
		<member><name>ok</name><value><boolean>0</boolean></value></member>
		<member><name>text</name><value><string>  * line\n</string></value></member>
	</struct></value></param></params></methodResponse>`;
	assert.deepEqual(decodeResponse(response), { login: 'mark & co', groups: ['user', ''], n: -3, ok: false, text: '  * line\n' });
	assert.throws(() => decodeResponse('<methodResponse><fault><value><struct><member><name>faultCode</name><value><int>401</int></value></member><member><name>faultString</name><value><string>not logged in</string></value></member></struct></value></fault></methodResponse>'),
		(error: unknown) => error instanceof XmlRpcFault && error.code === 401 && error.message === 'not logged in');
});

// ── Writer ───────────────────────────────────────────────────────────────────

function fakeDocuments(doc: Yjs.Doc): TaskDocuments {
	return { async use(_username, operation) { return operation(doc); } };
}

function addItem(doc: Yjs.Doc, id: string, name: string, extra: Record<string, unknown> = {}) {
	const item = new Y.Map<unknown>();
	for (const [key, value] of Object.entries({ id, listId: 'l', name, order: 0, parentId: null, ...extra })) item.set(key, value);
	doc.getArray<Yjs.Map<unknown>>('items').push([item]);
	return item;
}

/** A tiny DokuWiki: one page store answering core.* XML-RPC calls. */
function fakeWiki(pages: Record<string, string>, options: { token?: string; down?: boolean } = {}) {
	const calls: string[] = [];
	const value = (v: string | boolean) => typeof v === 'boolean' ? `<boolean>${v ? 1 : 0}</boolean>` : `<string>${v.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</string>`;
	const unescape = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
	const fetcher = async (_url: string, init: { headers: Record<string, string>; body: string }) => {
		if (options.down) throw new Error('connect ECONNREFUSED');
		const method = /<methodName>(.*?)<\/methodName>/.exec(init.body)![1];
		const strings = [...init.body.matchAll(/<string>([\s\S]*?)<\/string>/g)].map((m) => unescape(m[1]));
		calls.push(method);
		const reply = (body: string, status = 200) => ({ ok: status < 400, status, statusText: '', text: async () => body });
		if (init.headers.Authorization !== `Bearer ${options.token ?? 'secret'}`) {
			return reply('<methodResponse><fault><value><struct><member><name>faultCode</name><value><int>-32604</int></value></member><member><name>faultString</name><value><string>Access denied</string></value></member></struct></value></fault></methodResponse>', 401);
		}
		if (method === 'core.getPage') return reply(`<methodResponse><params><param><value>${value(pages[strings[0]] ?? '')}</value></param></params></methodResponse>`);
		if (method === 'core.savePage') { pages[strings[0]] = strings[1]; return reply(`<methodResponse><params><param><value>${value(true)}</value></param></params></methodResponse>`); }
		if (method === 'core.whoAmI') return reply(`<methodResponse><params><param><value><struct><member><name>login</name><value><string>mark</string></value></member></struct></value></param></params></methodResponse>`);
		return reply('<methodResponse><fault><value><struct><member><name>faultCode</name><value><int>-32601</int></value></member><member><name>faultString</name><value><string>Method does not exist</string></value></member></struct></value></fault></methodResponse>', 404);
	};
	return { fetcher, calls };
}

async function tokensIn(t: { after(fn: () => Promise<void>): void }) {
	const dir = await mkdtemp(path.join(tmpdir(), 'dokuwiki-'));
	t.after(() => rm(dir, { recursive: true, force: true }));
	const kv = new Map<string, string>();
	return { tokens: new DokuWikiTokens({ get: (k) => kv.get(k), set: (k, v) => kv.set(k, v), delete: (k) => kv.delete(k) }, path.join(dir, 'key'), undefined), kv, dir };
}

test('writes marked items, then updates them in place after edits', async (t) => {
	const doc = new Y.Doc({ gc: false });
	doc.getMap('dokuwikiSettings').set('baseUrl', 'https://wiki.example/');
	const pageId = 'chronological:2026:nov:todo_2026_november';
	const pages: Record<string, string> = { [pageId]: PAGE };
	const wiki = fakeWiki(pages);
	const { tokens } = await tokensIn(t);
	tokens.set('mark', 'secret', false);
	const item = addItem(doc, 'i1', 'Buy milk', { dokuwiki: { date: '2026-11-17', requestedAt: '1' } });
	addItem(doc, 'c1', 'full cream', { parentId: 'i1' });
	addItem(doc, 'other', 'Not marked');
	const origins: unknown[] = [];
	doc.on('update', (_u: Uint8Array, origin: unknown) => origins.push(origin));
	const writer = new DokuWikiWriter({ documents: fakeDocuments(doc), tokens, fetcher: wiki.fetcher, log: () => {} });

	await writer.process('mark', 'update');
	const marker = markerFor('i1');
	assert.ok(pages[pageId].includes(`    * nested\n  * Buy milk ${marker}\n    * full cream\n\n`));
	const status = readStatus(item)!;
	assert.equal(status.state, 'written');
	assert.deepEqual(origins, [DOKUWIKI_ORIGIN]);
	assert.equal(badgeFor(planEntry(doc as never, DEFAULT_DOKUWIKI_SETTINGS, item), status), 'written');

	// Nothing to do: no wiki traffic.
	wiki.calls.length = 0;
	await writer.process('mark', 'update');
	assert.deepEqual(wiki.calls, []);

	// Edit the item: the same line is replaced, not duplicated.
	item.set('name', 'Buy oat milk');
	await writer.process('mark', 'update');
	assert.equal(pages[pageId].split(marker).length, 2);
	assert.ok(pages[pageId].includes(`  * Buy oat milk ${marker}\n    * full cream`));
});

test('entries with a subnote open in an editor wait until the edit hold is released', async (t) => {
	const doc = new Y.Doc({ gc: false });
	doc.getMap('dokuwikiSettings').set('baseUrl', 'https://wiki.example/');
	const pageId = 'chronological:2026:nov:todo_2026_november';
	const pages: Record<string, string> = { [pageId]: PAGE };
	const wiki = fakeWiki(pages);
	const { tokens } = await tokensIn(t);
	tokens.set('mark', 'secret', false);
	const now = Date.parse('2026-11-17T10:00:00Z');
	addItem(doc, 'i1', 'Buy milk', { dokuwiki: { date: '2026-11-17', requestedAt: '1' } });
	const child = addItem(doc, 'c1', 'full', { parentId: 'i1' });
	const holds = doc.getMap(DOKUWIKI_EDITING_MAP);
	holds.set('session', { itemId: 'c1', expiresAt: new Date(now + 60_000).toISOString() });
	const writer = new DokuWikiWriter({ documents: fakeDocuments(doc), tokens, fetcher: wiki.fetcher, log: () => {}, now: () => now });
	t.after(() => holds.clear());

	child.set('name', 'full cr');
	await writer.process('mark', 'update');
	assert.deepEqual(wiki.calls, [], 'half-typed text is not written');

	child.set('name', 'full cream');
	holds.delete('session');
	await writer.process('mark', 'update');
	assert.ok(pages[pageId].includes(`  * Buy milk ${markerFor('i1')}\n    * full cream`));

	// A lapsed hold (closed tab) no longer blocks.
	holds.set('stale', { itemId: 'i1', expiresAt: new Date(now - 1).toISOString() });
	child.set('name', 'full cream milk');
	await writer.process('mark', 'update');
	assert.ok(pages[pageId].includes('    * full cream milk'));
});

test('section anchors follow DokuWiki: date stripped, repeats numbered', () => {
	assert.equal(sectionId('2026-11-17 Tue'), 'tue');
	assert.equal(sectionId('Ünïcode Heading: v1.2'), 'unicode_headingv12');
	assert.equal(sectionId('2026'), 'section2026');
	const page = [
		'====== November 2026 ======',
		'===== 2026-11-03 Tue =====', '  * a',
		'===== 2026-11-10 Tue =====', '<code>', '===== 2026-11-12 Tue =====', '</code>',
		'===== 2026-11-17 Tue =====', '  * b',
		'===== 2026-11-18 Wed ====='
	].join('\n');
	assert.equal(sectionAnchor(page, '===== 2026-11-03 Tue ====='), 'tue');
	assert.equal(sectionAnchor(page, '===== 2026-11-17 Tue ====='), 'tue2');
	assert.equal(sectionAnchor(page, '===== 2026-11-18 Wed ====='), 'wed');
	assert.equal(sectionAnchor(page, '===== 2026-11-19 Thu ====='), null);
	assert.equal(pageUrl('https://wiki.example/', 'a:b', 'tue2'), 'https://wiki.example/doku.php?id=a:b#tue2');
});

test('records missing sections, missing tokens and network failures', async (t) => {
	const doc = new Y.Doc({ gc: false });
	doc.getMap('dokuwikiSettings').set('baseUrl', 'https://wiki.example/');
	const pages: Record<string, string> = { 'chronological:2026:nov:todo_2026_november': PAGE };
	const { tokens } = await tokensIn(t);
	const missing = addItem(doc, 'm', 'x', { dokuwiki: { date: '2026-11-20', requestedAt: '1' } });

	let writer = new DokuWikiWriter({ documents: fakeDocuments(doc), tokens, fetcher: fakeWiki(pages).fetcher, log: () => {} });
	await writer.process('mark', 'update');
	assert.equal(readStatus(missing)!.state, 'auth');

	tokens.set('mark', 'wrong', false);
	await writer.process('mark', 'manual');
	assert.equal(readStatus(missing)!.state, 'auth');
	assert.match(readStatus(missing)!.message!, /Access denied/);

	tokens.set('mark', 'secret', false);
	await writer.process('mark', 'manual');
	assert.equal(readStatus(missing)!.state, 'error');
	assert.match(readStatus(missing)!.message!, /Section "===== 2026-11-20 Fri =====" not found/);
	assert.equal(readStatus(missing)!.retryable, false);

	const now = Date.parse('2026-11-17T10:00:00Z');
	writer = new DokuWikiWriter({ documents: fakeDocuments(doc), tokens, fetcher: fakeWiki(pages, { down: true }).fetcher, log: () => {}, now: () => now });
	missing.set('dokuwiki', { date: '2026-11-17', requestedAt: '2' });
	await writer.process('mark', 'update');
	const status = readStatus(missing)!;
	assert.equal(status.state, 'error');
	assert.equal(status.retryable, true);
	assert.equal(status.attempts, 1);
	assert.equal(Date.parse(status.nextRetryAt!), now + 30_000);
	await writer.process('mark', 'manual');
	assert.equal(readStatus(missing)!.attempts, 2);
});

test('retry rules and backoff', () => {
	const plan = { itemId: 'i', request: { date: '2026-11-17', requestedAt: 'r' }, pageId: 'p', heading: 'h', marker: '#m', text: 't', hash: 'h1', ids: ['i'] };
	const now = Date.parse('2026-11-17T10:00:00Z');
	const at = (ms: number) => new Date(now + ms).toISOString();
	const base: DokuWikiStatus = { state: 'error', requestedAt: 'r' };
	assert.equal(needsWrite(plan, null, 'update', now), true);
	assert.equal(needsWrite(plan, { ...base, requestedAt: 'old' }, 'update', now), true);
	assert.equal(needsWrite(plan, { state: 'written', requestedAt: 'r', hash: 'h1', anchor: 'tue' }, 'manual', now), false);
	// Written before anchors existed: picked up by a sweep, not by every update.
	assert.equal(needsWrite(plan, { state: 'written', requestedAt: 'r', hash: 'h1' }, 'startup', now), true);
	assert.equal(needsWrite(plan, { state: 'written', requestedAt: 'r', hash: 'h1' }, 'update', now), false);
	assert.equal(needsWrite(plan, { state: 'written', requestedAt: 'r', hash: 'h0' }, 'update', now), true);
	assert.equal(needsWrite(plan, { ...base, retryable: true, nextRetryAt: at(1000) }, 'update', now), false);
	assert.equal(needsWrite(plan, { ...base, retryable: true, nextRetryAt: at(-1) }, 'timer', now), true);
	assert.equal(needsWrite(plan, { ...base, attemptedAt: at(-10_000) }, 'update', now), false);
	assert.equal(needsWrite(plan, { ...base, attemptedAt: at(-61_000) }, 'update', now), true);
	assert.equal(needsWrite(plan, { ...base, attemptedAt: at(-61_000) }, 'timer', now), false);
	assert.deepEqual([1, 2, 3, 10].map(retryDelay), [30_000, 60_000, 120_000, 3_600_000]);
});

test('remembered tokens are encrypted at rest and survive a restart', async (t) => {
	const { tokens, kv, dir } = await tokensIn(t);
	tokens.set('mark', 'top-secret-token', true);
	const stored = kv.get('dokuwiki_token:mark')!;
	assert.ok(stored && !stored.includes('top-secret-token'));
	const restarted = new DokuWikiTokens({ get: (k) => kv.get(k), set: (k, v) => kv.set(k, v), delete: (k) => kv.delete(k) }, path.join(dir, 'key'), undefined);
	assert.equal(restarted.get('mark'), 'top-secret-token');
	assert.deepEqual(restarted.status('mark'), { hasToken: true, remembered: true });
	tokens.set('mark', 'memory-only', false);
	assert.equal(kv.has('dokuwiki_token:mark'), false);
	assert.deepEqual(tokens.status('mark'), { hasToken: true, remembered: false });
	tokens.clear('mark');
	assert.equal(tokens.get('mark'), null);
});

test('an untrusted HTTPS certificate is reported with its cause and not retried', async (t) => {
	const doc = new Y.Doc({ gc: false });
	doc.getMap('dokuwikiSettings').set('baseUrl', 'https://wiki.example/');
	const { tokens } = await tokensIn(t);
	tokens.set('mark', 'secret', false);
	const item = addItem(doc, 'i', 'x', { dokuwiki: { date: '2026-11-17', requestedAt: '1' } });
	const fetcher = async () => {
		throw new TypeError('fetch failed', { cause: Object.assign(new Error('unable to verify the first certificate'), { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' }) });
	};
	const writer = new DokuWikiWriter({ documents: fakeDocuments(doc), tokens, fetcher, log: () => {} });
	await writer.process('mark', 'update');
	const status = readStatus(item)!;
	assert.equal(status.retryable, false);
	assert.match(status.message!, /certificate is not trusted \(unable to verify the first certificate\).*NODE_EXTRA_CA_CERTS/);
});
