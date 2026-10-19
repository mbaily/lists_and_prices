// @ts-nocheck -- Includes deliberately malformed files and legacy formats.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp, Y, componentFunctions, transpile } from './helpers/app.mjs';

function app(t) { const value = createApp(); t.after(() => value.dispose()); return value; }
const clone = value => JSON.parse(JSON.stringify(value));
const withoutDate = ({ exported, ...value }) => value;

function fixture(t) {
	const c = app(t), d = c.data;
	const folder = d.createFolder('Trips', null, '#123456');
	const childFolder = d.createFolder('Journal', folder);
	d.updateFolder(childFolder, { favourite: true, localNav: true, foldersFirst: false, filterView: 'unchecked' });
	const box = d.addFolderCheckbox(folder, 'Packed');
	const list = d.createList('Packing', folder, 'priced');
	d.addFolderDefaultItem(folder, 'Plan the trip', true);
	d.updateList(list, { journalMode: true, defaultIsNote: true, favourite: true });
	const parent = d.createItem(list, 'Bag', 12.5);
	d.setItemCheckboxState(parent, box, true);
	d.updateItem(parent, { qty: 2, pinned: true, heading: true });
	const note = d.createItem(list, '', null, parent, true);
	d.updateItem(note, { fullScreen: true });
	const richText = [
		{ insert: 'Bold', attributes: { bold: true } },
		{ insert: ' link', attributes: { link: 'https://example.test/' } },
		{ insert: '\n', attributes: { header: 2 } }
	];
	c.doc.getText('note_text_' + note).applyDelta(richText);
	c.reports.assignToReport(folder, 'Travel');
	const sheet = d.createSheet('Older budget', folder);
	d.setCell(sheet, 0, 0, '00123'); d.setCell(sheet, 1, 0, '=SUM(B1:B3)');
	d.saveCustomLocation({ id: 'custom-home', name: 'Home', tags: ['home'], latitude: -37.8, longitude: 145, startingPoint: true });
	d.saveStartingLocation({ source: 'custom', customLocationId: 'custom-home', label: 'Home', latitude: -37.8, longitude: 145, accuracy: null, updatedAt: new Date().toISOString() });
	d.saveNearbyLocationFilterEnabled(false);
	d.saveHotSuburbIds([]); d.saveNearbyPreviewLimit(7); d.saveNearbyRecentlyModifiedFirst(true);
	d.setErrandTagPaused('shopping', true); d.setErrandItemPaused(parent, true);
	d.rememberNearbyChecklist([{ id: parent, fingerprint: 'a'.repeat(64) }]);
	return { c, d, folder, list, parent, note, sheet, richText };
}

for (const mode of ['merge', 'replace']) {
	test(`${mode}: current features, rich notes and stored spreadsheet cells round-trip and undo together`, t => {
		const f = fixture(t), target = app(t);
		const beforeExport = Y.encodeStateAsUpdate(f.c.doc);
		const backup = f.d.parseBackup(JSON.stringify(f.d.exportBackup()));
		assert.equal(backup.version, 2);
		assert.deepEqual(Y.encodeStateAsUpdate(f.c.doc), beforeExport, 'Export must not migrate or mutate data');
		assert.deepEqual(backup.items.find(item => item.id === f.note).richText, f.richText);
		assert.deepEqual(backup.sheets[0].cells, { '0,0': '00123', '1,0': '=SUM(B1:B3)' });
		target.data.importBackup(backup, 'replace');
		assert.deepEqual(withoutDate(target.data.exportBackup()), withoutDate(backup), 'All current feature sections must survive JSON and a fresh client');
		target.doc.getText('note_text_' + f.note).format(0, 4, { bold: null, italic: true });
		target.data.setCell(f.sheet, 2, 2, 'Later cell');
		const unrelated = target.data.createFolder('Keep only on merge', null);
		const beforeRestore = withoutDate(target.data.exportBackup());
		target.store.getUndoManager().clear();
		target.data.importBackup(backup, mode);
		assert.deepEqual(target.doc.getText('note_text_' + f.note).toDelta(), f.richText);
		assert.deepEqual(target.data.readCells(f.sheet), backup.sheets[0].cells);
		assert.equal(target.data.readFolders().some(folder => folder.id === unrelated), mode === 'merge');
		assert.equal(target.store.getUndoCount(), 1);
		assert.equal(target.store.undoLastAction(), true);
		assert.deepEqual(withoutDate(target.data.exportBackup()), beforeRestore, 'Undo must recover formatting, cells, preferences and records');
	});

	test(`${mode}: a version 1 file restores plain notes and handles missing spreadsheet cells safely`, t => {
		const f = fixture(t), old = clone(f.d.exportBackup());
		old.version = 1;
		for (const item of old.items) delete item.richText;
		for (const sheet of old.sheets) delete sheet.cells;
		f.d.setCell(f.sheet, 3, 3, 'Keep on legacy merge');
		f.d.importBackup(f.d.parseBackup('\uFEFF' + JSON.stringify(old)), mode);
		assert.deepEqual(f.c.doc.getText('note_text_' + f.note).toDelta(), [{ insert: 'Bold link' }]);
		assert.deepEqual(f.d.readCells(f.sheet), mode === 'merge' ? { '0,0': '00123', '1,0': '=SUM(B1:B3)', '3,3': 'Keep on legacy merge' } : {});
	});
}

test('invalid late records and optional sections reject before any replace or merge mutation', t => {
	const f = fixture(t), original = clone(f.d.exportBackup());
	const invalid = [
		value => { value.version = 99; },
		value => { value.futureFeature = {}; },
		value => { value.sheets = null; },
		value => { value.customLocations = null; },
		value => { value.smartFolders = null; },
		value => { value.items[1].listId = 42; },
		value => { delete value.items[1].listId; },
		value => { value.items[1].checked = 'false'; },
		value => { value.items[1].note = {}; },
		value => { value.lists[0].journalMode = 'yes'; },
		value => { value.items[1].price = Infinity; },
		value => { value.items[1].updatedAt = 'broken'; },
		value => { value.items[1].chk_injected = true; },
		value => { value.folders.push({ ...value.folders[0] }); },
		value => { value.folders[0].checkboxes.push({ ...value.folders[0].checkboxes[0] }); },
		value => { value.folders[0].parentId = value.folders[0].id; },
		value => { value.items[0].parentId = value.items[1].id; },
		value => { value.items[1].listId = 'another-list'; },
		value => { value.items[1].richText = [{ retain: 1 }]; },
		value => { value.items[1].richText = [{ insert: 'Different text' }]; },
		value => { value.items[1].richText[0].attributes = { bold: [] }; },
		value => { value.items[1].richText[0].attributes = JSON.parse('{"__proto__":true}'); },
		value => { value.sheets[0].cells['-1,0'] = 'invalid'; },
		value => { value.sheets[0].cells['9007199254740992,0'] = 'invalid'; },
		value => { value.sheets[0].cells['0,0'] = { nested: 'invalid' }; }
	];
	for (const mode of ['replace', 'merge']) for (const change of invalid) {
		const backup = clone(original); change(backup);
		const state = Y.encodeStateAsUpdate(f.c.doc);
		assert.throws(() => f.d.importBackup(backup, mode));
		assert.deepEqual(Y.encodeStateAsUpdate(f.c.doc), state, change.toString());
	}
});

test('parsing reports broken JSON and unsupported files without touching the document', t => {
	const { c, d } = fixture(t), before = Y.encodeStateAsUpdate(c.doc);
	for (const text of ['', '{"version":2,', 'null', '[]', '42', '{"version":3}', '{"version":2,"folders":[],"lists":[],"items":[null]}']) assert.throws(() => d.parseBackup(text));
	assert.deepEqual(Y.encodeStateAsUpdate(c.doc), before);
});

test('clipboard import preserves rich content, full-screen notes and children before parents', t => {
	const { c, d, list, richText } = fixture(t);
	const exported = [
		{ id: 'child', parentId: 'parent', name: 'Bold link', note: true, fullScreen: true, richText },
		{ id: 'parent', name: 'Imported parent' },
		{ id: 'detached', name: 'Copied without its parent', parentId: 'outside-selection' }
	];
	c.store.getUndoManager().clear();
	d.createItemsFromExport(list, exported, { addPosition: 'top' });
	const items = d.readItems(list), parent = items.find(item => item.name === 'Imported parent');
	const child = items.find(item => item.parentId === parent.id);
	assert.ok(child.note && child.fullScreen);
	assert.deepEqual(c.doc.getText('note_text_' + child.id).toDelta(), richText);
	assert.equal(items.find(item => item.name === 'Copied without its parent').parentId, null);
	assert.equal(c.store.getUndoCount(), 1);
	c.store.undoLastAction();
	assert.equal(d.readItems(list).some(item => item.name === 'Imported parent'), false);
});

test('clipboard copy includes formatting, paragraph endings and the full-screen flag', t => {
	const f = fixture(t);
	const source = componentFunctions('src/lib/components/ListScreen.svelte', ['serializeClipboardItems']);
	const state = { folderCheckboxes: [], getDoc: () => f.c.doc, readItemRichText: f.c.notes.readItemRichText };
	const serialize = new Function('state', `with(state) { ${transpile(source)}; return serializeClipboardItems; }`)(state);
	const output = JSON.parse(serialize(f.d.readItems(f.list).filter(item => item.id === f.note)));
	assert.equal(output.version, 2);
	assert.equal(output.items[0].fullScreen, true);
	assert.deepEqual(output.items[0].richText, f.richText);
});

test('embedded note content survives JSON and exported objects cannot mutate the source', t => {
	const f = fixture(t), target = app(t);
	const id = f.d.createItem(f.list, '', null, null, true);
	const content = [{ insert: { image: 'https://example.test/photo.png' } }, { insert: 'Caption\n' }];
	f.c.doc.getText('note_text_' + id).applyDelta(content);
	const exported = f.d.exportBackup(), saved = clone(exported);
	exported.items.find(item => item.id === id).richText[0].insert.image = 'changed only in export';
	assert.deepEqual(f.c.doc.getText('note_text_' + id).toDelta(), content);
	target.data.importBackup(target.data.parseBackup(JSON.stringify(saved)), 'replace');
	assert.deepEqual(target.doc.getText('note_text_' + id).toDelta(), content);
});

test('historical exports use the viewed snapshot and leave live data and saved versions unchanged', t => {
	const f = fixture(t);
	f.c.store.createCommit('Before editing');
	f.d.updateItem(f.parent, { name: 'Live edit' });
	const live = Y.encodeStateAsUpdate(f.c.doc);
	f.c.store.viewCommit(f.c.store.readCommits()[0].id);
	const backup = f.d.exportBackup();
	assert.equal(backup.items.find(item => item.id === f.parent).name, 'Bag');
	assert.deepEqual(backup.items.find(item => item.id === f.note).richText, f.richText);
	assert.equal('commits' in backup, false);
	assert.deepEqual(Y.encodeStateAsUpdate(f.c.doc), live);
	assert.throws(() => f.d.importBackup(backup, 'replace'), /read-only/);
});

function restoreProbe(data) {
	const readers = [], imports = [];
	class Reader {
		static LOADING = 1;
		readyState = 0;
		constructor() { readers.push(this); }
		readAsText() { this.readyState = 1; }
		abort() { this.readyState = 2; this.aborted = true; }
		complete(text) { this.readyState = 2; this.result = text; this.onload(); }
	}
	const input = { files: [], value: '' };
	const state = {
		isActive: true, idbSynced: { done: true }, commitState: { isHistorical: false },
		restoreContextVersion: 0, activeRestoreReader: null, pendingBackup: null,
		restoreFileInput: input, restoreStatus: null, restoreError: null, restoreMode: 'replace',
		FileReader: Reader, MAX_BACKUP_BYTES: 100 * 1024 * 1024, parseBackup: data.parseBackup,
		importBackup: (...args) => { imports.push(args); data.importBackup(...args); }
	};
	const source = componentFunctions('src/lib/components/SettingsScreen.svelte', ['cancelPendingRestore', 'onFileSelected', 'confirmRestore']);
	const handlers = new Function('state', `with(state) { ${transpile(source)}; return { cancelPendingRestore, onFileSelected, confirmRestore }; }`)(state);
	return { state, readers, imports, ...handlers, select(size = 123) {
		input.files = [{ size }]; input.value = 'selected.json'; handlers.onFileSelected({ target: input });
		return readers.at(-1);
	} };
}

test('file selection fully validates before confirmation and revalidates before applying', t => {
	const f = fixture(t), probe = restoreProbe(f.d), good = clone(f.d.exportBackup());
	const bad = clone(good); bad.sheets[0].cells['0,0'] = null;
	const before = Y.encodeStateAsUpdate(f.c.doc);
	probe.select().complete(JSON.stringify(bad));
	assert.equal(probe.state.pendingBackup, null);
	assert.match(probe.state.restoreError, /Invalid spreadsheet/);
	assert.deepEqual(probe.imports, []);
	probe.select().complete(JSON.stringify(good));
	assert.deepEqual(probe.state.pendingBackup, good);
	assert.deepEqual(Y.encodeStateAsUpdate(f.c.doc), before);
	probe.state.pendingBackup.items[0].checked = 'bad';
	probe.confirmRestore();
	assert.match(probe.state.restoreError, /Restore failed/);
	assert.deepEqual(Y.encodeStateAsUpdate(f.c.doc), before);
});

test('oversize files and selection during local loading never start a file read', t => {
	const { d } = fixture(t), probe = restoreProbe(d);
	probe.select(100 * 1024 * 1024 + 1);
	assert.equal(probe.readers.length, 0);
	assert.match(probe.state.restoreError, /100 MB/);
	probe.state.idbSynced.done = false;
	probe.select();
	assert.equal(probe.readers.length, 0);
});

test('old file reads cannot overwrite a newer selection or a cancelled history transition', t => {
	const { d } = fixture(t), probe = restoreProbe(d), backup = JSON.stringify(d.exportBackup());
	const first = probe.select(), second = probe.select();
	assert.equal(first.aborted, true);
	first.complete(backup);
	assert.equal(probe.state.pendingBackup, null);
	second.complete(backup);
	assert.ok(probe.state.pendingBackup);
	probe.state.commitState.isHistorical = true;
	probe.cancelPendingRestore();
	probe.confirmRestore();
	assert.equal(probe.state.pendingBackup, null);
	assert.deepEqual(probe.imports, []);
});
