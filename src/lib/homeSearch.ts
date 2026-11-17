export type SearchMode = 'phrase' | 'and' | 'or';

export interface SavedSearch {
	id: string;
	name: string;
	query: string;
	mode: SearchMode;
	uncheckedOnly: boolean;
	includeUnfinishedListItems: boolean;
}

export function restoreSavedSearches(value: unknown): SavedSearch[] {
	if (!Array.isArray(value)) return [];
	const searches: SavedSearch[] = [];
	for (const entry of value) {
		if (!entry || typeof entry !== 'object') continue;
		const { id, name, query, mode, uncheckedOnly, includeUnfinishedListItems } = entry;
		if (typeof id !== 'string' || typeof query !== 'string' || !query.trim()) continue;
		if (mode !== 'phrase' && mode !== 'and' && mode !== 'or') continue;
		searches.push({
			id, name: (typeof name === 'string' && name.trim()) || query.trim(), query, mode,
			uncheckedOnly: uncheckedOnly === true,
			includeUnfinishedListItems: includeUnfinishedListItems === true
		});
	}
	return searches;
}

export function createSearchMatcher(query: string, mode: SearchMode): ((name: string) => boolean) | null {
	const text = query.trim().toLowerCase();
	if (!text) return null;
	if (mode === 'phrase') return (name) => name.toLowerCase().includes(text);

	const terms = text.split(/\s+/);
	return (name) => {
		const normalized = name.toLowerCase();
		const includesTerm = (term: string) => normalized.includes(term);
		return mode === 'and' ? terms.every(includesTerm) : terms.some(includesTerm);
	};
}
