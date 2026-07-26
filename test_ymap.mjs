import * as Y from 'yjs';
const doc = new Y.Doc();
const m = doc.getMap('test');
m.set('a', 1);
console.log('Keys before:', Array.from(m.keys()));
try {
  m.clear();
  console.log('Keys after clear:', Array.from(m.keys()));
} catch (e) {
  console.log('Error calling clear:', e.message);
}
