const Y = require('yjs');
const doc = new Y.Doc();
const map = doc.getMap('map');
const undoManager = new Y.UndoManager(map);

undoManager.on('stack-item-added', event => {
    event.stackItem.meta.set('description', event.origin || 'Unknown action');
});

doc.transact(() => {
    map.set('a', 1);
}, 'Set A to 1');

console.log('Undo stack top description:', undoManager.undoStack[undoManager.undoStack.length - 1].meta.get('description'));
