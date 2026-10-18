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

test('clipboard todo recognition checks every nonblank line before stripping or discarding anything', () => {
	for (const text of ['', '  \n\t', '[C] One task', '[ ] Task\n[C] ', '[ ] Task\n[Y] Unknown', '[ ] Task\nPlain text', '[ ] Task\n[X]No separator']) {
		assert.equal(parseClipboardTodos(text), null, JSON.stringify(text));
	}
});
