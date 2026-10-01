// @ts-nocheck -- Fixtures intentionally exercise legacy/malformed shapes too.
import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
import { createApp, Y, merge, Provider } from './helpers/app.mjs';

const apps = [];
function app() { const result = createApp(); apps.push(result); return result; }
afterEach(() => { for (const instance of apps.splice(0)) instance.dispose(); });
function fixture(c) {
	const folder = c.data.createFolder('Folder', null);
	const list = c.data.createList('List', folder, 'plain');
	return { folder, list };
}
function legacyNote(c, name = 'Original note') {
	const { folder, list } = fixture(c);
	const item = new Y.Map();
	item.set('id', 'legacy-note'); item.set('listId', list); item.set('name', name); item.set('note', true);
	c.doc.getArray('items').push([item]);
	return { folder, list, item, id: 'legacy-note' };
}
function replicate(from, to) { Y.applyUpdate(to.doc, Y.encodeStateAsUpdate(from.doc), 'peer'); }

test('moving a list inherits its destination colour and undo restores both folder and colour', () => {
	const c = app();
	const source = c.data.createFolder('Source', null, '#ff0000');
	const destination = c.data.createFolder('Destination', null, '#00ff00');
	const list = c.data.createList('List', source, 'plain', '#0000ff');
	c.store.getUndoManager().clear();
	c.data.updateList(list, { folderId: destination });
	assert.equal(c.data.readLists()[0].folderId, destination);
	assert.equal(c.data.readLists()[0].color, '#00ff00');
	c.store.undoLastAction();
	assert.equal(c.data.readLists()[0].folderId, source);
	assert.equal(c.data.readLists()[0].color, '#0000ff');

	c.data.updateList(list, { name: 'Renamed', folderId: source });
	assert.equal(c.data.readLists()[0].color, '#0000ff');
});

test('network handshake waits for local restoration and stale providers cannot connect a later session', () => {
	const idbs = [], sockets = [];
	class Local extends Provider { constructor() { super(); idbs.push(this); } }
	class Socket extends Provider {
		connects = 0;
		constructor(url, room, doc, options) { super(); this.options = options; sockets.push(this); }
		connect() { this.connects++; }
	}
	const c = createApp({ IndexeddbPersistence: Local, WebsocketProvider: Socket });
	try {
		assert.equal(sockets[0].options.connect, false);
		c.store.reconnectYjs();
		assert.equal(sockets[0].connects, 0);
		idbs[0].emit('synced');
		assert.equal(c.store.idbSynced.done, true);
		assert.equal(sockets[0].connects, 1);
		c.store.initYjs('different-user', 'ws://unused');
		idbs[0].emit('synced');
		assert.equal(c.store.idbSynced.done, false);
		assert.equal(sockets[1].connects, 0);
		idbs[1].emit('synced');
		assert.equal(sockets[1].connects, 1);
	} finally { c.dispose(); }
});

test('a batch of restored note texts mirrors names and leaves already correct names untouched', () => {
	const remote = new Y.Doc({ gc: false });
	const c = app();
	try {
		remote.transact(() => {
			for (let i = 0; i < 200; i++) {
				const item = new Y.Map();
				item.set('id', 'batch-' + i);
				item.set('name', i % 2 ? 'Stale' : 'Text ' + i);
				item.set('updatedAt', 'original');
				remote.getArray('items').push([item]);
				remote.getText('note_text_batch-' + i).insert(0, 'Text ' + i);
			}
		});
		Y.applyUpdate(c.doc, Y.encodeStateAsUpdate(remote), 'persisted');
		for (const [i, item] of c.doc.getArray('items').toArray().entries()) {
			assert.equal(item.get('name'), 'Text ' + i);
			assert.equal(item.get('updatedAt') === 'original', i % 2 === 0);
		}
		assert.equal(c.store.getUndoCount(), 0);
	} finally { remote.destroy(); }
});

for (const mode of ['merge', 'replace']) {
	test(`${mode} restore undo preserves a legacy note that has never been opened`, () => {
		const c = app(), { list, id } = legacyNote(c, 'Before');
		const backup = c.data.exportBackup(); backup.items[0].name = 'Restored';
		c.store.getUndoManager().clear(); c.data.importBackup(backup, mode);
		assert.equal(c.store.getUndoCount(), 1); c.store.undoLastAction();
		assert.equal(c.data.readItems(list)[0].name, 'Before');
		assert.equal(c.data.getItemYText(c.doc, id).toString(), 'Before');
	});

	test(`${mode} backup restores named checkboxes, definitions, reports and full-screen text`, () => {
		const c = app(), { folder, list } = fixture(c);
		const cb = c.data.addFolderCheckbox(folder, 'Done');
		const id = c.data.createItem(list, 'Original note', null, null, true);
		c.data.setItemCheckboxState(id, cb, true);
		c.data.updateItem(id, { fullScreen: true });
		c.reports.assignToReport(folder, 'Daily');
		const backup = JSON.parse(JSON.stringify(c.data.exportBackup()));
		c.data.updateItem(id, { name: 'Later note' });
		c.data.setItemCheckboxState(id, cb, false);
		c.data.removeFolderCheckbox(folder, cb);
		c.reports.removeFromReport(folder, 'Daily');
		c.data.importBackup(backup, mode);
		assert.equal(c.data.readItems(list)[0].checks[cb], true);
		assert.equal(c.data.readItems(list)[0].fullScreen, true);
		assert.equal(c.data.readItems(list)[0].name, 'Original note');
		assert.equal(c.data.getItemYText(c.doc, id).toString(), 'Original note');
		assert.deepEqual(c.data.readFolders()[0].checkboxes, [{ id: cb, name: 'Done' }]);
		assert.deepEqual(c.reports.getSmartFolders().Daily, [folder]);
	});
}

test('a restored empty note stays empty and does not reuse stale fallback text', () => {
	const c = app(), { list } = fixture(c), id = c.data.createItem(list, 'Original', null, null, true);
	const backup = c.data.exportBackup(); backup.items[0].name = '';
	c.data.importBackup(backup, 'replace');
	assert.equal(c.data.getItemYText(c.doc, id, 'Stale').toString(), '');
	assert.equal(c.data.readItems(list)[0].name, '');
});

test('replace restore is undoable, including both note text and checkbox flags', () => {
	const c = app(), { folder, list } = fixture(c), cb = c.data.addFolderCheckbox(folder, 'Done');
	const id = c.data.createItem(list, 'Before'); c.data.setItemCheckboxState(id, cb, true);
	const backup = c.data.exportBackup(); backup.items[0].name = 'Restored'; backup.items[0].checks[cb] = false;
	c.store.getUndoManager().clear(); c.data.importBackup(backup, 'replace');
	assert.equal(c.data.readItems(list)[0].name, 'Restored');
	assert.equal(c.store.undoLastAction(), true);
	assert.equal(c.data.readItems(list)[0].name, 'Before');
	assert.equal(c.data.readItems(list)[0].checks[cb], true);
	assert.equal(c.data.getItemYText(c.doc, id).toString(), 'Before');
});

test('invalid optional backup data is rejected before deleting anything', () => {
	const c = app(); fixture(c); const before = c.data.exportBackup();
	for (const patch of [{ sheets: {} }, { smartFolders: { broken: 42 } }, { items: [{ id: 'x', name: null }] }]) {
		assert.throws(() => c.data.importBackup({ ...before, ...patch }, 'replace'));
		assert.deepEqual(c.data.readFolders(), before.folders);
		assert.deepEqual(c.data.readLists(), before.lists);
	}
});

test('legacy incorrectly restored checks remain readable and can be changed independently', () => {
	const c = app(), { list } = fixture(c), id = c.data.createItem(list, 'Task');
	c.doc.getArray('items').get(0).set('checks', { alice: true, bob: true });
	c.data.setItemCheckboxState(id, 'alice', false);
	assert.deepEqual(c.data.readItems(list)[0].checks, { alice: false, bob: true });
});

test('global undo is blocked in history; live data stays untouched', () => {
	const c = app(), { list } = fixture(c), id = c.data.createItem(list, 'At commit');
	c.store.createCommit('Before'); c.store.getUndoManager().clear();
	c.data.updateItem(id, { name: 'Live change' }); c.store.viewCommit(c.store.readCommits()[0].id);
	assert.equal(c.store.canUndo(), false); assert.equal(c.store.getUndoCount(), 0);
	assert.equal(c.store.undoLastAction(), false); assert.throws(() => c.store.getUndoManager(), /read-only/);
	assert.throws(() => c.data.updateItem(id, { name: 'Forbidden' }), /read-only/);
	assert.throws(() => c.data.createFolder('Forbidden', null), /read-only/);
	assert.throws(() => c.reports.assignToReport('x', 'Forbidden'), /read-only/);
	assert.equal(c.data.readItems(list)[0].name, 'At commit');
	c.store.exitCommitView(); assert.equal(c.data.readItems(list)[0].name, 'Live change');
	assert.equal(c.store.undoLastAction(), true); assert.equal(c.data.readItems(list)[0].name, 'At commit');
});

test('switching historical commits destroys the old view', () => {
	const c = app(); fixture(c); c.store.createCommit('First'); c.store.createCommit('Second');
	c.store.viewCommit(c.store.readCommits()[0].id);
	let destroyed = false; c.store.getDoc().on('destroy', () => { destroyed = true; });
	c.store.viewCommit(c.store.readCommits()[1].id); assert.equal(destroyed, true);
});

test('fresh gc:false replica can reconstruct a deleted item snapshot', () => {
	const original = app(), fresh = app(), { list } = fixture(original);
	const id = original.data.createItem(list, 'Historical item'); original.store.createCommit('Saved'); original.data.deleteItem(id);
	// Old-format commits still depend on retaining deleted Yjs structs.
	original.doc.getArray('commits').get(0).delete('state');
	const server = new Y.Doc({ gc: false });
	try {
		Y.applyUpdate(server, Y.encodeStateAsUpdate(original.doc));
		Y.applyUpdate(fresh.doc, Y.encodeStateAsUpdate(server), 'peer');
		fresh.store.viewCommit(fresh.store.readCommits()[0].id);
		assert.equal(fresh.data.readItems(list)[0].name, 'Historical item');
	} finally { server.destroy(); }
});

test('new commits survive older garbage-collecting replicas and never embed other commits', () => {
	const original = app(), fresh = app(), { list } = fixture(original), id = original.data.createItem(list, 'Historical text');
	original.store.createCommit('First'); original.store.createCommit('Second');
	const checkpoint = new Y.Doc();
	Y.applyUpdate(checkpoint, original.store.readCommits()[0].state);
	assert.equal(checkpoint.getArray('commits').length, 0); checkpoint.destroy();
	original.data.deleteItem(id);
	const oldServer = new Y.Doc({ gc: true });
	try {
		Y.applyUpdate(oldServer, Y.encodeStateAsUpdate(original.doc));
		Y.applyUpdate(fresh.doc, Y.encodeStateAsUpdate(oldServer), 'peer');
		fresh.store.viewCommit(fresh.store.readCommits()[0].id);
		assert.equal(fresh.data.readItems(list)[0].name, 'Historical text');
	} finally { oldServer.destroy(); }
});

test('concurrent new-note first opens do not duplicate their initial text', () => {
	const a = app(), b = app(), { list } = fixture(a), id = a.data.createItem(list, 'Initial note', null, null, true);
	replicate(a, b); a.data.getItemYText(a.doc, id); b.data.getItemYText(b.doc, id); merge(a.doc, b.doc);
	assert.equal(a.data.getItemYText(a.doc, id).toString(), 'Initial note');
	assert.equal(b.data.getItemYText(b.doc, id).toString(), 'Initial note');
});

test('concurrent legacy-note migration is idempotent and keeps both peers edits', () => {
	const a = app(), b = app(), { id } = legacyNote(a);
	replicate(a, b); const aClient = a.doc.clientID, bClient = b.doc.clientID;
	const ta = a.data.getItemYText(a.doc, id), tb = b.data.getItemYText(b.doc, id);
	ta.insert(0, 'Alice '); tb.insert(tb.length, ' Bob'); merge(a.doc, b.doc);
	assert.equal(ta.toString(), 'Alice Original note Bob'); assert.equal(tb.toString(), ta.toString());
	assert.equal(a.doc.clientID, aClient); assert.equal(b.doc.clientID, bClient);
	const initial = Y.encodeStateAsUpdate(a.doc); Y.applyUpdate(b.doc, initial, 'peer');
	assert.equal(tb.toString(), 'Alice Original note Bob');
});

test('legacy migration supports a stale offline name history', () => {
	const a = app(), b = app(), { id, item } = legacyNote(a, 'Old'); replicate(a, b);
	item.set('name', 'New');
	const current = a.data.getItemYText(a.doc, id), stale = b.data.getItemYText(b.doc, id);
	stale.insert(stale.length, ' peer addition'); merge(a.doc, b.doc);
	assert.equal(current.toString(), stale.toString());
	assert.equal(current.toString().includes('Old'), false);
	assert.equal(current.toString().includes('New'), true);
	assert.equal(current.toString().includes('peer addition'), true);
});

test('legacy initialization and name mirrors do not become undo actions', () => {
	const c = app(), { id } = legacyNote(c); c.store.getUndoManager().clear();
	c.data.getItemYText(c.doc, id); assert.equal(c.store.canUndo(), false);
	c.data.updateItem(id, { name: 'Changed' }); assert.equal(c.store.getUndoCount(), 1);
	c.store.undoLastAction(); assert.equal(c.data.getItemYText(c.doc, id).toString(), 'Original note');
});

test('legacy seeding agrees when another replica has garbage-collected old names', () => {
	const a = app(), b = app(), { id, item } = legacyNote(a, 'Old');
	item.set('name', 'Current');
	const compacted = new Y.Doc({ gc: true });
	try {
		Y.applyUpdate(compacted, Y.encodeStateAsUpdate(a.doc));
		Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(compacted), 'peer');
	} finally { compacted.destroy(); }
	const ta = a.data.getItemYText(a.doc, id), tb = b.data.getItemYText(b.doc, id);
	ta.insert(0, 'A '); tb.insert(tb.length, ' B'); merge(a.doc, b.doc);
	assert.equal(ta.toString(), 'A Current B'); assert.equal(tb.toString(), 'A Current B');
	assert.equal(a.doc.store.pendingStructs, null); assert.equal(b.doc.store.pendingStructs, null);
});

test('deleting all legacy note text never resurrects its initial name', () => {
	const c = app(), { id } = legacyNote(c), text = c.data.getItemYText(c.doc, id);
	text.delete(0, text.length);
	assert.equal(c.data.getItemYText(c.doc, id, 'Original note').toString(), '');
});

test('saved note editing is one global undo action for real text and mirrored name', () => {
	const c = app(), { list } = fixture(c), id = c.data.createItem(list, 'Original');
	const text = c.data.getItemYText(c.doc, id), origin = {};
	c.store.getUndoManager().clear();
	const session = new c.editing.NoteEditSession(text, origin, c.store.getUndoManager());
	c.doc.transact(() => text.insert(text.length, ' one'), origin);
	c.doc.transact(() => text.insert(text.length, ' two'), origin);
	c.data.updateItem(id, { name: text.toString() }); session.commit(); session.destroy();
	assert.equal(c.store.getUndoCount(), 1);
	c.store.undoLastAction(); assert.equal(text.toString(), 'Original');
	assert.equal(c.data.readItems(list)[0].name, 'Original');
	assert.equal(c.doc.getArray('items').get(0).get('name'), 'Original');
	c.store.getUndoManager().redo(); assert.equal(text.toString(), 'Original one two');
});

test('discard removes only unsaved local note edits, preserving peer additions', () => {
	const a = app(), b = app(), { list } = fixture(a), id = a.data.createItem(list, 'Base'); replicate(a, b);
	const text = a.data.getItemYText(a.doc, id), origin = {}; a.store.getUndoManager().clear();
	const session = new a.editing.NoteEditSession(text, origin, a.store.getUndoManager());
	a.doc.transact(() => text.insert(0, 'Local '), origin);
	const other = b.data.getItemYText(b.doc, id); other.insert(other.length, ' peer'); merge(a.doc, b.doc);
	session.discard(); session.destroy(); merge(a.doc, b.doc);
	assert.equal(text.toString(), 'Base peer'); assert.equal(other.toString(), 'Base peer');
	assert.equal(a.store.getUndoCount(), 0);
});

test('discard after a save retains the saved edit and remote edit', () => {
	const a = app(), b = app(), { list } = fixture(a), id = a.data.createItem(list, 'Base'); replicate(a, b);
	const text = a.data.getItemYText(a.doc, id), origin = {}; a.store.getUndoManager().clear();
	const session = new a.editing.NoteEditSession(text, origin, a.store.getUndoManager());
	a.doc.transact(() => text.insert(text.length, ' saved'), origin); session.commit(); merge(a.doc, b.doc);
	a.doc.transact(() => text.insert(text.length, ' draft'), origin);
	const other = b.data.getItemYText(b.doc, id); other.insert(0, 'Peer '); merge(a.doc, b.doc);
	session.discard(); session.destroy(); assert.equal(text.toString(), 'Peer Base saved');
	assert.equal(a.store.getUndoCount(), 1); a.store.undoLastAction(); assert.equal(text.toString(), 'Peer Base');
});

test('remote-only changes do not count as a local draft', () => {
	const a = app(), b = app(), { list } = fixture(a), id = a.data.createItem(list, 'Base'); replicate(a, b);
	const text = a.data.getItemYText(a.doc, id), session = new a.editing.NoteEditSession(text, {}, a.store.getUndoManager());
	b.data.updateItem(id, { name: 'Peer change' }); merge(a.doc, b.doc);
	assert.equal(session.hasChanges, false); session.discard(); session.destroy(); assert.equal(text.toString(), 'Peer change');
});

test('local editor undo/redo then save produces a correct global undo', () => {
	const c = app(), { list } = fixture(c), id = c.data.createItem(list, 'Base'), text = c.data.getItemYText(c.doc, id), origin = {};
	c.store.getUndoManager().clear(); const session = new c.editing.NoteEditSession(text, origin, c.store.getUndoManager());
	c.doc.transact(() => text.insert(text.length, ' typed'), origin); session.undoManager.undo(); session.undoManager.redo();
	session.commit(); session.destroy(); assert.equal(text.toString(), 'Base typed');
	c.store.undoLastAction(); assert.equal(text.toString(), 'Base');
});

test('two independent report memberships and checkbox definitions survive merge', () => {
	const a = app(), b = app(), { folder } = fixture(a); replicate(a, b);
	a.reports.assignToReport('a', 'Daily'); b.reports.assignToReport('b', 'Daily');
	a.data.addFolderCheckbox(folder, 'Alice'); b.data.addFolderCheckbox(folder, 'Bob'); merge(a.doc, b.doc);
	assert.deepEqual(a.reports.getSmartFolders().Daily, ['a', 'b']);
	assert.deepEqual(a.data.readFolders()[0].checkboxes, b.data.readFolders()[0].checkboxes);
	assert.deepEqual(a.data.readFolders()[0].checkboxes.map((box) => box.name).sort(), ['Alice', 'Bob']);
});

test('legacy report removals and checkbox renames merge with independent changes', () => {
	const a = app(), b = app(), { folder } = fixture(a);
	a.doc.getMap('smart-folders').set('Daily', JSON.stringify(['a', 'b']));
	a.doc.getArray('folders').get(0).set('checkboxes', [{ id: 'a', name: 'Alice' }, { id: 'b', name: 'Bob' }]); replicate(a, b);
	a.reports.removeFromReport('a', 'Daily'); b.reports.assignToReport('c', 'Daily');
	a.data.renameFolderCheckbox(folder, 'a', 'Anne'); b.data.renameFolderCheckbox(folder, 'b', 'Ben'); merge(a.doc, b.doc);
	assert.deepEqual(a.reports.getSmartFolders().Daily, ['b', 'c']);
	assert.deepEqual(a.data.readFolders()[0].checkboxes.map((box) => box.name), ['Anne', 'Ben']);
});

test('checkbox removal remains removed after a concurrent rename', () => {
	const a = app(), b = app(), { folder } = fixture(a), id = a.data.addFolderCheckbox(folder, 'Alice'); replicate(a, b);
	a.data.removeFolderCheckbox(folder, id); b.data.renameFolderCheckbox(folder, id, 'Anne'); merge(a.doc, b.doc);
	assert.deepEqual(a.data.readFolders()[0].checkboxes, []); assert.deepEqual(b.data.readFolders()[0].checkboxes, []);
});

test('concurrent folder moves resolve to the same reachable tree without repair writes', () => {
	const a = app(), b = app(), one = a.data.createFolder('One', null), two = a.data.createFolder('Two', null); replicate(a, b);
	a.data.updateFolder(one, { parentId: two }); b.data.updateFolder(two, { parentId: one }); merge(a.doc, b.doc);
	const state = Y.encodeStateVector(a.doc);
	assert.deepEqual(a.data.readFolders(), b.data.readFolders());
	const folders = a.data.readFolders(); assert.equal(folders.filter((f) => f.parentId === null).length, 1);
	assert.equal(folders.find((f) => f.parentId === null).id, [one, two].sort()[0]);
	assert.deepEqual(Y.encodeStateVector(a.doc), state);
	a.data.updateFolder(folders.find((f) => f.parentId !== null).id, { parentId: null }); merge(a.doc, b.doc);
	assert.equal(b.data.readFolders().filter((f) => f.parentId === null).length, 2);
});

test('tree traversal shows headings, deep children, orphans and cycles exactly once', () => {
	const c = app(), { list } = fixture(c);
	const a = c.data.createItem(list, 'A'), b = c.data.createItem(list, 'B', null, a), child = c.data.createItem(list, 'C', null, b);
	c.data.createItem(list, 'D', null, child); c.data.createItem(list, 'Orphan', null, 'missing');
	c.data.updateItem(a, { heading: true });
	let tree = c.hierarchy.buildItemTreeOrder(c.data.readItems(list));
	assert.equal(tree.length, 5); assert.equal(tree.find((entry) => entry.item.name === 'D').level, 3);
	c.data.updateItem(a, { parentId: b }); tree = c.hierarchy.buildItemTreeOrder(c.data.readItems(list));
	assert.equal(tree.length, 5); assert.equal(new Set(tree.map((entry) => entry.item.id)).size, 5);
});

test('explicit item moves preserve the recovered tree after concurrent moves form a cycle', () => {
	const a = app(), b = app(), { list } = fixture(a), one = a.data.createItem(list, 'One'), two = a.data.createItem(list, 'Two'); replicate(a, b);
	assert.equal(a.data.reparentItems(list, [one], two), true);
	assert.equal(b.data.reparentItems(list, [two], one), true); merge(a.doc, b.doc);
	const child = a.data.readItems(list).find((item) => item.parentId !== null);
	assert.equal(a.data.reparentItems(list, [child.id], null), true); merge(a.doc, b.doc);
	assert.equal(b.data.readItems(list).filter((item) => item.parentId === null).length, 2);
});

test('moving a folder does not rewrite an unrelated missing-parent reference', () => {
	const c = app(), orphan = c.data.createFolder('Waiting for sync', 'not-yet-synced'), moved = c.data.createFolder('Moving', null);
	c.data.updateFolder(moved, { parentId: null });
	assert.equal(c.doc.getArray('folders').toArray().find((folder) => folder.get('id') === orphan).get('parentId'), 'not-yet-synced');
});

test('reparent validates depth, heading/deleted targets and cycles without losing selection data', () => {
	const c = app(), { list } = fixture(c), a = c.data.createItem(list, 'A'), b = c.data.createItem(list, 'B', null, a), child = c.data.createItem(list, 'C', null, b), moved = c.data.createItem(list, 'Move');
	assert.equal(c.data.reparentItems(list, [moved], child), false);
	assert.equal(c.data.reparentItems(list, [a], b), false);
	assert.equal(c.data.reparentItems(list, [moved], 'missing'), false);
	c.data.updateItem(a, { heading: true }); assert.equal(c.data.reparentItems(list, [moved], a), false);
	assert.equal(c.data.readItems(list).length, 4);
});

test('moving a selection preserves the selected parent-child subtree and undoes atomically', () => {
	const c = app(), { list } = fixture(c), a = c.data.createItem(list, 'A'), b = c.data.createItem(list, 'B', null, a), target = c.data.createItem(list, 'Target');
	c.store.getUndoManager().clear(); assert.equal(c.data.reparentItems(list, [a, b], target), true);
	assert.equal(c.data.readItems(list).find((item) => item.id === b).parentId, a);
	assert.equal(c.store.getUndoCount(), 1); c.store.undoLastAction();
	assert.equal(c.data.readItems(list).find((item) => item.id === a).parentId, null);
});

test('append and batch insertion respect min/max order after gaps and top inserts', () => {
	const c = app(), { list } = fixture(c), ids = ['A', 'B', 'C', 'D', 'E'].map((name) => c.data.createItem(list, name));
	c.data.deleteItem(ids[0]); c.data.deleteItem(ids[1]); c.data.createItem(list, 'Last');
	assert.deepEqual(c.data.readItems(list).map((item) => item.name), ['C', 'D', 'E', 'Last']);
	c.data.createItem(list, 'First', null, null, false, 'top'); c.data.createItemsBatch(list, ['Top 1', 'Top 2'], 'top');
	c.data.createItemsBatch(list, ['Bottom 1', 'Bottom 2']);
	assert.deepEqual(c.data.readItems(list).map((item) => item.name), ['Top 1', 'Top 2', 'First', 'C', 'D', 'E', 'Last', 'Bottom 1', 'Bottom 2']);
});

test('remote changes, including note-name cache updates, never enter local undo', () => {
	const a = app(), b = app(), { list } = fixture(a), id = a.data.createItem(list, 'Before'); replicate(a, b);
	b.store.getUndoManager().clear(); a.data.updateItem(id, { name: 'From peer' }); replicate(a, b);
	assert.equal(b.store.getUndoCount(), 0); assert.equal(b.data.readItems(list)[0].name, 'From peer');
});
