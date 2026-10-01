import assert from 'node:assert/strict';
import { test } from 'node:test';
import { componentFunctions, transpile } from './helpers/app.mjs';

test('hot suburb handle reorders on pointer release and cancels without changing the draft', () => {
    const state = {
        ids: ['first', 'second', 'third'], dragId: null, overId: null, dragPointer: null,
        suburbList: { contains: row => row.inside },
        document: { elementFromPoint: x => ({ closest: () => ({ inside: x < 10, dataset: { suburbId: x === 1 ? 'first' : 'third' } }) }) }
    };
    const code = componentFunctions('src/lib/components/HotSuburbsScreen.svelte', ['startDrag', 'dragOver', 'finishDrag', 'cancelDrag', 'move']);
    const handlers = new Function('state', `with (state) { ${transpile(code)}; return { startDrag, dragOver, finishDrag, cancelDrag, move }; }`)(state);
    const captured = [];
    const pointer = { isPrimary: true, button: 0, pointerId: 7, currentTarget: { setPointerCapture: id => captured.push(id) }, preventDefault() {}, clientX: 3, clientY: 0 };
    handlers.startDrag(pointer, 'first');
    assert.deepEqual(captured, [7]);
    handlers.dragOver({ ...pointer, pointerId: 8 });
    assert.equal(state.overId, 'first', 'unrelated pointers cannot move the target');
    handlers.dragOver(pointer);
    assert.equal(state.overId, 'third');
    assert.deepEqual(state.ids, ['first', 'second', 'third'], 'the draft changes only on release');
    handlers.finishDrag(pointer);
    assert.deepEqual(state.ids, ['second', 'third', 'first']);
    assert.equal(state.dragId, null);
    handlers.startDrag(pointer, 'first');
    handlers.dragOver({ ...pointer, clientX: 1 });
    handlers.cancelDrag();
    handlers.finishDrag(pointer);
    assert.deepEqual(state.ids, ['second', 'third', 'first'], 'cancelled touches do not reorder');
    handlers.move(2, -1);
    assert.deepEqual(state.ids, ['second', 'first', 'third'], 'the same handle supports keyboard reordering');
});
