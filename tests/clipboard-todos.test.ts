import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseClipboardTodos } from '../src/lib/importText.ts';

test('clipboard todo parsing handles blank lines, CRLF, lowercase markers and tab indentation', () => {
	assert.deepEqual(parseClipboardTodos('\r\n  [ ] Parent  \r\n\t[x] Child\r\n\t  [ ] Grandchild\r\n\r\n    [c] Cancelled sibling\r\n\t\t[ ] Cancelled child\r\n  [ ] Next root\r\n'), [
		{ id: 'clipboard-0', name: 'Parent', checked: false, parentId: null },
		{ id: 'clipboard-1', name: 'Child', checked: true, parentId: 'clipboard-0' },
		{ id: 'clipboard-2', name: 'Grandchild', checked: false, parentId: 'clipboard-1' },
		{ id: 'clipboard-5', name: 'Next root', checked: false, parentId: null }
	]);
});

test('recognized todos retain bracket text inside names and allow numeric or emoji names', () => {
	assert.deepEqual(parseClipboardTodos('[ ] Explain [X] and [C]\n[X] 123\n[ ] 🥛'), [
		{ id: 'clipboard-0', name: 'Explain [X] and [C]', checked: false, parentId: null },
		{ id: 'clipboard-1', name: '123', checked: true, parentId: null },
		{ id: 'clipboard-2', name: '🥛', checked: false, parentId: null }
	]);
});

test('clipboard task parsing ignores timestamps, headings and trailing notes', () => {
	assert.deepEqual(parseClipboardTodos('9:26 AM\n[X] Choc milk\n[X] Death of the outsider\n[X] Charge phone\n[X] Northland #northland\nEnd of list'), [
		{ id: 'clipboard-0', name: 'Choc milk', checked: true, parentId: null },
		{ id: 'clipboard-1', name: 'Death of the outsider', checked: true, parentId: null },
		{ id: 'clipboard-2', name: 'Charge phone', checked: true, parentId: null },
		{ id: 'clipboard-3', name: 'Northland #northland', checked: true, parentId: null }
	]);
});

test('clipboard task parsing accepts a single task and ignores malformed markers', () => {
	for (const text of ['[X] Task', 'Shopping\n[X] Task\n[C] \n[Y] Unknown\n[X]No separator']) {
		assert.deepEqual(parseClipboardTodos(text), [
			{ id: 'clipboard-0', name: 'Task', checked: true, parentId: null }
		]);
	}
});

test('ignored text between tasks preserves indentation and cancelled subtrees', () => {
	assert.deepEqual(parseClipboardTodos('Heading\n[ ] Parent\nComment\n  [X] Child\n  [C] Cancelled\nMore context\n    [ ] Cancelled child\n  [ ] Next child\nFooter'), [
		{ id: 'clipboard-0', name: 'Parent', checked: false, parentId: null },
		{ id: 'clipboard-1', name: 'Child', checked: true, parentId: 'clipboard-0' },
		{ id: 'clipboard-4', name: 'Next child', checked: false, parentId: 'clipboard-0' }
	]);
	assert.deepEqual(parseClipboardTodos('Heading\n[C] One cancelled task\nFooter'), []);
});

test('clipboard task parsing returns null when there are no task lines', () => {
	for (const text of ['', '  \n\t', '9:26 AM\nShopping\nFooter', '[C] ', '[Y] Unknown', '[X]No separator', 'Write about [X] and [C]']) {
		assert.equal(parseClipboardTodos(text), null, JSON.stringify(text));
	}
});
