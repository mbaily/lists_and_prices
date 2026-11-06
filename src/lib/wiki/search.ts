/**
 * Full-text search and inverted index for the Mini Wiki.
 * Supports:
 * - Multi-term queries (AND/OR scoring)
 * - Title, namespace/slug, and body text matching
 * - Relevance scoring with exact & prefix bonuses
 * - Contextual snippet extraction with highlighted terms (<mark>)
 */

import type { WikiPage } from './data';
import { getNamespace } from './namespaces';

export interface WikiSearchResult {
	id: string;
	title: string;
	namespace: string;
	score: number;
	snippet?: string;
	matchType: 'title' | 'id' | 'content';
}

function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeHtml(str: string): string {
	return str
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/**
 * Tokenize a search query into clean keywords.
 */
export function tokenizeQuery(query: string): string[] {
	return query
		.toLowerCase()
		.split(/[^a-z0-9_-]+/)
		.map((t) => t.trim())
		.filter((t) => t.length > 0);
}

/**
 * Generate a contextual snippet containing matching terms with <mark> tags.
 */
export function generateSnippet(
	content: string,
	terms: string[],
	windowRadius = 45
): string | undefined {
	if (!content || terms.length === 0) return undefined;

	// Strip code block and markup tags for clean snippet text
	const plain = content
		.replace(/<(code|file)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
		.replace(/={2,6}\s*(.+?)\s*={2,6}/g, '$1')
		.replace(/\[\[([^\|\]]+)(?:\|([^\]]+))?\]\]/g, '$2 $1')
		.replace(/[\*\_\'\/]{2,}/g, '')
		.replace(/\s+/g, ' ')
		.trim();

	const plainLower = plain.toLowerCase();

	// Find the earliest matching term
	let firstIndex = -1;
	let matchedTerm = '';

	for (const term of terms) {
		const idx = plainLower.indexOf(term);
		if (idx !== -1 && (firstIndex === -1 || idx < firstIndex)) {
			firstIndex = idx;
			matchedTerm = term;
		}
	}

	if (firstIndex === -1) {
		// No terms found in body, return beginning of plain text if available
		if (plain.length === 0) return undefined;
		const excerpt = plain.slice(0, windowRadius * 2);
		return escapeHtml(excerpt) + (plain.length > windowRadius * 2 ? '…' : '');
	}

	const start = Math.max(0, firstIndex - windowRadius);
	const end = Math.min(plain.length, firstIndex + matchedTerm.length + windowRadius);

	let excerpt = plain.slice(start, end);
	if (start > 0) excerpt = '…' + excerpt;
	if (end < plain.length) excerpt = excerpt + '…';

	let escaped = escapeHtml(excerpt);

	// Highlight terms
	for (const term of terms) {
		if (!term) continue;
		const regex = new RegExp(`(${escapeRegex(term)})`, 'gi');
		escaped = escaped.replace(regex, '<mark class="wiki-search-match">$1</mark>');
	}

	return escaped;
}

/**
 * Search wiki pages by full-text query.
 */
export function searchWikiPages(pages: WikiPage[], rawQuery: string): WikiSearchResult[] {
	const query = rawQuery.trim();
	if (!query) return [];

	const terms = tokenizeQuery(query);
	if (terms.length === 0) return [];

	const results: WikiSearchResult[] = [];

	for (const page of pages) {
		const title = page.title || page.id;
		const titleLower = title.toLowerCase();
		const idLower = page.id.toLowerCase();
		const contentLower = page.content.toLowerCase();
		const ns = getNamespace(page.id);

		let score = 0;
		let termsMatched = 0;
		let matchType: 'title' | 'id' | 'content' = 'content';

		// Exact full phrase bonus
		const queryLower = query.toLowerCase();
		if (titleLower === queryLower) {
			score += 100;
			matchType = 'title';
		} else if (titleLower.includes(queryLower)) {
			score += 50;
			matchType = 'title';
		}

		for (const term of terms) {
			let termMatched = false;

			// Title match
			if (titleLower.includes(term)) {
				score += 30;
				if (titleLower.startsWith(term)) score += 10;
				termMatched = true;
				matchType = 'title';
			}

			// ID / namespace match
			if (idLower.includes(term)) {
				score += 15;
				termMatched = true;
				if (matchType !== 'title') matchType = 'id';
			}

			// Body content match
			if (contentLower.includes(term)) {
				// Count occurrences (capped at 10 to avoid biasing huge pages)
				let count = 0;
				let pos = 0;
				while ((pos = contentLower.indexOf(term, pos)) !== -1 && count < 10) {
					count++;
					pos += term.length;
				}
				score += count * 3;
				termMatched = true;
			}

			if (termMatched) {
				termsMatched++;
			}
		}

		// Require at least one matching term
		if (score > 0 && termsMatched > 0) {
			// Multi-term coverage bonus: prefer pages matching all search words
			if (termsMatched === terms.length && terms.length > 1) {
				score += 40;
			}

			const snippet = generateSnippet(page.content, terms);
			results.push({
				id: page.id,
				title,
				namespace: ns,
				score,
				snippet,
				matchType
			});
		}
	}

	// Sort highest score first, then alphabetical title
	results.sort((a, b) => {
		if (b.score !== a.score) return b.score - a.score;
		return a.title.localeCompare(b.title);
	});

	return results;
}
