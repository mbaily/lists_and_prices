import * as Y from 'yjs';
const doc = new Y.Doc();
const m = doc.getMap('test');
m.set('a', 1);
m.set('b', 2);
m.set('c', 3);
console.log('Keys before:', Array.from(m.keys()));
m.forEach((_, key) => m.delete(key));
console.log('Keys after delete inside forEach:', Array.from(m.keys()));
