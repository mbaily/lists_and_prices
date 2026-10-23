import { createRequire } from 'node:module';
import https from 'node:https';
import WebSocket from 'ws';
import type { Doc } from 'yjs';
import { encodeSyncMessage, decodeSyncMessage } from '../src/lib/syncProtocol.ts';
import type { LocalStorage } from './local-storage.ts';

const require = createRequire(import.meta.url);
const Y = require('yjs') as typeof import('yjs');
const { WebsocketProvider } = require('y-websocket') as typeof import('y-websocket');

/** Keep the certificate override on upstream requests, without changing Node's
 * process-wide TLS policy or any browser's connection to the local frontend. */
function upstreamFetch(url: string, options: { method?: string; headers?: Record<string, string>; body?: string | Uint8Array<ArrayBuffer>; signal: AbortSignal }, insecure = false): Promise<Response> {
	if (!insecure || new URL(url).protocol !== 'https:') return fetch(url, { ...options, redirect: 'error' });
	return new Promise((resolve, reject) => {
		const request = https.request(url, { method: options.method, headers: options.headers, signal: options.signal, rejectUnauthorized: false }, response => {
			void (async () => {
				const status = response.statusCode ?? 500;
				if (status >= 300 && status < 400) { response.resume(); throw new Error('Upstream redirects are not allowed.'); }
				const chunks: Buffer[] = [];
				for await (const chunk of response) chunks.push(Buffer.from(chunk));
				const headers = new Headers();
				for (let index = 0; index < response.rawHeaders.length; index += 2) headers.append(response.rawHeaders[index], response.rawHeaders[index + 1]);
				resolve(new Response([204, 205].includes(status) ? null : new Uint8Array(Buffer.concat(chunks)), { status, headers }));
			})().catch(reject);
		});
		request.once('error', reject);
		request.end(options.body);
	});
}

export function normalizeUpstream(value: string) {
	const url = new URL(value);
	if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
		throw new Error('Server must be an HTTP(S) URL without credentials, query or fragment.');
	}
	return url.href.replace(/\/+$/, '');
}

export async function loginUpstream(server: string, username: string, password: string, insecure = false) {
	const response = await upstreamFetch(`${server}/api/login`, {
		method: 'POST', headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ username, password }), signal: AbortSignal.timeout(30_000)
	}, insecure);
	if (!response.ok) throw new Error(`Upstream sign-in failed (HTTP ${response.status}).`);
	// Subpath deployments clear the old root cookie before setting the new
	// scoped session. Never use that empty deletion cookie as the credential.
	const cookiePrefix = 'prices_n_lists_session=';
	const cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).reverse()
		.find(value => value.startsWith(cookiePrefix) && value.length > cookiePrefix.length);
	if (!cookie) throw new Error('Upstream did not return a session cookie.');
	const session = await upstreamFetch(`${server}/api/session`, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(30_000) }, insecure);
	if (!session.ok) throw new Error(`Upstream session verification failed (HTTP ${session.status}).`);
	if ((await session.json()).username !== username) throw new Error('Upstream session does not match this account.');
	return cookie;
}

/** WebSocket updates provide prompt replication; HTTP exchanges confirm storage.
 * Local disk revisions track deletion-only edits as well as inserted structs. */
export class UpstreamSync {
	readonly provider: InstanceType<typeof WebsocketProvider>;
	private timer: ReturnType<typeof setInterval> | undefined;
	private running: Promise<void> | undefined;
	private controller: AbortController | undefined;
	private stopped = false;
	private needsLogin = false;
	private error: string | null = null;
	private lastSyncAt: number | null;
	constructor(private readonly options: { server: string; username: string; cookie: string; doc: Doc; storage: LocalStorage; insecure?: boolean; intervalMs?: number; onStatus?: () => void }) {
		this.lastSyncAt = Number(options.storage.get('lastSyncAt')) || null;
		const cookie = options.cookie;
		class CookieSocket extends WebSocket {
			// Match browser receivers: the upstream can send a full historical
			// document larger than its 64 MiB limit on individual HTTP uploads.
			constructor(url: string) { super(url, { headers: { Cookie: cookie }, maxPayload: 0, rejectUnauthorized: !options.insecure }); }
		}
		this.provider = new WebsocketProvider(options.server.replace(/^http/, 'ws') + '/yjs', `pnl-${options.username}`, options.doc, {
			// ws implements the provider's runtime surface; its declarations do not
			// include the browser-only dispatchEvent method in DOM WebSocket types.
			WebSocketPolyfill: CookieSocket as unknown as typeof globalThis.WebSocket, disableBc: true, connect: false
		});
		this.provider.awareness.setLocalState(null);
	}
	get status() {
		return { target: 'laptop', upstream: this.options.server, username: this.options.username,
			pending: this.options.storage.get('ackRevision') !== String(this.options.storage.revision),
			lastSyncAt: this.lastSyncAt,
			needsLogin: this.needsLogin, error: this.error, connected: this.provider.wsconnected };
	}
	start() {
		this.provider.connect();
		void this.sync();
		this.timer = setInterval(() => { void this.sync(); }, this.options.intervalMs ?? 5000);
	}
	sync(): Promise<void> {
		if (this.running) return this.running;
		if (this.stopped) return Promise.resolve();
		if (this.needsLogin) { this.maintainStorage(); return Promise.resolve(); }
		this.running = this.exchange().finally(() => { this.running = undefined; });
		return this.running;
	}
	private async exchange() {
		const { server, username, cookie, doc, storage } = this.options;
		const controller = new AbortController();
		this.controller = controller;
		const timeout = setTimeout(() => controller.abort(), 30_000);
		const request = async (route: string, vector: Uint8Array, update?: Uint8Array) => {
			const response = await upstreamFetch(server + route, { method: 'POST',
				headers: { Cookie: cookie, 'Content-Type': 'application/octet-stream' },
				body: encodeSyncMessage(username, vector, update), signal: controller.signal }, this.options.insecure);
			if ([401, 403, 409].includes(response.status)) {
				this.needsLogin = true;
				this.provider.disconnect();
				throw new Error('Upstream sign-in required. Restart with --login; local access and data are retained.');
			}
			if (!response.ok) throw new Error(`Upstream sync failed (HTTP ${response.status}).`);
			const bytes = new Uint8Array(await response.arrayBuffer());
			const message = decodeSyncMessage(bytes);
			if (message.username !== username) throw new Error('Upstream returned a different account.');
			return message;
		};
		try {
			const remote = await request('/api/sync/state', Y.encodeStateVector(doc));
			if (this.stopped) return;
			Y.applyUpdate(doc, remote.update, this);
			const revision = storage.revision;
			const result = await request('/api/sync', Y.encodeStateVector(doc), Y.encodeStateAsUpdate(doc, remote.vector));
			if (this.stopped) return;
			const unchanged = storage.revision === revision;
			Y.applyUpdate(doc, result.update, this);
			if (unchanged && Buffer.from(Y.encodeStateVector(doc)).equals(Buffer.from(result.vector))) {
				const acknowledgedRevision = String(storage.revision), confirmedAt = Date.now();
				if (storage.get('ackRevision') !== acknowledgedRevision) {
					storage.db.transaction(() => {
						storage.set('ackRevision', acknowledgedRevision);
						storage.set('lastSyncAt', String(confirmedAt));
					})();
				}
				this.lastSyncAt = confirmedAt;
			}
			this.error = null;
		} catch (error) {
			if (!this.stopped) this.error = error instanceof Error ? error.message : 'Upstream unavailable.';
		} finally {
			clearTimeout(timeout);
			this.controller = undefined;
			this.maintainStorage();
		}
	}
	private maintainStorage() {
		try { this.options.storage.compact(); }
		catch { this.error = 'Could not consolidate local updates; original updates are retained. Check disk space and permissions.'; }
		this.options.onStatus?.();
	}
	async close() {
		this.stopped = true;
		clearInterval(this.timer);
		this.controller?.abort();
		this.provider.destroy();
		await this.running;
	}
}
