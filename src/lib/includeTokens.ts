export type IncludeToken = {
	type: 'bills' | 'calendar';
	section: string;
	icon: boolean;
	wrap: boolean;
	index: number;
	length: number;
};

export function findIncludeTokens(text: string): IncludeToken[] {
	const tokens: IncludeToken[] = [];
	for (const match of text.matchAll(/\[\[(bills|calendar):([a-z_0-9]+)((?::(?:icon|wrap)){0,2})\]\]/gi)) {
		const options = match[3].toLowerCase().split(':').filter(Boolean);
		if (new Set(options).size !== options.length) continue;
		tokens.push({
			type: match[1].toLowerCase() === 'bills' ? 'bills' : 'calendar',
			section: match[2].toLowerCase(),
			icon: options.includes('icon'),
			wrap: options.includes('wrap'),
			index: match.index,
			length: match[0].length
		});
	}
	return tokens;
}
