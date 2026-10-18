// Pure matching logic is shared with the deployed server's task endpoint.
export { importNameKey } from '../../server/import-text.ts';

export interface ClipboardTodo {
	id: string;
	name: string;
	checked: boolean;
	parentId: string | null;
}

/** Recognize a consistent multiline checklist, leaving ambiguous text alone. */
export function parseClipboardTodos(text: string): ClipboardTodo[] | null {
	const lines = text.split(/\r\n?|\n/).filter((line) => line.trim());
	if (lines.length < 2) return null;
	const matches = lines.map((line) => /^(\s*)\[([ xXcC])\][ \t]+(\S.*)$/.exec(line.trimEnd()));
	if (matches.some((match) => !match)) return null;

	const items: ClipboardTodo[] = [];
	const ancestors: { indent: number; id: string; cancelled: boolean }[] = [];
	for (const [index, match] of matches.entries()) {
		const [, whitespace, status, name] = match!;
		// Tabs advance to four-column stops so mixed spaces/tabs have stable depth.
		const indent = [...whitespace].reduce((column, char) => column + (char === '\t' ? 4 - column % 4 : 1), 0);
		while (ancestors.length && ancestors[ancestors.length - 1].indent >= indent) ancestors.pop();
		const parent = ancestors[ancestors.length - 1];
		const id = `clipboard-${index}`;
		const cancelled = status.toLowerCase() === 'c' || !!parent?.cancelled;
		if (!cancelled) items.push({ id, name, checked: status.toLowerCase() === 'x', parentId: parent?.id ?? null });
		// Keep cancelled ancestors in the stack to omit their whole subtree.
		ancestors.push({ indent, id, cancelled });
	}
	return items;
}
