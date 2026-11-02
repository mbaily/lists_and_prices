/**
 * CRUD operations and queries for the Mini Wiki stored in Yjs.
 * All pages are stored in the top-level Y.Map('wiki').
 */
import * as Y from 'yjs';
import { extractWikiLinks, slugifyWikiPage } from './dokuwiki';
import { thinRevisions, type WikiRevision } from './revisions';
import { splitWithTags } from '$lib/tags';

export type { WikiRevision } from './revisions';

export interface WikiPage {
	id: string; // slug, e.g. "start"
	title: string;
	content: string;
	createdAt: string;
	updatedAt: string;
	lastSummary?: string;
	isMinor?: boolean;
	revisions?: WikiRevision[];
}

export interface BacklinksResult {
	wikiPages: { id: string; title: string }[];
	items: { id: string; name: string; listId: string; isNote: boolean }[];
}

/** Returns the top-level Y.Map holding all wiki pages. */
export function getWiki(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
	return doc.getMap('wiki');
}

function yMapToWikiPage(m: Y.Map<unknown>): WikiPage {
	let revisions: WikiRevision[] = [];
	const rawRevs = m.get('revisions');
	if (typeof rawRevs === 'string') {
		try {
			revisions = JSON.parse(rawRevs);
		} catch {}
	} else if (Array.isArray(rawRevs)) {
		revisions = rawRevs as WikiRevision[];
	}

	return {
		id: (m.get('id') as string) || 'start',
		title: (m.get('title') as string) || (m.get('id') as string) || 'Untitled',
		content: (m.get('content') as string) || '',
		createdAt: (m.get('createdAt') as string) || new Date().toISOString(),
		updatedAt: (m.get('updatedAt') as string) || new Date().toISOString(),
		lastSummary: (m.get('lastSummary') as string | undefined) ?? '',
		isMinor: (m.get('isMinor') as boolean | undefined) ?? false,
		revisions
	};
}

/**
 * Read all wiki pages from the Y.Doc.
 */
export function readWikiPages(doc: Y.Doc): WikiPage[] {
	try {
		const wikiMap = getWiki(doc);
		const pages: WikiPage[] = [];
		wikiMap.forEach((val) => {
			if (val instanceof Y.Map) {
				pages.push(yMapToWikiPage(val));
			}
		});
		// Sort by title alphabetically
		return pages.sort((a, b) => a.title.localeCompare(b.title));
	} catch {
		return [];
	}
}

/**
 * Read a single wiki page by ID (slug).
 */
export function readWikiPage(doc: Y.Doc, id: string): WikiPage | null {
	try {
		const normalizedId = slugifyWikiPage(id);
		const wikiMap = getWiki(doc);
		const pageMap = wikiMap.get(normalizedId);
		if (pageMap instanceof Y.Map) {
			return yMapToWikiPage(pageMap);
		}
		return null;
	} catch {
		return null;
	}
}

/**
 * Create or save changes to a wiki page.
 * Automatically saves previous version to revisions and applies thinning over time.
 */
export function saveWikiPage(
	doc: Y.Doc,
	id: string,
	data: { title: string; content: string; summary?: string; isMinor?: boolean }
): WikiPage {
	const normalizedId = slugifyWikiPage(id);
	const wikiMap = getWiki(doc);
	const now = new Date().toISOString();

	let pageMap = wikiMap.get(normalizedId);
	let createdAt = now;

	if (!(pageMap instanceof Y.Map)) {
		const newPageMap = new Y.Map<unknown>();
		doc.transact(() => {
			newPageMap.set('id', normalizedId);
			newPageMap.set('createdAt', createdAt);
			wikiMap.set(normalizedId, newPageMap);
		});
		pageMap = newPageMap;
	} else {
		createdAt = (pageMap.get('createdAt') as string) || now;
	}

	const targetMap = pageMap as Y.Map<unknown>;
	const prevContent = (targetMap.get('content') as string) || '';
	const prevTitle = (targetMap.get('title') as string) || normalizedId;
	const prevSummary = (targetMap.get('lastSummary') as string) || '';
	const prevIsMinor = Boolean(targetMap.get('isMinor'));
	const prevUpdatedAt = (targetMap.get('updatedAt') as string) || createdAt;

	let thinnedRevs: WikiRevision[] = [];
	const rawRevs = targetMap.get('revisions');
	if (typeof rawRevs === 'string') {
		try {
			thinnedRevs = JSON.parse(rawRevs);
		} catch {}
	} else if (Array.isArray(rawRevs)) {
		thinnedRevs = [...rawRevs];
	}

	// If page previously had content and was modified, record a snapshot in revisions
	if (prevContent.trim() && (prevContent !== data.content || prevTitle !== data.title.trim())) {
		const newRev: WikiRevision = {
			timestamp: prevUpdatedAt,
			title: prevTitle,
			content: prevContent,
			summary: prevSummary,
			isMinor: prevIsMinor
		};
		thinnedRevs.push(newRev);
		thinnedRevs = thinRevisions(thinnedRevs, new Date(now));
	}

	doc.transact(() => {
		targetMap.set('title', data.title.trim() || normalizedId);
		targetMap.set('content', data.content);
		targetMap.set('updatedAt', now);
		targetMap.set('lastSummary', data.summary?.trim() ?? '');
		targetMap.set('isMinor', Boolean(data.isMinor));
		targetMap.set('revisions', JSON.stringify(thinnedRevs));
	});

	return {
		id: normalizedId,
		title: data.title.trim() || normalizedId,
		content: data.content,
		createdAt,
		updatedAt: now,
		lastSummary: data.summary?.trim() ?? '',
		isMinor: Boolean(data.isMinor),
		revisions: thinnedRevs
	};
}

/**
 * Delete a wiki page by slug.
 */
export function deleteWikiPage(doc: Y.Doc, id: string): boolean {
	const normalizedId = slugifyWikiPage(id);
	const wikiMap = getWiki(doc);
	if (wikiMap.has(normalizedId)) {
		doc.transact(() => {
			wikiMap.delete(normalizedId);
		});
		return true;
	}
	return false;
}

/**
 * Find backlinks pointing to targetSlug from other wiki pages and items/notes.
 */
export function findWikiBacklinks(doc: Y.Doc, targetSlug: string): BacklinksResult {
	const normalizedTarget = slugifyWikiPage(targetSlug);
	const result: BacklinksResult = { wikiPages: [], items: [] };

	try {
		// 1. Backlinks from other wiki pages
		const allPages = readWikiPages(doc);
		const allSlugs = new Set(allPages.map((p) => p.id));
		for (const page of allPages) {
			if (page.id === normalizedTarget) continue;
			const links = extractWikiLinks(page.content, page.id, (s) => allSlugs.has(s));
			if (links.some((l) => l.type === 'wiki' && l.target === normalizedTarget)) {
				result.wikiPages.push({ id: page.id, title: page.title });
			}
		}

		// 2. Backlinks from todos and subnotes
		const itemsArray = doc.getArray<Y.Map<unknown>>('items');
		itemsArray.forEach((itemMap) => {
			const name = (itemMap.get('name') as string) || '';
			const parts = splitWithTags(name);
			const hasWikiRef = parts.some((p) => p.type === 'wiki-ref' && slugifyWikiPage(p.value) === normalizedTarget);
			if (hasWikiRef) {
				result.items.push({
					id: itemMap.get('id') as string,
					name,
					listId: itemMap.get('listId') as string,
					isNote: Boolean(itemMap.get('isNote'))
				});
			}
		});
	} catch {
		// Ignore errors during history / teardown
	}

	return result;
}
