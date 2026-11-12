/**
 * Hashtag utilities — shared between HomeScreen and ListScreen.
 * Tags are stored inline in item/list/folder names as #word tokens.
 */

const TAG_RE = /(?<=^|\s)#(\w+)/g;

/** Extract all hashtag values (lowercase, without #) from a name string. */
export function extractTags(name: string): string[] {
	return [...name.matchAll(TAG_RE)].map((m) => m[1].toLowerCase());
}

/** Split imported plain text using the same hashtag boundaries as errand matching. */
export function splitHashtags(text: string): { type: 'text' | 'tag'; value: string }[] {
	const parts: { type: 'text' | 'tag'; value: string }[] = [];
	let last = 0;
	for (const match of text.matchAll(TAG_RE)) {
		if (match.index > last) parts.push({ type: 'text', value: text.slice(last, match.index) });
		parts.push({ type: 'tag', value: match[0] });
		last = match.index + match[0].length;
	}
	if (last < text.length) parts.push({ type: 'text', value: text.slice(last) });
	return parts;
}

export type NameSegment = {
	type: 'text' | 'url' | 'tag' | 'item-ref' | 'list-ref' | 'folder-ref' | 'wiki-ref';
	value: string;
	label?: string;
};

/**
 * Split a name string into text, URL, hashtag, and internal-ref segments for inline rendering.
 * Internal refs use the syntax [[item:UUID]], [[list:UUID]], [[folder:UUID]], [[wiki:slug]].
 * URLs are matched before # so a URL containing # isn't misread as a tag.
 */
export function splitWithTags(name: string): NameSegment[] {
	const combined = /\[\[(item|list|folder|wiki):([^\]]+)\]\]|https?:\/\/[^\s]+(?<![.,!?;:'")])|#\w+/g;
	const result: NameSegment[] = [];
	let last = 0;
	let m: RegExpExecArray | null;
	while ((m = combined.exec(name)) !== null) {
		if (m.index > last) result.push({ type: 'text', value: name.slice(last, m.index) });
		if (m[1]) {
			// [[item:UUID]], [[list:UUID]], [[folder:UUID]], or [[wiki:slug]]
			const ns = m[1];
			const raw = m[2];
			const pipeIdx = raw.indexOf('|');
			const id = (pipeIdx !== -1 ? raw.slice(0, pipeIdx) : raw).trim();
			const label = pipeIdx !== -1 ? raw.slice(pipeIdx + 1).trim() : undefined;

			if (ns === 'item') result.push({ type: 'item-ref', value: id, ...(label ? { label } : {}) });
			else if (ns === 'list') result.push({ type: 'list-ref', value: id, ...(label ? { label } : {}) });
			else if (ns === 'folder') result.push({ type: 'folder-ref', value: id, ...(label ? { label } : {}) });
			else result.push({ type: 'wiki-ref', value: id, ...(label ? { label } : {}) });
		} else if (m[0].startsWith('#')) {
			result.push({ type: 'tag', value: m[0] });
		} else {
			result.push({ type: 'url', value: m[0] });
		}
		last = m.index + m[0].length;
	}
	if (last < name.length) result.push({ type: 'text', value: name.slice(last) });
	return result.length ? result : [{ type: 'text', value: name }];
}
