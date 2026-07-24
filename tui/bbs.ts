import { parseArgs } from 'node:util';
import fs from 'node:fs';
import * as readline from 'node:readline';
import * as Y from 'yjs';
import { initYjs, getLists, getItems, getFolders } from './store.js';

// ── Config ────────────────────────────────────────────────────────────────────

const { values } = parseArgs({
	options: { config: { type: 'string', short: 'c' } },
	strict: false
});

let hostname = 'localhost';
let port = 8080;
let tls = false;
let insecure = false;

if (values.config) {
	try {
		const configStr = fs.readFileSync(values.config, 'utf8');
		const config = JSON.parse(configStr);
		if (config.hostname) hostname = config.hostname;
		if (config.port) port = config.port;
		if (config.tls !== undefined) tls = config.tls;
		if (config.insecure !== undefined) insecure = config.insecure;
	} catch (e: any) {
		console.error(`Failed to load config: ${e.message}`);
		process.exit(1);
	}
}

if (tls && hostname === 'localhost' && !values.config?.includes('"insecure"')) {
	insecure = true;
}

if (insecure) {
	process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
	const orig = process.emit.bind(process);
	process.emit = ((name: any, data: any, ...args: any[]) => {
		if (name === 'warning' && data?.message?.includes('NODE_TLS_REJECT_UNAUTHORIZED')) return false;
		return orig(name, data, ...args);
	}) as any;
}

const serverUrl = `${tls ? 'https' : 'http'}://${hostname}:${port}`;
const wsUrl = `${tls ? 'wss' : 'ws'}://${hostname}:${port}/yjs`;

// ── Data helpers ──────────────────────────────────────────────────────────────

type FolderMap = Y.Map<unknown>;
type ListMap = Y.Map<unknown>;
type ItemMap = Y.Map<unknown>;

/** Is this folder or any ancestor archived? */
function isFolderEffectivelyArchived(folderId: string | null, allFolders: FolderMap[]): boolean {
	if (!folderId) return false;
	const f = allFolders.find((x: any) => x.get('id') === folderId);
	if (!f) return false;
	if (f.get('archived')) return true;
	return isFolderEffectivelyArchived(f.get('parentId') as string | null, allFolders);
}

function visibleFolders(allFolders: FolderMap[], parentId: string | null): FolderMap[] {
	return allFolders
		.filter((f: any) =>
			f.get('parentId') === parentId &&
			!f.get('archived') &&
			!isFolderEffectivelyArchived(f.get('parentId') as string | null, allFolders)
		)
		.sort((a: any, b: any) => (a.get('order') as number ?? 0) - (b.get('order') as number ?? 0));
}

function visibleListsInFolder(allLists: ListMap[], allFolders: FolderMap[], folderId: string | null): ListMap[] {
	return allLists
		.filter((l: any) =>
			l.get('folderId') === folderId &&
			!l.get('archived') &&
			!isFolderEffectivelyArchived(folderId, allFolders)
		)
		.sort((a: any, b: any) => (a.get('order') as number ?? 0) - (b.get('order') as number ?? 0));
}

function sortedItems(allItems: ItemMap[], listId: string): ItemMap[] {
	return allItems
		.filter((i: any) => i.get('listId') === listId)
		.sort((a: any, b: any) => (a.get('order') as number ?? 0) - (b.get('order') as number ?? 0));
}

// ── I/O helpers ───────────────────────────────────────────────────────────────

function print(line = '') { process.stdout.write(line + '\n'); }
function hr(char = '-', width = 48) { print(char.repeat(width)); }

/** Read a single keypress without requiring Enter. */
function readKey(): Promise<string> {
	return new Promise((resolve) => {
		if (process.stdin.isTTY) process.stdin.setRawMode(true);
		process.stdin.resume();
		process.stdin.setEncoding('utf8');
		function onData(ch: string) {
			process.stdin.removeListener('data', onData);
			process.stdin.pause();
			if (process.stdin.isTTY) process.stdin.setRawMode(false);
			// Ctrl+C
			if (ch === '\u0003') { print('\nGoodbye.'); process.exit(0); }
			resolve(ch.trim().toUpperCase());
		}
		process.stdin.on('data', onData);
	});
}

/** Prompt for a full line of text (Enter required — for usernames, passwords, item text). */
function readLine(prompt: string, mask = false): Promise<string> {
	return new Promise((resolve) => {
		const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
		if (mask) {
			// Show asterisks
			process.stdout.write(prompt);
			let value = '';
			process.stdin.setRawMode?.(true);
			process.stdin.resume();
			process.stdin.setEncoding('utf8');
			function onChar(ch: string) {
				if (ch === '\r' || ch === '\n') {
					process.stdin.removeListener('data', onChar);
					process.stdin.setRawMode?.(false);
					process.stdin.pause();
					rl.close();
					process.stdout.write('\n');
					resolve(value);
				} else if (ch === '\u0003') {
					print('\nGoodbye.'); process.exit(0);
				} else if (ch === '\u007f') {
					if (value.length > 0) { value = value.slice(0, -1); process.stdout.write('\b \b'); }
				} else {
					value += ch;
					process.stdout.write('*');
				}
			}
			process.stdin.on('data', onChar);
		} else {
			rl.question(prompt, (ans) => { rl.close(); resolve(ans.trim()); });
		}
	});
}

// ── Menu builder ──────────────────────────────────────────────────────────────

interface Option {
	key: string;     // single char shown to user
	label: string;
	action: () => Promise<void> | void;
}

/** Print and execute a lettered/numbered menu. Returns after the action runs. */
async function menu(title: string, options: Option[], extras: Option[] = []) {
	print();
	hr('=');
	print(` ${title}`);
	hr('=');
	const allOptions = [...options, ...extras];
	for (const opt of allOptions) {
		print(` [${opt.key}] ${opt.label}`);
	}
	print();
	process.stdout.write('> ');
	const key = await readKey();
	print(key);  // echo the key
	const match = allOptions.find((o) => o.key === key);
	if (match) {
		await match.action();
	} else {
		print('  ! Invalid option.');
	}
}

// ── Views ─────────────────────────────────────────────────────────────────────

let yDoc: Y.Doc | null = null;

function getDoc(): Y.Doc {
	if (!yDoc) throw new Error('Not connected');
	return yDoc;
}

/** Assign numbered keys (1-9, a-z) to items. */
function assignKeys(items: any[]): Array<{ key: string; item: any }> {
	const chars = '123456789abcdefghijklmnopqrstuvwxyz';
	return items.map((item, i) => ({ key: chars[i] ?? '?', item }));
}

async function viewList(listId: string, allLists: ListMap[]) {
	const doc = getDoc();
	const list = allLists.find((l: any) => l.get('id') === listId) as any;
	if (!list) { print('  ! List not found.'); return; }

	const listName = list.get('name') as string;
	const listType = list.get('type') as string;

	while (true) {
		const allItems = getItems(doc).toArray();
		const items = sortedItems(allItems as ItemMap[], listId);

		const keyed = assignKeys(items);

		print();
		hr('=');
		print(` LIST: ${listName}`);
		hr('-');

		if (items.length === 0) {
			print('  (Empty list)');
		} else {
			for (const { key, item } of keyed) {
				const checked = item.get('checked') ? '[x]' : '[ ]';
				const name = item.get('name') as string;
				const price = item.get('price');
				const qty = item.get('qty');
				const heading = item.get('heading');
				const note = item.get('note');

				if (heading) {
					print(`  --- ${name.toUpperCase()} ---`);
				} else if (note) {
					print(`  [${key}] NOTE: ${name}`);
				} else if (listType === 'priced' && price != null) {
					const qtyStr = qty != null && qty !== 1 ? `x${qty} ` : '';
					print(`  [${key}] ${checked} ${name}  $${qtyStr}${((price as number) * ((qty as number) ?? 1)).toFixed(2)}`);
				} else {
					print(`  [${key}] ${checked} ${name}`);
				}
			}
		}

		hr('-');
		print(`  [t] Toggle item  [a] Add item  [d] Delete item  [b] Back`);
		print();
		process.stdout.write('> ');
		const key = await readKey();
		print(key);

		if (key === 'B') {
			return;
		} else if (key === 'A') {
			const name = await readLine('  New item name: ');
			if (name) {
				const doc2 = getDoc();
				const allItems2 = getItems(doc2).toArray() as Y.Map<unknown>[];
				const maxOrder = allItems2
					.filter((i: any) => i.get('listId') === listId)
					.reduce((max: number, i: any) => Math.max(max, (i.get('order') as number) ?? 0), -1);
				const m = new Y.Map<unknown>();
				m.set('id', crypto.randomUUID());
				m.set('listId', listId);
				m.set('name', name);
				m.set('checked', false);
				m.set('order', maxOrder + 1);
				m.set('createdAt', new Date().toISOString());
				m.set('updatedAt', new Date().toISOString());
				getItems(doc2).push([m]);
				print(`  + Added "${name}"`);
			}
		} else if (key === 'T') {
			print('  Toggle which item? ');
			process.stdout.write('> ');
			const k = await readKey();
			print(k);
			const match = keyed.find((x) => x.key === k.toLowerCase());
			if (match) {
				const current = match.item.get('checked') as boolean;
				match.item.set('checked', !current);
				print(`  Toggled "${match.item.get('name')}"`);
			} else {
				print('  ! Not found.');
			}
		} else if (key === 'D') {
			print('  Delete which item? ');
			process.stdout.write('> ');
			const k = await readKey();
			print(k);
			const match = keyed.find((x) => x.key === k.toLowerCase());
			if (match) {
				const name = match.item.get('name');
				const doc2 = getDoc();
				const allItems2 = getItems(doc2).toArray() as Y.Map<unknown>[];
				const idx = allItems2.findIndex((i: any) => i.get('id') === match.item.get('id'));
				if (idx !== -1) getItems(doc2).delete(idx, 1);
				print(`  - Deleted "${name}"`);
			} else {
				print('  ! Not found.');
			}
		} else {
			print('  ! Invalid option.');
		}
	}
}

async function viewDirectory(folderId: string | null, breadcrumb: string) {
	const doc = getDoc();
	while (true) {
		const allFolders = getFolders(doc).toArray() as FolderMap[];
		const allLists = getLists(doc).toArray() as ListMap[];

		const folders = visibleFolders(allFolders, folderId);
		const lists = visibleListsInFolder(allLists, allFolders, folderId);

		print();
		hr('=');
		print(` ${breadcrumb}`);
		hr('=');

		// If at home, show Favourites section first
		if (folderId === null) {
			const favFolders = allFolders
				.filter((f: any) => f.get('favourite') && !f.get('archived'))
				.sort((a: any, b: any) => (a.get('order') as number ?? 0) - (b.get('order') as number ?? 0));
			const favLists = allLists
				.filter((l: any) => l.get('favourite') && !l.get('archived') && !isFolderEffectivelyArchived(l.get('folderId') as string | null, allFolders))
				.sort((a: any, b: any) => (a.get('order') as number ?? 0) - (b.get('order') as number ?? 0));

			if (favFolders.length > 0 || favLists.length > 0) {
				print(' * FAVOURITES');
				hr('-');
				for (const f of favFolders) {
					print(`   [F] ${f.get('name') as string}/`);
				}
				for (const l of favLists) {
					print(`   [L] ${l.get('name') as string}`);
				}
				hr('-');
			}
		}

		// Build numbered options for navigation
		type NavItem = { type: 'folder' | 'list'; obj: any };
		const navItems: NavItem[] = [
			...folders.map((f) => ({ type: 'folder' as const, obj: f })),
			...lists.map((l) => ({ type: 'list' as const, obj: l })),
		];

		const keyed = assignKeys(navItems);

		if (keyed.length === 0) {
			print('  (Nothing here)');
		} else {
			for (const { key, item } of keyed) {
				if (item.type === 'folder') {
					print(`  [${key}] ${item.obj.get('name')}/`);
				} else {
					const done = item.obj.get('done') ? ' ✓' : '';
					print(`  [${key}] ${item.obj.get('name')}${done}`);
				}
			}
		}

		hr('-');
		const backHint = folderId !== null ? '  [b] Back  ' : '';
		print(`${backHint}  [r] Refresh  [q] Quit`);
		print();
		process.stdout.write('> ');
		const key = await readKey();
		print(key);

		if (key === 'Q') {
			print('Goodbye.');
			process.exit(0);
		} else if (key === 'R') {
			// loop — will reprint
		} else if (key === 'B' && folderId !== null) {
			return; // pop back to parent
		} else {
			const match = keyed.find((x) => x.key === key.toLowerCase());
			if (match) {
				if (match.item.type === 'folder') {
					const folderName = match.item.obj.get('name') as string;
					await viewDirectory(match.item.obj.get('id') as string, `${breadcrumb} > ${folderName}`);
				} else {
					await viewList(match.item.obj.get('id') as string, getLists(doc).toArray() as ListMap[]);
				}
			} else {
				print('  ! Invalid option.');
			}
		}
	}
}

// ── Login ─────────────────────────────────────────────────────────────────────

async function login() {
	print();
	print('  ╔══════════════════════════════════════════╗');
	print('  ║      LISTS & PRICES  —  BBS CLIENT       ║');
	print('  ╚══════════════════════════════════════════╝');
	print();

	while (true) {
		const username = await readLine('  Username: ');
		const password = await readLine('  Password: ', true);

		try {
			print('  Connecting…');
			const res = await fetch(`${serverUrl}/api/login`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ username, password })
			});

			if (!res.ok) {
				const body = await res.json() as any;
				print(`  ! Login failed: ${body.error ?? 'unknown error'}`);
				continue;
			}

			const setCookieHeader = res.headers.get('set-cookie');
			if (!setCookieHeader) { print('  ! No cookie returned.'); continue; }

			const sessionCookie = setCookieHeader.split(';')[0];
			yDoc = initYjs(username, wsUrl, sessionCookie, insecure, () => {});

			// Brief pause for initial sync
			await new Promise((r) => setTimeout(r, 600));
			print(`  Synced as ${username}. Welcome!\n`);
			return;
		} catch (err: any) {
			print(`  ! Error: ${err.message}`);
		}
	}
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
	await login();
	await viewDirectory(null, 'HOME');
}

main().catch((err) => { console.error(err); process.exit(1); });
