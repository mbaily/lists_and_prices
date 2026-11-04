import * as Y from 'yjs';
const doc = new Y.Doc();
const map = doc.getMap('map');
const undoManager = new Y.UndoManager(map);

undoManager.on('stack-item-added', event => {
    event.stackItem.meta.set('description', event.origin || 'Unknown action');
});

doc.transact(() => {
    map.set('a', 1);
}); // default origin null

doc.transact(() => {
    map.set('b', 1);
}, 'my_origin');

console.log(undoManager.undoStack);
