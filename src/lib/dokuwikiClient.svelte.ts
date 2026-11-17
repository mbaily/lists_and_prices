/**
 * Browser side of the DokuWiki writer: marking items, the synced settings and
 * the server's token API. The server does the actual writing.
 */
import * as Y from 'yjs';
import { getDoc, getMutableDoc, getItems } from './yjsStore.svelte';
import { appUrl } from './urls';
import {
	DOKUWIKI_EDITING_MAP, DOKUWIKI_EDITING_ORIGIN, DOKUWIKI_EDITING_TTL_MS, DOKUWIKI_REQUEST_KEY, DOKUWIKI_SETTINGS_MAP, DOKUWIKI_STATUS_KEY, DEFAULT_DOKUWIKI_SETTINGS,
	badgeFor, localDateString, pageUrl, planEntry, readDokuWikiSettings, readStatus,
	type DokuWikiBadge, type DokuWikiEditHold, type DokuWikiRequest, type DokuWikiSettings, type DokuWikiStatus
} from './dokuwikiWriter';

/** Shared UI state, so any screen can open the one token dialog. */
export const dokuwikiUi = $state<{ tokenDialogOpen: boolean; tokenReason: string }>({ tokenDialogOpen: false, tokenReason: '' });

export function openTokenDialog(reason = '') {
	dokuwikiUi.tokenReason = reason;
	dokuwikiUi.tokenDialogOpen = true;
}

function findItem(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
	return getItems(doc).toArray().find((item) => item.get('id') === id);
}

// ── Settings (in the Yjs document, so the server and every device see them) ──

export function readSettings(): DokuWikiSettings {
	try { return readDokuWikiSettings(getDoc() as never); }
	catch { return { ...DEFAULT_DOKUWIKI_SETTINGS }; }
}

export function saveSettings(patch: Partial<DokuWikiSettings>) {
	const doc = getMutableDoc();
	const map = doc.getMap<string>(DOKUWIKI_SETTINGS_MAP);
	doc.transact(() => {
		for (const [key, value] of Object.entries(patch)) {
			if (typeof value !== 'string') continue;
			if (key !== 'baseUrl' && (!value.trim() || value === DEFAULT_DOKUWIKI_SETTINGS[key as keyof DokuWikiSettings])) map.delete(key);
			else if (map.get(key) !== value) map.set(key, value);
		}
	});
}

export function isConfigured(): boolean {
	return Boolean(readSettings().baseUrl.trim());
}

// ── Edit holds ───────────────────────────────────────────────────────────────

/** Tell the server writer an item is open in an editor whose keystrokes reach
 * the document live, so half-typed text is never written to the wiki.
 * Returns the release function: call it on save, cancel or close. The hold is
 * renewed while open and lapses on its own if the page goes away. */
export function holdForEditing(itemId: string): () => void {
	if (!isConfigured()) return () => {};
	let doc: Y.Doc;
	try { doc = getMutableDoc(); } catch { return () => {}; }
	const key = crypto.randomUUID();
	const map = doc.getMap<DokuWikiEditHold>(DOKUWIKI_EDITING_MAP);
	const renew = () => doc.transact(() => {
		const now = Date.now();
		// Clear lapsed holds left by closed tabs.
		for (const [other, hold] of map.entries()) if (other !== key && !(Date.parse(hold?.expiresAt) > now)) map.delete(other);
		map.set(key, { itemId, expiresAt: new Date(now + DOKUWIKI_EDITING_TTL_MS).toISOString() });
	}, DOKUWIKI_EDITING_ORIGIN);
	renew();
	const timer = setInterval(renew, DOKUWIKI_EDITING_TTL_MS / 3);
	let released = false;
	return () => {
		if (released) return;
		released = true;
		clearInterval(timer);
		if (map.has(key)) doc.transact(() => map.delete(key), DOKUWIKI_EDITING_ORIGIN);
	};
}

// ── Marking items ────────────────────────────────────────────────────────────

export function markItem(itemId: string, options: { newPage?: boolean; date?: string } = {}) {
	const doc = getMutableDoc();
	const item = findItem(doc, itemId);
	if (!item) return;
	const request: DokuWikiRequest = { date: options.date ?? localDateString(), requestedAt: new Date().toISOString(), ...(options.newPage ? { newPage: true } : {}) };
	doc.transact(() => item.set(DOKUWIKI_REQUEST_KEY, request));
}

/** A new requestedAt makes the server try again, keeping the original date. */
export function retryItem(itemId: string) {
	const doc = getMutableDoc();
	const item = findItem(doc, itemId);
	const current = item?.get(DOKUWIKI_REQUEST_KEY) as DokuWikiRequest | undefined;
	if (!item || !current) return;
	doc.transact(() => item.set(DOKUWIKI_REQUEST_KEY, { ...current, requestedAt: new Date().toISOString() }));
	void runNow();
}

/** Switch an already marked item between a plain line and a new-page link.
 * The entry's text changes, so the server rewrites the line in place. */
export function setNewPage(itemId: string, newPage: boolean) {
	const doc = getMutableDoc();
	const item = findItem(doc, itemId);
	const current = item?.get(DOKUWIKI_REQUEST_KEY) as DokuWikiRequest | undefined;
	if (!item || !current) return;
	const { newPage: _old, ...rest } = current;
	doc.transact(() => item.set(DOKUWIKI_REQUEST_KEY, newPage ? { ...rest, newPage: true } : rest));
}

/** Stop syncing the item. Text already in the wiki is left alone. */
export function stopItem(itemId: string) {
	const doc = getMutableDoc();
	const item = findItem(doc, itemId);
	if (!item) return;
	doc.transact(() => {
		item.delete(DOKUWIKI_REQUEST_KEY);
		item.delete(DOKUWIKI_STATUS_KEY);
	});
}

export interface ItemBadge { badge: DokuWikiBadge; status: DokuWikiStatus | null; title: string; href: string | null }

const LABELS: Record<DokuWikiBadge, string> = {
	pending: 'Waiting to be written to DokuWiki',
	written: 'Written to DokuWiki',
	error: 'DokuWiki write failed',
	auth: 'DokuWiki API token needed'
};

export function itemBadge(itemId: string): ItemBadge | null {
	let doc: Y.Doc;
	try { doc = getDoc(); } catch { return null; }
	const item = findItem(doc, itemId);
	if (!item?.get(DOKUWIKI_REQUEST_KEY)) return null;
	const settings = readDokuWikiSettings(doc as never);
	let plan;
	try { plan = planEntry(doc as never, settings, item); } catch { plan = null; }
	const status = readStatus(item);
	const badge = badgeFor(plan, status);
	if (!badge || !plan) return null;
	const detail = status?.message && badge !== 'written' && badge !== 'pending' ? `: ${status.message}` : '';
	return {
		badge, status,
		title: `${LABELS[badge]}${detail} (${plan.pageId}, ${plan.request.date})`,
		href: pageUrl(settings.baseUrl, plan.pageId, status?.pageId === plan.pageId ? status.anchor : null)
	};
}

// ── Token API (served only by the main server) ──────────────────────────────

export interface TokenStatus { hasToken: boolean; remembered: boolean }

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
	let res: Response;
	try {
		res = await fetch(appUrl(`/api/dokuwiki${path}` as `/${string}`), {
			...init,
			headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
			credentials: 'same-origin'
		});
	} catch {
		throw new Error('The server is not reachable. Try again when online.');
	}
	const body = await res.json().catch(() => ({}));
	if (res.status === 404) throw new Error('This server does not handle DokuWiki. Use the main server, not the laptop client.');
	if (!res.ok) throw new Error(body.error ?? body.message ?? `Request failed (${res.status})`);
	return body as T;
}

export const getTokenStatus = () => api<TokenStatus>('/token');
export const saveToken = (token: string, remember: boolean) => api<TokenStatus>('/token', { method: 'PUT', body: JSON.stringify({ token, remember }) });
export const clearToken = () => api<TokenStatus>('/token', { method: 'DELETE' });
export const testConnection = () => api<{ ok: boolean; auth?: boolean; message: string; pageId?: string; heading?: string }>('/test', { method: 'POST', body: JSON.stringify({ date: localDateString() }) });
export async function runNow() { try { await api('/run', { method: 'POST', body: '{}' }); } catch { /* sync will trigger it */ } }

/** After marking: ask for the token if the server has none. Offline is fine;
 * the server picks the item up when it syncs and the badge will show 🔑. */
export async function promptForTokenIfMissing() {
	try {
		const status = await getTokenStatus();
		if (!status.hasToken) openTokenDialog('The server needs your DokuWiki API token to write marked items.');
	} catch { /* offline or laptop client */ }
}
