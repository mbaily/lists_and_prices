/**
 * CRUD operations and queries for the Mini Wiki stored in Yjs.
 * All pages are stored in the top-level Y.Map('wiki').
 */
import * as Y from 'yjs';
import { extractWikiLinks, slugifyWikiPage } from './dokuwiki';
import { splitWithTags } from '$lib/tags';

export interface WikiPage {
	id: string; // slug, e.g. "start"
	title: string;
	content: string;
	createdAt: string;
	updatedAt: string;
	lastSummary?: string;
	isMinor?: boolean;
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
	return {
		id: (m.get('id') as string) || 'start',
		title: (m.get('title') as string) || (m.get('id') as string) || 'Untitled',
		content: (m.get('content') as string) || '',
		createdAt: (m.get('createdAt') as string) || new Date().toISOString(),
		updatedAt: (m.get('updatedAt') as string) || new Date().toISOString(),
		lastSummary: (m.get('lastSummary') as string | undefined) ?? '',
		isMinor: (m.get('isMinor') as boolean | undefined) ?? false
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
	doc.transact(() => {
		targetMap.set('title', data.title.trim() || normalizedId);
		targetMap.set('content', data.content);
		targetMap.set('updatedAt', now);
		targetMap.set('lastSummary', data.summary?.trim() ?? '');
		targetMap.set('isMinor', Boolean(data.isMinor));
	});

	return {
		id: normalizedId,
		title: data.title.trim() || normalizedId,
		content: data.content,
		createdAt,
		updatedAt: now,
		lastSummary: data.summary?.trim() ?? '',
		isMinor: Boolean(data.isMinor)
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
		for (const page of allPages) {
			if (page.id === normalizedTarget) continue;
			const links = extractWikiLinks(page.content);
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
