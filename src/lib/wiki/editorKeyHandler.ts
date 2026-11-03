/**
 * DokuWiki-style markup editor key handling enhancements.
 *
 * Implements native DokuWiki editor features (editor.js and related):
 * - Auto-continuation of lists (unordered `*` and ordered `-`) and code indentation on Enter.
 * - Double-Enter cancellation: pressing Enter on an empty list item deletes the marker to exit the list.
 * - Smart Backspace unindent: unindents nested lists by 2 spaces; at level 1, deletes the list marker.
 * - Space indentation: pressing Space immediately after a list marker indents it by 2 spaces.
 * - Tab / Shift+Tab indentation: indents/unindents current line or multi-line block without losing focus.
 * - Hotkeys: Ctrl/Cmd+Enter and Ctrl/Cmd+S to save, Ctrl/Cmd+B/I/U for formatting, Ctrl/Cmd+K for link.
 */

export type WikiEditorAction =
	| { type: 'save' }
	| { type: 'format'; format: 'bold' | 'italic' | 'underline' | 'link' }
	| {
			type: 'replace';
			start: number;
			end: number;
			replacement: string;
			selectionStart: number;
			selectionEnd: number;
	  }
	| null;

export function handleWikiEditorKeydown(
	value: string,
	selectionStart: number,
	selectionEnd: number,
	event: {
		key: string;
		ctrlKey?: boolean;
		metaKey?: boolean;
		shiftKey?: boolean;
		altKey?: boolean;
	}
): WikiEditorAction {
	const isModifier = Boolean(event.ctrlKey || event.metaKey);
	const hasSelection = selectionStart !== selectionEnd;

	// 1. Hotkeys: Save (Ctrl/Cmd+Enter, Ctrl/Cmd+S)
	if (isModifier && !event.altKey && !event.shiftKey) {
		if (event.key === 'Enter' || event.key === 's' || event.key === 'S') {
			return { type: 'save' };
		}
		if (event.key === 'b' || event.key === 'B') {
			return { type: 'format', format: 'bold' };
		}
		if (event.key === 'i' || event.key === 'I') {
			return { type: 'format', format: 'italic' };
		}
		if (event.key === 'u' || event.key === 'U') {
			return { type: 'format', format: 'underline' };
		}
		if (event.key === 'k' || event.key === 'K') {
			return { type: 'format', format: 'link' };
		}
	}

	// 2. Tab & Shift+Tab handling (indents/unindents by 2 spaces)
	if (event.key === 'Tab' && !isModifier && !event.altKey) {
		if (hasSelection) {
			const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1;
			const lastLineEnd = value.indexOf('\n', selectionEnd);
			const lineEnd = lastLineEnd === -1 ? value.length : lastLineEnd;
			const block = value.slice(lineStart, lineEnd);
			const lines = block.split('\n');

			if (event.shiftKey) {
				// Shift+Tab: Unindent each line by up to 2 spaces
				let removedChars = 0;
				let firstLineRemoved = 0;
				const newLines = lines.map((line, idx) => {
					const match = line.match(/^ {1,2}/);
					if (match) {
						removedChars += match[0].length;
						if (idx === 0) firstLineRemoved = match[0].length;
						return line.slice(match[0].length);
					}
					return line;
				});
				const replacement = newLines.join('\n');
				const newSelStart = Math.max(lineStart, selectionStart - firstLineRemoved);
				const newSelEnd = Math.max(newSelStart, selectionEnd - removedChars);
				return {
					type: 'replace',
					start: lineStart,
					end: lineEnd,
					replacement,
					selectionStart: newSelStart,
					selectionEnd: newSelEnd
				};
			} else {
				// Tab: Indent each line by 2 spaces
				const replacement = lines.map((line) => '  ' + line).join('\n');
				const addedChars = lines.length * 2;
				return {
					type: 'replace',
					start: lineStart,
					end: lineEnd,
					replacement,
					selectionStart: selectionStart + 2,
					selectionEnd: selectionEnd + addedChars
				};
			}
		} else {
			// Single-line Tab / Shift+Tab
			const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1;
			const line = value.slice(lineStart);
			const nextNewline = line.indexOf('\n');
			const fullLine = nextNewline === -1 ? line : line.slice(0, nextNewline);

			if (event.shiftKey) {
				// Shift+Tab: unindent line
				const match = fullLine.match(/^ {1,2}/);
				if (match) {
					const removeCount = match[0].length;
					const newCursor = Math.max(lineStart, selectionStart - removeCount);
					return {
						type: 'replace',
						start: lineStart,
						end: lineStart + removeCount,
						replacement: '',
						selectionStart: newCursor,
						selectionEnd: newCursor
					};
				}
				return null;
			} else {
				// Tab: if on a list item, indent line at start; otherwise insert 2 spaces at cursor
				const isList = fullLine.match(/^ {2,}[*-] /);
				if (isList) {
					return {
						type: 'replace',
						start: lineStart,
						end: lineStart,
						replacement: '  ',
						selectionStart: selectionStart + 2,
						selectionEnd: selectionStart + 2
					};
				} else {
					return {
						type: 'replace',
						start: selectionStart,
						end: selectionEnd,
						replacement: '  ',
						selectionStart: selectionStart + 2,
						selectionEnd: selectionStart + 2
					};
				}
			}
		}
	}

	// For Enter, Backspace and Space: if text is selected, allow default browser behavior
	if (hasSelection) {
		return null;
	}

	const search = '\n' + value.slice(0, selectionStart);
	const linestart = Math.max(search.lastIndexOf('\n'), search.lastIndexOf('\r'));
	const currentLineBefore = search.slice(linestart); // starts with '\n'
	const valueLineStart = selectionStart - (currentLineBefore.length - 1);

	// 3. Enter: Auto-continue list or code indentation, or cancel on empty item
	if (event.key === 'Enter' && !isModifier && !event.altKey) {
		// DokuWiki regex: var match = search.match(/(\n  +([\*-] ?)?)/);
		const match = currentLineBefore.match(/^(\n  +([*-] )?)/);
		if (match) {
			const prefix = match[1]; // e.g. "\n  * " or "\n  - " or "\n  "
			// Check if the current line is an empty list item: var match2 = search.match(/^\n  +[\*-]\s*$/);
			const match2 = currentLineBefore.match(/^\n  +[*-]\s*$/);
			const textAfterCursor = value.slice(selectionStart);
			const isAtLineEnd = textAfterCursor.match(/^($|\r?\n)/);

			if (match2 && isAtLineEnd) {
				// Cancel list if the last item is empty (i.e. two times enter)
				// Deletes the bullet and spaces on the current line, leaving an empty line
				return {
					type: 'replace',
					start: valueLineStart,
					end: selectionStart,
					replacement: '',
					selectionStart: valueLineStart,
					selectionEnd: valueLineStart
				};
			} else {
				// Insert newline with the same indentation and bullet
				const bullet = prefix.slice(1); // strip leading '\n'
				return {
					type: 'replace',
					start: selectionStart,
					end: selectionStart,
					replacement: '\n' + bullet,
					selectionStart: selectionStart + 1 + bullet.length,
					selectionEnd: selectionStart + 1 + bullet.length
				};
			}
		}
	}

	// 4. Backspace: Unindent nested lists or remove list marker
	if (event.key === 'Backspace' && !isModifier && !event.altKey && !event.shiftKey) {
		// DokuWiki regex: var match = search.match(/(\n  +)([*-] ?)$/);
		const match = currentLineBefore.match(/^(\n  +)([*-] ?)$/);
		if (match) {
			const spaces = match[1].length - 1; // number of leading spaces
			if (spaces > 3) {
				// Unindent one level (remove 2 spaces from start of line)
				return {
					type: 'replace',
					start: valueLineStart,
					end: valueLineStart + 2,
					replacement: '',
					selectionStart: selectionStart - 2,
					selectionEnd: selectionStart - 2
				};
			} else {
				// Delete list point (remove from line start to cursor)
				return {
					type: 'replace',
					start: valueLineStart,
					end: selectionStart,
					replacement: '',
					selectionStart: valueLineStart,
					selectionEnd: valueLineStart
				};
			}
		} else {
			// Code indentation unindent on Backspace: if line has only 2+ spaces before cursor
			const spaceMatch = currentLineBefore.match(/^(\n  +)$/);
			if (spaceMatch) {
				const spaces = spaceMatch[1].length - 1;
				const remove = spaces % 2 === 0 ? 2 : 1;
				return {
					type: 'replace',
					start: selectionStart - remove,
					end: selectionStart,
					replacement: '',
					selectionStart: selectionStart - remove,
					selectionEnd: selectionStart - remove
				};
			}
		}
	}

	// 5. Space: Indent list item when pressed right after bullet marker
	if (event.key === ' ' && !isModifier && !event.altKey && !event.shiftKey) {
		// DokuWiki regex: var match = search.match(/(\n  +)([*-] )$/);
		const match = currentLineBefore.match(/^(\n  +)([*-] )$/);
		if (match) {
			// Indent list item by 2 spaces at start of line
			return {
				type: 'replace',
				start: valueLineStart,
				end: valueLineStart,
				replacement: '  ',
				selectionStart: selectionStart + 2,
				selectionEnd: selectionStart + 2
			};
		}
	}

	return null;
}

