/**
 * Hashtag utilities — shared between HomeScreen and ListScreen.
 * Tags are stored inline in item/list/folder names as #word tokens.
 */

const TAG_RE = /#(\w+)/g;

/** Extract all hashtag values (lowercase, without #) from a name string. */
export function extractTags(name: string): string[] {
	return [...name.matchAll(TAG_RE)].map((m) => m[1].toLowerCase());
}

export type NameSegment = { type: 'text' | 'url' | 'tag' | 'item-ref' | 'list-ref' | 'folder-ref'; value: string };

/**
 * Split a name string into text, URL, hashtag, and internal-ref segments for inline rendering.
 * Internal refs use the syntax [[item:UUID]], [[list:UUID]], [[folder:UUID]].
 * URLs are matched before # so a URL containing # isn't misread as a tag.
 */
export function splitWithTags(name: string): NameSegment[] {
	const combined = /\[\[(item|list|folder):([^\]]+)\]\]|https?:\/\/[^\s]+|#\w+/g;
	const result: NameSegment[] = [];
	let last = 0;
	let m: RegExpExecArray | null;
	while ((m = combined.exec(name)) !== null) {
		if (m.index > last) result.push({ type: 'text', value: name.slice(last, m.index) });
		if (m[1]) {
			// [[item:UUID]], [[list:UUID]], or [[folder:UUID]]
			const ns = m[1];
			const id = m[2];
			if (ns === 'item') result.push({ type: 'item-ref', value: id });
			else if (ns === 'list') result.push({ type: 'list-ref', value: id });
			else result.push({ type: 'folder-ref', value: id });
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
