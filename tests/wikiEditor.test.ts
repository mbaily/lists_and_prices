import { test } from 'node:test';
import { deepStrictEqual, strictEqual } from 'node:assert';
import { handleWikiEditorKeydown } from '../src/lib/wiki/editorKeyHandler';

test('Enter auto-continues unordered list marker at same indentation', () => {
	const text = '  * First item';
	const action = handleWikiEditorKeydown(text, text.length, text.length, { key: 'Enter' });
	deepStrictEqual(action, {
		type: 'replace',
		start: text.length,
		end: text.length,
		replacement: '\n  * ',
		selectionStart: text.length + 5,
		selectionEnd: text.length + 5
	});
});

test('Enter auto-continues ordered list marker at same indentation', () => {
	const text = '  - First item';
	const action = handleWikiEditorKeydown(text, text.length, text.length, { key: 'Enter' });
	deepStrictEqual(action, {
		type: 'replace',
		start: text.length,
		end: text.length,
		replacement: '\n  - ',
		selectionStart: text.length + 5,
		selectionEnd: text.length + 5
	});
});

test('Enter auto-continues nested list marker with 4 spaces', () => {
	const text = '    * Sub item';
	const action = handleWikiEditorKeydown(text, text.length, text.length, { key: 'Enter' });
	deepStrictEqual(action, {
		type: 'replace',
		start: text.length,
		end: text.length,
		replacement: '\n    * ',
		selectionStart: text.length + 7,
		selectionEnd: text.length + 7
	});
});

test('Enter auto-continues code block indentation', () => {
	const text = '  console.log("hello");';
	const action = handleWikiEditorKeydown(text, text.length, text.length, { key: 'Enter' });
	deepStrictEqual(action, {
		type: 'replace',
		start: text.length,
		end: text.length,
		replacement: '\n  ',
		selectionStart: text.length + 3,
		selectionEnd: text.length + 3
	});
});

test('Enter on empty list item cancels the list (double-enter exit)', () => {
	const text = '  * Item 1\n  * ';
	const cursorPos = text.length;
	const action = handleWikiEditorKeydown(text, cursorPos, cursorPos, { key: 'Enter' });
	// Should remove "  * " on the second line (from pos 11 to pos 15)
	deepStrictEqual(action, {
		type: 'replace',
		start: 11,
		end: 15,
		replacement: '',
		selectionStart: 11,
		selectionEnd: 11
	});
});

test('Enter with text selection uses default browser behavior', () => {
	const text = '  * Item 1';
	const action = handleWikiEditorKeydown(text, 4, 8, { key: 'Enter' });
	strictEqual(action, null);
});

test('Backspace on nested list item unindents by one level', () => {
	const text = '    * ';
	const cursorPos = text.length;
	const action = handleWikiEditorKeydown(text, cursorPos, cursorPos, { key: 'Backspace' });
	// Removes 2 spaces from the start of the line
	deepStrictEqual(action, {
		type: 'replace',
		start: 0,
		end: 2,
		replacement: '',
		selectionStart: 4,
		selectionEnd: 4
	});
});

test('Backspace on level 1 list item deletes the bullet and spaces', () => {
	const text = '  * ';
	const cursorPos = text.length;
	const action = handleWikiEditorKeydown(text, cursorPos, cursorPos, { key: 'Backspace' });
	// Deletes from start to cursor (all 4 chars: "  * ")
	deepStrictEqual(action, {
		type: 'replace',
		start: 0,
		end: 4,
		replacement: '',
		selectionStart: 0,
		selectionEnd: 0
	});
});

test('Backspace on ordered level 1 list item deletes marker', () => {
	const text = '  - ';
	const cursorPos = text.length;
	const action = handleWikiEditorKeydown(text, cursorPos, cursorPos, { key: 'Backspace' });
	deepStrictEqual(action, {
		type: 'replace',
		start: 0,
		end: 4,
		replacement: '',
		selectionStart: 0,
		selectionEnd: 0
	});
});

test('Backspace on 4-space code indentation removes 2 spaces', () => {
	const text = '    ';
	const cursorPos = text.length;
	const action = handleWikiEditorKeydown(text, cursorPos, cursorPos, { key: 'Backspace' });
	deepStrictEqual(action, {
		type: 'replace',
		start: 2,
		end: 4,
		replacement: '',
		selectionStart: 2,
		selectionEnd: 2
	});
});

test('Space immediately after bullet indents the list item by 2 spaces', () => {
	const text = '  * ';
	const cursorPos = text.length;
	const action = handleWikiEditorKeydown(text, cursorPos, cursorPos, { key: ' ' });
	deepStrictEqual(action, {
		type: 'replace',
		start: 0,
		end: 0,
		replacement: '  ',
		selectionStart: 6,
		selectionEnd: 6
	});
});

test('Tab indents a single list line by 2 spaces', () => {
	const text = '  * An item';
	const action = handleWikiEditorKeydown(text, 5, 5, { key: 'Tab', shiftKey: false });
	deepStrictEqual(action, {
		type: 'replace',
		start: 0,
		end: 0,
		replacement: '  ',
		selectionStart: 7,
		selectionEnd: 7
	});
});

test('Shift+Tab unindents a single list line by 2 spaces', () => {
	const text = '    * An item';
	const action = handleWikiEditorKeydown(text, 7, 7, { key: 'Tab', shiftKey: true });
	deepStrictEqual(action, {
		type: 'replace',
		start: 0,
		end: 2,
		replacement: '',
		selectionStart: 5,
		selectionEnd: 5
	});
});

test('Tab and Shift+Tab indent and unindent multi-line selections', () => {
	const text = '  * Item 1\n  * Item 2\n  * Item 3';
	const tabAction = handleWikiEditorKeydown(text, 0, text.length, { key: 'Tab', shiftKey: false });
	deepStrictEqual(tabAction, {
		type: 'replace',
		start: 0,
		end: text.length,
		replacement: '    * Item 1\n    * Item 2\n    * Item 3',
		selectionStart: 2,
		selectionEnd: text.length + 6
	});

	const indentedText = '    * Item 1\n    * Item 2\n    * Item 3';
	const untabAction = handleWikiEditorKeydown(indentedText, 0, indentedText.length, { key: 'Tab', shiftKey: true });
	deepStrictEqual(untabAction, {
		type: 'replace',
		start: 0,
		end: indentedText.length,
		replacement: '  * Item 1\n  * Item 2\n  * Item 3',
		selectionStart: 0,
		selectionEnd: indentedText.length - 6
	});
});

test('Save hotkeys (Ctrl+Enter, Cmd+Enter, Ctrl+S, Cmd+S)', () => {
	deepStrictEqual(handleWikiEditorKeydown('text', 2, 2, { key: 'Enter', ctrlKey: true }), { type: 'save' });
	deepStrictEqual(handleWikiEditorKeydown('text', 2, 2, { key: 'Enter', metaKey: true }), { type: 'save' });
	deepStrictEqual(handleWikiEditorKeydown('text', 2, 2, { key: 's', ctrlKey: true }), { type: 'save' });
	deepStrictEqual(handleWikiEditorKeydown('text', 2, 2, { key: 'S', metaKey: true }), { type: 'save' });
});

test('Formatting hotkeys (Ctrl+B, Ctrl+I, Ctrl+U, Ctrl+K)', () => {
	deepStrictEqual(handleWikiEditorKeydown('text', 2, 2, { key: 'b', ctrlKey: true }), { type: 'format', format: 'bold' });
	deepStrictEqual(handleWikiEditorKeydown('text', 2, 2, { key: 'i', ctrlKey: true }), { type: 'format', format: 'italic' });
	deepStrictEqual(handleWikiEditorKeydown('text', 2, 2, { key: 'u', ctrlKey: true }), { type: 'format', format: 'underline' });
	deepStrictEqual(handleWikiEditorKeydown('text', 2, 2, { key: 'k', ctrlKey: true }), { type: 'format', format: 'link' });
});

