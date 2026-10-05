import { createRequire } from 'node:module';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import express from 'express';
import type * as Yjs from 'yjs';
import { isValidUsername, readSessionCookie, type SessionStore } from './auth.ts';
import { importNameKey } from './import-text.ts';
import type { TaskDocuments } from './task-documents.ts';

const Y = createRequire(import.meta.url)('yjs') as typeof Yjs;
export interface TaskToken { tokenHash: string; username: string; listIds?: string[] }
interface Principal { username: string; listIds?: string[] }
class RequestError extends Error {
	constructor(readonly status: number, message: string) { super(message); }
}

export function readTaskTokens(file: string): TaskToken[] {
	try {
		const data = JSON.parse(fs.readFileSync(file, 'utf8'));
		return Array.isArray(data.tokens) ? data.tokens.filter((entry: TaskToken) =>
			entry && /^[a-f0-9]{64}$/.test(entry.tokenHash) && isValidUsername(entry.username) &&
			(entry.listIds === undefined || (Array.isArray(entry.listIds) && entry.listIds.every(id => typeof id === 'string' && id.length > 0)))) : [];
	} catch { return []; }
}

/** Consult current credentials/tokens on each call; neither is exposed to clients. */
export function createTaskRouter(sessions: SessionStore, documents: TaskDocuments, options: {
	readTokens: () => TaskToken[];
	userExists: (username: string) => boolean;
}) {
	const router = express.Router();
	router.use((req, res, next) => {
		res.set('Cache-Control', 'no-store');
		let principal: Principal | undefined;
		try {
			const authorization = req.headers.authorization;
			if (authorization !== undefined) {
				const match = /^Bearer ([a-f0-9]{64})$/.exec(authorization);
				if (match) {
					const hash = createHash('sha256').update(match[1]).digest();
					const token = options.readTokens().find(entry => timingSafeEqual(hash, Buffer.from(entry.tokenHash, 'hex')));
					if (token && options.userExists(token.username)) principal = token;
				}
			} else {
				principal = sessions.verify(readSessionCookie(req.headers.cookie)) ?? undefined;
			}
		} catch { return res.status(503).json({ error: 'Task integration unavailable' }); }
		if (!principal) return res.status(401).json({ error: 'Invalid task credentials' });
		res.locals.taskPrincipal = principal;
		next();
	});
	router.use(express.json({ limit: '1mb' }));
	router.get('/lists', async (_req, res) => {
		const principal: Principal = res.locals.taskPrincipal;
		const lists = await documents.use(principal.username, doc => doc.getArray<Yjs.Map<unknown>>('lists').toArray()
			.filter(list => list.get('type') !== 'divider' && (!principal.listIds || principal.listIds.includes(list.get('id') as string)))
			.map(list => ({ id: list.get('id'), name: list.get('name'), folderId: list.get('folderId') })));
		res.json({ lists });
	});
	router.post('/folders', async (req, res) => {
		const principal: Principal = res.locals.taskPrincipal;
		if (principal.listIds) throw new RequestError(403, 'A list-scoped token cannot create folders');
		const body = req.body;
		if (!body || typeof body.name !== 'string' || !body.name.trim() || body.name.length > 200) throw new RequestError(400, 'Supply a folder name');
		const result = await documents.use(principal.username, doc => {
			const name = body.name.trim(), folders = doc.getArray<Yjs.Map<unknown>>('folders');
			const existing = folders.toArray().find(folder => !folder.get('parentId') && folder.get('name') === name);
			if (existing) {
				if (existing.get('archived')) throw new RequestError(400, 'Destination folder is archived');
				return { folder: { id: existing.get('id'), name, parentId: null }, created: false };
			}
			const orders = folders.toArray().filter(folder => !folder.get('parentId')).map(folder => folder.get('order'))
				.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
			const id = randomUUID(), now = new Date().toISOString(), folder = new Y.Map<unknown>();
			doc.transact(() => {
				for (const [key, value] of Object.entries({ id, name, parentId: null, color: '#6366f1', order: orders.length ? Math.max(...orders) + 1 : 0, done: false, favourite: false, archived: false, foldersFirst: true, localNav: false, createdAt: now, updatedAt: now })) folder.set(key, value);
				folders.push([folder]);
			}, 'task-api');
			return { folder: { id, name, parentId: null }, created: true };
		}, true);
		res.json(result);
	});
	router.patch('/lists/:id', async (req, res) => {
		const principal: Principal = res.locals.taskPrincipal;
		if (principal.listIds) throw new RequestError(403, 'A list-scoped token cannot move lists');
		const body = req.body;
		if (!body || typeof body.folderId !== 'string' || !body.folderId || body.folderId.length > 128) throw new RequestError(400, 'Supply folderId');
		const result = await documents.use(principal.username, doc => {
			const lists = doc.getArray<Yjs.Map<unknown>>('lists').toArray(), folders = doc.getArray<Yjs.Map<unknown>>('folders').toArray();
			const list = lists.find(list => list.get('id') === req.params.id);
			if (!list) throw new RequestError(404, 'Destination list no longer exists');
			if (list.get('type') === 'divider') throw new RequestError(400, 'Cannot move a divider');
			const folder = folders.find(folder => folder.get('id') === body.folderId);
			if (!folder) throw new RequestError(404, 'Destination folder no longer exists');
			if (folder.get('archived')) throw new RequestError(400, 'Destination folder is archived');
			const moved = list.get('folderId') !== body.folderId;
			if (moved) {
				const orders = [...folders.filter(folder => folder.get('parentId') === body.folderId), ...lists.filter(sibling => sibling.get('folderId') === body.folderId)]
					.map(item => item.get('order')).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
				doc.transact(() => {
					list.set('folderId', body.folderId); list.set('color', folder.get('color') ?? '#6366f1'); list.set('order', orders.length ? Math.max(...orders) + 1 : 0); list.set('updatedAt', new Date().toISOString());
				}, 'task-api');
			}
			return { list: { id: list.get('id'), name: list.get('name'), folderId: body.folderId }, moved };
		}, true);
		res.json(result);
	});
	router.post('/lists', async (req, res) => {
		const principal: Principal = res.locals.taskPrincipal;
		if (principal.listIds) throw new RequestError(403, 'A list-scoped token cannot create lists');
		const body = req.body;
		if (!body || typeof body.name !== 'string' || !body.name.trim() || body.name.length > 200 ||
			typeof body.folderId !== 'string' || !body.folderId || body.folderId.length > 128) throw new RequestError(400, 'Supply name and folderId');
		const result = await documents.use(principal.username, doc => {
			const folders = doc.getArray<Yjs.Map<unknown>>('folders').toArray();
			const folder = folders.find(folder => folder.get('id') === body.folderId);
			if (!folder) throw new RequestError(404, 'Destination folder no longer exists');
			if (folder.get('archived')) throw new RequestError(400, 'Destination folder is archived');
			const name = body.name.trim(), lists = doc.getArray<Yjs.Map<unknown>>('lists');
			const existing = lists.toArray().find(list => list.get('folderId') === body.folderId && list.get('name') === name && list.get('type') !== 'divider');
			if (existing) return { list: { id: existing.get('id'), name, folderId: body.folderId }, created: false };
			const orders = [...folders.filter(folder => folder.get('parentId') === body.folderId), ...lists.toArray().filter(list => list.get('folderId') === body.folderId)]
				.map(item => item.get('order')).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
			const id = randomUUID(), now = new Date().toISOString(), list = new Y.Map<unknown>();
			doc.transact(() => {
				for (const [key, value] of Object.entries({ id, name, folderId: body.folderId, type: 'plain', color: '#6366f1', order: orders.length ? Math.max(...orders) + 1 : 0, createdAt: now, updatedAt: now, defaultIsNote: false, journalMode: false })) list.set(key, value);
				lists.push([list]);
			}, 'task-api');
			return { list: { id, name, folderId: body.folderId }, created: true };
		}, true);
		res.json(result);
	});
	router.post('/import', async (req, res) => {
		const principal: Principal = res.locals.taskPrincipal;
		const body = req.body;
		if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.listId !== 'string' || !body.listId || body.listId.length > 128 ||
			(body.addPosition !== undefined && !['top', 'bottom'].includes(body.addPosition)) ||
			((typeof body.text === 'string') === Array.isArray(body.tasks))) throw new RequestError(400, 'Supply listId and either text or a tasks array');
		if (principal.listIds && !principal.listIds.includes(body.listId)) throw new RequestError(403, 'Token does not allow this list');
		const values: unknown[] = typeof body.text === 'string' ? body.text.split(/\r?\n/) : body.tasks;
		if (values.length > 500 || values.some(value => typeof value !== 'string' || value.length > 5000 || /[\r\n\u0000]/.test(value))) {
			throw new RequestError(400, 'Use at most 500 single-line tasks, each at most 5000 characters');
		}
		const names = (values as string[]).map(value => value.trim()).filter(value => /\p{L}/u.test(value));
		const result = await documents.use(principal.username, doc => importTasks(doc, body.listId, names, body.addPosition ?? 'bottom'), true);
		res.json({ ...result, ignored: values.length - names.length });
	});
	router.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
		const status = error instanceof RequestError ? error.status :
			typeof error === 'object' && error !== null && 'status' in error && (error.status === 400 || error.status === 413) ? error.status : 503;
		res.status(status).json({ error: error instanceof RequestError ? error.message : status === 503 ? 'Task integration unavailable; retry safely' : 'Invalid task request' });
	});
	return router;
}

function currentName(doc: Yjs.Doc, item: Yjs.Map<unknown>): string {
	const id = item.get('id') as string, key = `note_text_${id}`;
	return doc.getMap('note-text-initialized').has(id) || doc.share.get(key)?._start
		? doc.getText(key).toString().replace(/\n$/, '') : (item.get('name') as string) ?? '';
}

export function importTasks(doc: Yjs.Doc, listId: string, names: string[], position: 'top' | 'bottom') {
	const list = doc.getArray<Yjs.Map<unknown>>('lists').toArray().find(list => list.get('id') === listId);
	if (!list) throw new RequestError(404, 'Destination list no longer exists');
	if (list.get('type') === 'divider') throw new RequestError(400, 'Cannot add tasks to a divider');
	const items = doc.getArray<Yjs.Map<unknown>>('items');
	const existing = items.toArray().filter(item => item.get('listId') === listId);
	const matching = new Map(existing.map(item => [importNameKey(currentName(doc, item)), item.get('id') as string]));
	const additions: { id: string; name: string }[] = [], results: { id: string; name: string; status: string }[] = [];
	for (const name of names) {
		const key = importNameKey(name), previous = matching.get(key);
		if (previous) results.push({ id: previous, name, status: 'duplicate' });
		else {
			const id = randomUUID();
			matching.set(key, id); additions.push({ id, name }); results.push({ id, name, status: 'added' });
		}
	}
	const orders = existing.filter(item => (item.get('parentId') ?? null) === null).map(item => item.get('order'))
		.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
	const base = !orders.length ? 0 : position === 'top' ? Math.min(...orders) - additions.length : Math.max(...orders) + 1;
	const now = new Date().toISOString();
	if (additions.length) doc.transact(() => {
		const maps = additions.map(({ id, name }, index) => {
			const item = new Y.Map<unknown>();
			for (const [key, value] of Object.entries({ id, listId, name, price: null, checked: false, order: base + index, createdAt: now, updatedAt: now })) item.set(key, value);
			doc.getText(`note_text_${id}`).insert(0, name);
			doc.getMap('note-text-initialized').set(id, true);
			return item;
		});
		items.push(maps);
	}, 'task-api');
	return { added: additions.length, duplicates: names.length - additions.length, items: results };
}
