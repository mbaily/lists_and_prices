export type SearchMode = 'phrase' | 'and' | 'or';

export interface SavedSearch {
	id: string;
	query: string;
	mode: SearchMode;
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
