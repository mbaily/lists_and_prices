/**
 * DokuWiki writer, server side.
 *
 * Items marked in the app carry a `dokuwiki` request in the synced Yjs
 * document. Whenever a user's document changes, the writer looks for requests
 * that still need writing, edits the day's section through DokuWiki's XML-RPC
 * API, and records the outcome as `dokuwikiStatus` on the item.
 *
 * The API token never reaches the browser. It is kept in memory, and, when
 * the user ticks "Remember", AES-256-GCM encrypted in the server database with
 * a key kept in a separate file.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import express from 'express';
import type * as Yjs from 'yjs';
import { requireAuth } from './auth-http.ts';
import type { SessionStore } from './auth.ts';
import type { TaskDocuments } from './task-documents.ts';
import { HttpError, XmlRpcFault, xmlRpcCall, type FetchLike, type XmlRpcValue } from './xmlrpc.ts';
import {
	DOKUWIKI_ORIGIN, DOKUWIKI_STATUS_KEY, applyEntry, headingFor, localDateString, pageIdFor, planEntry,
	readDokuWikiSettings, readRequest, readStatus, xmlRpcUrl, type DokuWikiStatus, type PlannedEntry
} from '../src/lib/dokuwikiWriter.ts';

// ── Token storage ────────────────────────────────────────────────────────────

export interface KeyValue {
	get(key: string): string | undefined;
	set(key: string, value: string): void;
	delete(key: string): void;
}

export class DokuWikiTokens {
	private memory = new Map<string, string>();
	private key: Buffer | null = null;
	constructor(private kv: KeyValue, private keyFile: string, private envKey = process.env.DOKUWIKI_TOKEN_KEY) {}

	private encryptionKey(): Buffer {
		if (this.key) return this.key;
		if (this.envKey) {
			if (!/^[0-9a-f]{64}$/i.test(this.envKey)) throw new Error('DOKUWIKI_TOKEN_KEY must be 64 hex characters.');
			return (this.key = Buffer.from(this.envKey, 'hex'));
		}
		try {
			const existing = fs.readFileSync(this.keyFile, 'utf8').trim();
			if (/^[0-9a-f]{64}$/i.test(existing)) return (this.key = Buffer.from(existing, 'hex'));
		} catch { /* create below */ }
		const fresh = randomBytes(32);
		fs.writeFileSync(this.keyFile, fresh.toString('hex') + '\n', { mode: 0o600, flag: 'wx' });
		return (this.key = fresh);
	}

	private storeKey(username: string) { return `dokuwiki_token:${username}`; }

	get(username: string): string | null {
		const inMemory = this.memory.get(username);
		if (inMemory) return inMemory;
		const stored = this.kv.get(this.storeKey(username));
		if (!stored) return null;
		try {
			const [iv, tag, data] = stored.split(':').map((part) => Buffer.from(part, 'base64'));
			const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey(), iv);
			decipher.setAuthTag(tag);
			const token = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
			this.memory.set(username, token);
			return token;
		} catch {
			console.warn(`Stored DokuWiki token for ${username} could not be decrypted; it must be entered again.`);
			return null;
		}
	}

	status(username: string): { hasToken: boolean; remembered: boolean } {
		const remembered = Boolean(this.kv.get(this.storeKey(username)));
		return { hasToken: Boolean(this.memory.get(username)) || remembered, remembered };
	}

	set(username: string, token: string, remember: boolean) {
		this.memory.set(username, token);
		if (!remember) { this.kv.delete(this.storeKey(username)); return; }
		const iv = randomBytes(12);
		const cipher = createCipheriv('aes-256-gcm', this.encryptionKey(), iv);
		const data = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
		this.kv.set(this.storeKey(username), [iv, cipher.getAuthTag(), data].map((part) => part.toString('base64')).join(':'));
	}

	clear(username: string) {
		this.memory.delete(username);
		this.kv.delete(this.storeKey(username));
	}
}

// ── DokuWiki API ─────────────────────────────────────────────────────────────

export type FailureKind = 'auth' | 'network' | 'other';

export class DokuWikiError extends Error {
	constructor(readonly kind: FailureKind, message: string) { super(message); }
}

function classify(error: unknown): DokuWikiError {
	if (error instanceof DokuWikiError) return error;
	if (error instanceof XmlRpcFault) {
		const auth = [401, 403, -32604].includes(error.code) || /not logged in|forbidden|denied|unauthori[sz]ed|permission|token/i.test(error.message);
		return new DokuWikiError(auth ? 'auth' : 'other', `DokuWiki: ${error.message}`);
	}
	if (error instanceof HttpError) {
		if (error.status === 401 || error.status === 403) return new DokuWikiError('auth', 'DokuWiki rejected the API token.');
		if (error.status === 404) return new DokuWikiError('other', 'The DokuWiki XML-RPC endpoint was not found. Check the wiki URL.');
		return new DokuWikiError(error.status >= 500 || error.status === 429 ? 'network' : 'other', `DokuWiki: ${error.message}`);
	}
	const message = error instanceof Error ? error.message : String(error);
	if (/malformed|did not return/i.test(message)) return new DokuWikiError('other', message);
	// fetch() reports only "fetch failed"; the reason is in its cause.
	const cause = error instanceof Error && error.cause && typeof error.cause === 'object' ? error.cause as { code?: string; message?: string } : undefined;
	const detail = cause?.message ? `${message}: ${cause.message}` : message;
	if (cause?.code && /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS/.test(cause.code)) {
		// Retrying cannot fix an untrusted certificate.
		return new DokuWikiError('other', `DokuWiki's HTTPS certificate is not trusted (${cause.message ?? cause.code}). For a private CA, start the server with NODE_EXTRA_CA_CERTS=/path/to/ca.crt.`);
	}
	return new DokuWikiError('network', `Could not reach DokuWiki: ${detail}`);
}

const methodMissing = (error: unknown) => error instanceof XmlRpcFault && (error.code === -32601 || /does not exist|not found|unknown method/i.test(error.message));

export class DokuWikiApi {
	constructor(private fetcher: FetchLike, private url: string, private token: string) {}

	private call(method: string, params: XmlRpcValue[]) {
		return xmlRpcCall(this.fetcher, this.url, method, params, { Authorization: `Bearer ${this.token}` });
	}

	/** Prefer the current core.* API (token auth needs it); fall back to the legacy names. */
	private async either(core: [string, XmlRpcValue[]], legacy: [string, XmlRpcValue[]]) {
		try { return await this.call(...core); }
		catch (error) { if (methodMissing(error)) return await this.call(...legacy); throw error; }
	}

	async getPage(pageId: string): Promise<string> {
		const value = await this.either(['core.getPage', [pageId, 0]], ['wiki.getPage', [pageId]]);
		return typeof value === 'string' ? value : '';
	}

	async savePage(pageId: string, text: string, summary: string): Promise<void> {
		const ok = await this.either(['core.savePage', [pageId, text, summary, false]], ['wiki.putPage', [pageId, text, { sum: summary, minor: false }]]);
		if (ok === false) throw new DokuWikiError('other', `DokuWiki refused to save ${pageId}.`);
	}

	async whoAmI(): Promise<string | null> {
		try {
			const value = await this.call('core.whoAmI', []);
			return value && typeof value === 'object' && !Array.isArray(value) && typeof value.login === 'string' ? value.login : null;
		} catch (error) {
			if (methodMissing(error)) return null;
			throw error;
		}
	}
}

// ── Writer ───────────────────────────────────────────────────────────────────

type Reason = 'update' | 'timer' | 'manual' | 'startup';

interface Job { plan: PlannedEntry; previous: DokuWikiStatus | null }
interface Outcome { plan: PlannedEntry; status: DokuWikiStatus }

const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 60 * 60_000;
/** Non-network failures are retried on later syncs, at most this often. */
const RESYNC_MIN_MS = 60_000;

/** Repeating the same failure only refreshes timestamps; don't store that. */
function sameStatus(a: DokuWikiStatus | null, b: DokuWikiStatus): boolean {
	if (!a) return false;
	const strip = ({ attemptedAt: _a, writtenAt: _w, ...rest }: DokuWikiStatus) => JSON.stringify(rest);
	return !b.retryable && strip(a) === strip(b);
}

export function retryDelay(attempts: number): number {
	return Math.min(RETRY_BASE_MS * 2 ** Math.max(attempts - 1, 0), RETRY_MAX_MS);
}

/** Which marked items need a write now. Exported for tests. */
export function needsWrite(plan: PlannedEntry, status: DokuWikiStatus | null, reason: Reason, now: number): boolean {
	if (!status || status.requestedAt !== plan.request.requestedAt) return true;
	if (status.state === 'written') return status.hash !== plan.hash;
	if (reason === 'manual') return true;
	if (status.retryable) return !status.nextRetryAt || Date.parse(status.nextRetryAt) <= now;
	return (reason === 'update' || reason === 'startup') && (!status.attemptedAt || now - Date.parse(status.attemptedAt) >= RESYNC_MIN_MS);
}

export interface WriterOptions {
	documents: TaskDocuments;
	tokens: DokuWikiTokens;
	fetcher?: FetchLike;
	debounceMs?: number;
	now?: () => number;
	log?: (message: string) => void;
}

export class DokuWikiWriter {
	private timers = new Map<string, ReturnType<typeof setTimeout>>();
	private retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
	private running = new Map<string, Promise<void>>();
	private pendingReason = new Map<string, Reason>();
	private fetcher: FetchLike;
	private now: () => number;
	private log: (message: string) => void;

	constructor(private options: WriterOptions) {
		this.fetcher = options.fetcher ?? (fetch as unknown as FetchLike);
		this.now = options.now ?? Date.now;
		this.log = options.log ?? ((message) => console.log(message));
	}

	/** Called for every document change. Our own status writes are ignored. */
	onDocumentUpdate(username: string, origin: unknown) {
		if (origin === DOKUWIKI_ORIGIN) return;
		this.schedule(username, 'update');
	}

	schedule(username: string, reason: Reason, delay = this.options.debounceMs ?? 5_000) {
		// A stronger reason wins over a weaker one while waiting.
		const current = this.pendingReason.get(username);
		if (!current || reason === 'manual' || (reason === 'startup' && current !== 'manual')) this.pendingReason.set(username, reason);
		clearTimeout(this.timers.get(username));
		const timer = setTimeout(() => {
			this.timers.delete(username);
			void this.run(username);
		}, delay);
		timer.unref?.();
		this.timers.set(username, timer);
	}

	/** Runs are serialized per user; a request during a run queues one more. */
	run(username: string): Promise<void> {
		const previous = this.running.get(username) ?? Promise.resolve();
		const next = previous.then(async () => {
			const reason = this.pendingReason.get(username) ?? 'update';
			this.pendingReason.delete(username);
			try { await this.process(username, reason); }
			catch (error) { this.log(`DokuWiki writer failed for ${username}: ${error instanceof Error ? error.message : error}`); }
		});
		this.running.set(username, next);
		void next.finally(() => { if (this.running.get(username) === next) this.running.delete(username); });
		return next;
	}

	async process(username: string, reason: Reason): Promise<void> {
		const now = this.now();
		const { settings, jobs } = await this.options.documents.use(username, (doc) => {
			const settings = readDokuWikiSettings(doc as never);
			const jobs: Job[] = [];
			for (const item of doc.getArray<Yjs.Map<unknown>>('items').toArray()) {
				if (!readRequest(item)) continue;
				let plan: PlannedEntry | null;
				try { plan = planEntry(doc as never, settings, item); } catch { plan = null; }
				if (!plan) continue;
				const previous = readStatus(item);
				if (needsWrite(plan, previous, reason, now)) jobs.push({ plan, previous });
			}
			return { settings, jobs };
		});
		if (!jobs.length) return;

		const outcomes: Outcome[] = [];
		const fail = (job: Job, kind: FailureKind | 'auth', message: string) => {
			const sameRequest = job.previous?.requestedAt === job.plan.request.requestedAt && job.previous.state !== 'written';
			const attempts = kind === 'network' ? (sameRequest ? (job.previous!.attempts ?? 0) : 0) + 1 : 1;
			const status: DokuWikiStatus = {
				state: kind === 'auth' ? 'auth' : 'error', requestedAt: job.plan.request.requestedAt, pageId: job.plan.pageId,
				message, retryable: kind === 'network', attempts, attemptedAt: new Date(now).toISOString(),
				...(kind === 'network' ? { nextRetryAt: new Date(now + retryDelay(attempts)).toISOString() } : {}),
				// Keep what was last written, so a fixed error can still update in place.
				...(job.previous?.hash ? { hash: job.previous.hash } : {})
			};
			outcomes.push({ plan: job.plan, status });
		};

		const url = xmlRpcUrl(settings.baseUrl);
		const token = this.options.tokens.get(username);
		if (!url) for (const job of jobs) fail(job, 'other', 'Set the DokuWiki URL in Settings → DokuWiki.');
		else if (!token) for (const job of jobs) fail(job, 'auth', 'DokuWiki API token needed.');
		else {
			const api = new DokuWikiApi(this.fetcher, url, token);
			const byPage = new Map<string, Job[]>();
			for (const job of jobs) byPage.set(job.plan.pageId, [...(byPage.get(job.plan.pageId) ?? []), job]);
			for (const [pageId, pageJobs] of byPage) {
				try {
					outcomes.push(...await this.writePage(api, pageId, pageJobs, now));
				} catch (error) {
					const failure = classify(error);
					for (const job of pageJobs) fail(job, failure.kind, failure.message);
					// A rejected token fails every page the same way.
					if (failure.kind === 'auth') {
						for (const [otherId, others] of byPage) if (otherId !== pageId && !outcomes.some((o) => o.plan.pageId === otherId)) for (const job of others) fail(job, 'auth', failure.message);
						break;
					}
				}
			}
		}

		await this.options.documents.use(username, (doc) => {
			const items = new Map(doc.getArray<Yjs.Map<unknown>>('items').toArray().map((item) => [item.get('id') as string, item]));
			doc.transact(() => {
				for (const { plan, status } of outcomes) {
					const item = items.get(plan.itemId);
					// The user may have stopped or re-marked the item meanwhile.
					if (!item || readRequest(item)?.requestedAt !== plan.request.requestedAt) continue;
					if (sameStatus(readStatus(item), status)) continue;
					item.set(DOKUWIKI_STATUS_KEY, status);
				}
			}, DOKUWIKI_ORIGIN);
		}, true);

		const written = outcomes.filter((o) => o.status.state === 'written').length;
		if (written) this.log(`DokuWiki: wrote ${written} entr${written === 1 ? 'y' : 'ies'} for ${username}.`);
		this.scheduleRetry(username, outcomes);
	}

	/** Read, edit and save one page. Re-reads before saving to avoid
	 * overwriting someone else's edit made in the meantime. */
	private async writePage(api: DokuWikiApi, pageId: string, jobs: Job[], now: number): Promise<Outcome[]> {
		let page = await api.getPage(pageId);
		for (let attempt = 0; attempt < 3; attempt++) {
			let text = page;
			const outcomes: Outcome[] = [];
			let changed = false;
			for (const job of jobs) {
				const result = applyEntry(text, job.plan.heading, job.plan.marker, job.plan.text);
				const base = { requestedAt: job.plan.request.requestedAt, pageId, attemptedAt: new Date(now).toISOString() };
				if (!result.ok) {
					outcomes.push({ plan: job.plan, status: {
						...base, state: 'error', retryable: false, attempts: 1,
						message: result.reason === 'page-missing' ? `Page ${pageId} does not exist.` : `Section "${job.plan.heading}" not found on ${pageId}.`,
						...(job.previous?.hash ? { hash: job.previous.hash } : {})
					} });
					continue;
				}
				text = result.text;
				changed ||= result.action !== 'unchanged';
				outcomes.push({ plan: job.plan, status: { ...base, state: 'written', hash: job.plan.hash, writtenAt: new Date(now).toISOString() } });
			}
			if (!changed) return outcomes;
			const latest = await api.getPage(pageId);
			if (latest !== page) { page = latest; continue; }
			const count = outcomes.filter((o) => o.status.state === 'written').length;
			await api.savePage(pageId, text, `Lists & Prices: ${count} entr${count === 1 ? 'y' : 'ies'}`);
			return outcomes;
		}
		throw new DokuWikiError('network', `${pageId} kept changing while saving; will retry.`);
	}

	private scheduleRetry(username: string, outcomes: Outcome[]) {
		const next = outcomes.map((o) => o.status.nextRetryAt).filter((v): v is string => Boolean(v)).map(Date.parse).sort((a, b) => a - b)[0];
		clearTimeout(this.retryTimers.get(username));
		this.retryTimers.delete(username);
		if (next === undefined) return;
		const timer = setTimeout(() => { this.retryTimers.delete(username); this.schedule(username, 'timer', 0); }, Math.max(next - this.now(), 1_000));
		timer.unref?.();
		this.retryTimers.set(username, timer);
	}

	/** Check the settings and token without writing anything. */
	async test(username: string, date = localDateString()) {
		const settings = await this.options.documents.use(username, (doc) => readDokuWikiSettings(doc as never));
		const url = xmlRpcUrl(settings.baseUrl);
		if (!url) return { ok: false, message: 'Set the DokuWiki URL first.' };
		const token = this.options.tokens.get(username);
		if (!token) return { ok: false, auth: true, message: 'No API token entered.' };
		const pageId = pageIdFor(settings, date);
		const heading = headingFor(settings, date);
		try {
			const api = new DokuWikiApi(this.fetcher, url, token);
			const login = await api.whoAmI();
			const page = await api.getPage(pageId);
			const probe = applyEntry(page, heading, '#\u0000none', 'probe');
			const found = probe.ok ? 'found' : probe.reason === 'page-missing' ? 'page missing' : 'section missing';
			return {
				ok: probe.ok, pageId, heading, login,
				message: `${login ? `Signed in as ${login}. ` : 'Connected. '}Page ${pageId}: ${probe.ok || probe.reason === 'section-missing' ? 'exists' : 'does not exist'}; today's section ${found === 'found' ? 'found' : 'not found'}.`
			};
		} catch (error) {
			const failure = classify(error);
			return { ok: false, auth: failure.kind === 'auth', message: failure.message };
		}
	}
}

// ── HTTP API ─────────────────────────────────────────────────────────────────

export function createDokuWikiRouter(sessions: SessionStore, tokens: DokuWikiTokens, writer: DokuWikiWriter) {
	const router = express.Router();
	router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
	router.use(requireAuth(sessions));
	router.use(express.json({ limit: '16kb' }));
	const user = (res: express.Response) => res.locals.session.username as string;

	router.get('/token', (_req, res) => { res.json(tokens.status(user(res))); });
	router.put('/token', (req, res) => {
		const { token, remember } = req.body ?? {};
		if (typeof token !== 'string' || !token.trim() || token.length > 4096 || /\s/.test(token.trim())) return res.status(400).json({ error: 'Enter the API token.' });
		tokens.set(user(res), token.trim(), remember === true);
		writer.schedule(user(res), 'manual', 0);
		res.json(tokens.status(user(res)));
	});
	router.delete('/token', (_req, res) => {
		tokens.clear(user(res));
		res.json(tokens.status(user(res)));
	});
	router.post('/test', async (req, res) => {
		const date = typeof req.body?.date === 'string' ? req.body.date : undefined;
		try { res.json(await writer.test(user(res), date)); }
		catch (error) { res.status(503).json({ ok: false, message: error instanceof Error ? error.message : 'Test failed.' }); }
	});
	router.post('/run', (_req, res) => {
		writer.schedule(user(res), 'manual', 0);
		res.json({ ok: true });
	});
	return router;
}
