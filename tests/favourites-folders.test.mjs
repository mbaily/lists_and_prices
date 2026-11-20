import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp, merge } from './helpers/app.mjs';

function openApp(t) {
	const app = createApp();
	t.after(() => app.dispose());
	return app;
}

function entries(data) {
	return data.buildFavouriteEntries(data.readFolders(), data.readLists(), data.readFavouriteFolders());
}

function children(data, parentId) {
	return entries(data).filter(entry => entry.parentId === parentId).map(entry => entry.item.id);
}

test('legacy stars start at the top level and shortcuts move independently of their app folders', t => {
	const { data } = openApp(t);
	const source = data.createFolder('App folder', null);
	const list = data.createList('Tasks', source, 'plain');
	data.updateFolder(source, { favourite: true });
	data.updateList(list, { favourite: true });
	assert.deepEqual(children(data, null), [source, list]);

	const work = data.createFavouriteFolder('Work', null);
	const projects = data.createFavouriteFolder('Projects', work);
	const ref = { type: 'list', id: list };
	data.moveFavourite(ref, projects);
	data.moveFavourite({ type: 'folder', id: source }, work);
	data.saveFavouritesOrder(work, [{ type: 'folder', id: source }, { type: 'favourites-folder', id: projects }]);
	assert.deepEqual(children(data, null), [work]);
	assert.deepEqual(children(data, work), [source, projects]);
	assert.deepEqual(children(data, projects), [list]);
	assert.deepEqual(data.favouriteShortcutsInTreeOrder(entries(data)).map(entry => entry.item.id), [source, list]);
	assert.equal(data.readLists()[0].folderId, source);
	assert.equal(data.readFolders()[0].parentId, null);

	data.moveFavourite({ type: 'favourites-folder', id: work }, projects);
	assert.deepEqual(children(data, null), [work]);
	data.toggleFavourite('list', list, true);
	assert.deepEqual(children(data, projects), []);
	data.toggleFavourite('list', list, true);
	assert.deepEqual(children(data, projects), [list]);
	data.toggleFavourite('list', list);
	data.toggleFavourite('list', list);
	assert.deepEqual(children(data, null), [work, list]);
});

test('deletion promotes children in order and can be undone as one action', t => {
	const { data, store } = openApp(t);
	const work = data.createFavouriteFolder('Work', null);
	const before = data.createFavouriteFolder('Before', work);
	const projects = data.createFavouriteFolder('Projects', work);
	const after = data.createFavouriteFolder('After', work);
	const nested = data.createFavouriteFolder('Nested', projects);
	const source = data.createFolder('App folder', null);
	const list = data.createList('Tasks', source, 'plain');
	const ref = { type: 'list', id: list };
	data.toggleFavourite('list', list);
	data.moveFavourite(ref, projects);
	const hidden = data.createList('Archived', source, 'plain');
	data.toggleFavourite('list', hidden);
	data.moveFavourite({ type: 'list', id: hidden }, projects);
	data.updateList(hidden, { archived: true });

	store.getUndoManager().clear();
	data.deleteFavouriteFolder(projects);
	assert.deepEqual(children(data, work), [before, nested, list, after]);
	assert.equal(data.readLists().find(item => item.id === hidden).favouriteParentId, work);
	assert.equal(store.getUndoCount(), 1);
	store.undoLastAction();
	assert.deepEqual(children(data, work), [before, projects, after]);
	assert.deepEqual(children(data, projects), [nested, list]);
});

test('favourites folders survive sync, JSON backups and historical views', t => {
	const a = openApp(t);
	const b = openApp(t);
	const c = openApp(t);
	const work = a.data.createFavouriteFolder('Work', null);
	const projects = a.data.createFavouriteFolder('Projects', work);
	const list = a.data.createList('Tasks', null, 'plain');
	a.data.toggleFavourite('list', list);
	a.data.moveFavourite({ type: 'list', id: list }, projects);
	merge(a.doc, b.doc);
	assert.deepEqual(children(b.data, projects), [list]);
	b.store.createCommit('Nested favourites');
	b.data.renameFavouriteFolder(projects, 'Updated');
	b.store.viewCommit(b.store.readCommits()[0].id);
	assert.equal(b.data.readFavouriteFolders().find(group => group.id === projects).name, 'Projects');
	assert.deepEqual(children(b.data, projects), [list]);

	const backup = c.data.parseBackup(JSON.stringify(a.data.exportBackup()));
	c.data.importBackup(backup, 'replace');
	assert.deepEqual(children(c.data, projects), [list]);
	const legacy = { ...backup };
	delete legacy.favouriteFolders;
	for (const list of legacy.lists) delete list.favouriteParentId;
	c.data.importBackup(legacy, 'merge');
	assert.deepEqual(children(c.data, projects), [list]);
	c.data.importBackup(legacy, 'replace');
	assert.deepEqual(children(c.data, null), [list]);
	assert.deepEqual(c.data.readFavouriteFolders(), []);
});

test('concurrent moves recover cycles and keep all shortcuts reachable', t => {
	const a = openApp(t);
	const b = openApp(t);
	const one = a.data.createFavouriteFolder('One', null);
	const two = a.data.createFavouriteFolder('Two', null);
	const list = a.data.createList('Tasks', null, 'plain');
	a.data.toggleFavourite('list', list);
	a.data.moveFavourite({ type: 'list', id: list }, one);
	merge(a.doc, b.doc);
	a.data.moveFavourite({ type: 'favourites-folder', id: one }, two);
	b.data.moveFavourite({ type: 'favourites-folder', id: two }, one);
	merge(a.doc, b.doc);
	assert.deepEqual(a.data.readFavouriteFolders(), b.data.readFavouriteFolders());
	assert.equal(children(a.data, null).length, 1);
	assert.deepEqual(a.data.favouriteShortcutsInTreeOrder(entries(a.data)).map(entry => entry.item.id), [list]);
});

test('starring a list places it next to its app-folder siblings', t => {
	const { data } = openApp(t);
	const days = data.createFolder('Days', null);
	const other = data.createFolder('Other', null);
	const mon = data.createList('Mon', days, 'plain');
	const tue = data.createList('Tue', days, 'plain');
	const wed = data.createList('Wed', days, 'plain');
	const a = data.createList('A', other, 'plain');
	const b = data.createList('B', other, 'plain');
	data.toggleFavourite('list', mon);
	data.toggleFavourite('list', a);
	data.toggleFavourite('list', b);
	assert.deepEqual(children(data, null), [mon, a, b]);

	// Starred sibling present: goes straight after it.
	data.toggleFavourite('list', tue);
	assert.deepEqual(children(data, null), [mon, tue, a, b]);

	// No starred sibling: takes the slot of the one just unstarred.
	data.toggleFavourite('list', mon);
	data.toggleFavourite('list', tue);
	data.toggleFavourite('list', wed);
	assert.deepEqual(children(data, null), [wed, a, b]);

	// Inside a Favourites folder, the new star joins that folder.
	const work = data.createFavouriteFolder('Work', null);
	data.moveFavourite({ type: 'list', id: wed }, work);
	data.toggleFavourite('list', wed);
	data.toggleFavourite('list', mon);
	assert.deepEqual(children(data, work), [mon]);
	assert.deepEqual(children(data, null), [a, b, work]);
});
