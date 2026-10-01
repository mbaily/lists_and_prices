import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { createApp, merge, root } from './helpers/app.mjs';

function fixture() {
    const app = createApp();
    const folder = app.data.createFolder('Errands', null);
    const list = app.data.createList('Shopping #supermarket', folder, 'plain');
    const todo = app.data.createItem(list, 'Milk');
    const note = app.data.createItem(list, 'Voucher', null, null, true);
    return { app, folder, list, todo, note };
}
function revision(app, id) {
    const item = app.data.readAllItems().find(item => item.id === id);
    const list = app.data.readLists().find(list => list.id === item.listId);
    const folder = app.data.readFolders().find(folder => folder.id === list.folderId);
    return app.data.nearbyItemFingerprint(item, list, folder);
}
function entry(app, id) { return { id, fingerprint: revision(app, id) }; }
function hidden(app, id) {
    const item = app.data.readAllItems().find(item => item.id === id);
    const list = app.data.readLists().find(list => list.id === item.listId);
    const folder = app.data.readFolders().find(folder => folder.id === list.folderId);
    return app.load('src/lib/nearbyChecklist.ts').isChecklistDismissed(app.data.readNearbyChecklist()[id], revision(app, id), !item.note && app.data.isItemDone(item, folder));
}

test('checklist membership persists across replicas without adding automatic undo actions', () => {
    const { app: a, todo, note } = fixture(); const b = createApp();
    try {
        const undoCount = a.store.getUndoCount();
        a.data.rememberNearbyChecklist([entry(a, todo), entry(a, note)]);
        assert.equal(a.store.getUndoCount(), undoCount);
        merge(a.doc, b.doc);
        assert.deepEqual(a.data.readNearbyChecklist(), b.data.readNearbyChecklist());
        a.data.dismissNearbyChecklist([entry(a, note)]);
        merge(a.doc, b.doc);
        assert.ok(hidden(a, note)); assert.ok(hidden(b, note));
        const state = b.data.readNearbyChecklist();
        b.data.rememberNearbyChecklist([entry(b, todo), entry(b, note)]);
        assert.deepEqual(b.data.readNearbyChecklist(), state, 'opening a screen does not reset dismissals');
        a.store.undoLastAction();
        assert.equal(hidden(a, note), false);
    } finally { a.dispose(); b.dispose(); }
});

test('dismissed notes and unchecked todos return on text, metadata or inherited list changes', () => {
    const { app, todo, note, list } = fixture();
    try {
        app.data.dismissNearbyChecklist([entry(app, todo), entry(app, note)]);
        app.data.updateItem(note, { name: 'Updated voucher' });
        assert.equal(hidden(app, note), false);
        assert.equal(hidden(app, todo), true);
        app.data.updateItem(todo, { qty: 2 });
        assert.equal(hidden(app, todo), false);
        app.data.rememberNearbyChecklist([entry(app, todo), entry(app, note)]);
        assert.equal(app.data.readNearbyChecklist()[todo].dismissed, false);
        app.data.dismissNearbyChecklist([entry(app, note)]);
        app.data.updateList(list, { name: 'Shopping #coles' });
        assert.equal(hidden(app, note), false);
    } finally { app.dispose(); }
});

test('rich-text formatting changes revive dismissed notes even if plain text is unchanged', () => {
    const { app, note } = fixture();
    try {
        app.data.dismissNearbyChecklist([entry(app, note)]);
        const before = app.data.readAllItems().find(item => item.id === note).name;
        app.data.getItemYText(app.doc, note).format(0, 3, { bold: true });
        assert.equal(app.data.readAllItems().find(item => item.id === note).name, before);
        assert.equal(hidden(app, note), false);
    } finally { app.dispose(); }
});

test('completed todos stay checked until cleared, edits do not revive them, and unchecking does', () => {
    const { app, todo } = fixture();
    try {
        app.data.rememberNearbyChecklist([entry(app, todo)]);
        app.data.setNearbyTodoDone(todo, true);
        assert.equal(hidden(app, todo), false);
        app.data.dismissNearbyChecklist([entry(app, todo)]);
        assert.equal(app.data.readAllItems().find(item => item.id === todo).checked, true);
        app.data.updateItem(todo, { name: 'Milk updated', qty: 3 });
        assert.equal(hidden(app, todo), true);
        app.data.setNearbyTodoDone(todo, false);
        assert.equal(hidden(app, todo), false);
        app.data.rememberNearbyChecklist([entry(app, todo)]);
        app.data.setNearbyTodoDone(todo, true);
        assert.equal(hidden(app, todo), false, 'revived items can be completed and retained again');
    } finally { app.dispose(); }
});

test('completing a revived dismissed todo before registration retains its checked checklist row', () => {
    const { app, todo } = fixture();
    try {
        app.data.dismissNearbyChecklist([entry(app, todo)]);
        app.data.updateItem(todo, { name: 'Buy milk instead' });
        app.data.setNearbyTodoDone(todo, true);
        assert.equal(hidden(app, todo), false);
    } finally { app.dispose(); }
});

test('nearby checkbox toggles the last named checkbox, preserves other checks and never checks notes', () => {
    const { app, folder, todo, note } = fixture();
    try {
        const first = app.data.addFolderCheckbox(folder, 'Bought');
        const last = app.data.addFolderCheckbox(folder, 'Put away');
        app.data.setItemCheckboxState(todo, first, true);
        app.data.setNearbyTodoDone(todo, true);
        let item = app.data.readAllItems().find(item => item.id === todo);
        assert.equal(item.checks[first], true); assert.equal(item.checks[last], true);
        assert.equal(app.data.isItemDone(item, app.data.readFolders()[0]), true);
        app.data.setNearbyTodoDone(todo, false);
        item = app.data.readAllItems().find(item => item.id === todo);
        assert.equal(item.checks[first], true); assert.equal(item.checks[last], false);
        app.data.setNearbyTodoDone(note, true);
        assert.equal(app.data.readAllItems().find(item => item.id === note).checked, false);
        assert.deepEqual(app.data.readAllItems().find(item => item.id === note).checks, {});
    } finally { app.dispose(); }
});

test('checklist state survives backup/history and invalid imports fail before replacing data', () => {
    const { app, note, todo } = fixture();
    try {
        app.data.rememberNearbyChecklist([entry(app, todo)]);
        app.data.dismissNearbyChecklist([entry(app, note)]);
        const backup = JSON.parse(JSON.stringify(app.data.exportBackup()));
        app.doc.getMap('nearby-checklist').clear();
        app.data.importBackup(backup, 'replace');
        assert.deepEqual(app.data.readNearbyChecklist(), backup.nearbyChecklist);
        assert.ok(hidden(app, note));
        const invalid = { ...backup, nearbyChecklist: { [note]: { fingerprint: 'invalid', dismissed: true } } };
        assert.throws(() => app.data.importBackup(invalid, 'replace'), /Invalid nearby checklist/);
        assert.deepEqual(app.data.readNearbyChecklist(), backup.nearbyChecklist);
        app.store.createCommit('Checklist');
        app.doc.getMap('nearby-checklist').clear();
        app.store.viewCommit(app.store.readCommits()[0].id);
        assert.ok(hidden(app, note));
        assert.throws(() => app.data.dismissNearbyChecklist([entry(app, note)]), /read-only/);
        assert.throws(() => app.data.setNearbyTodoDone(todo, true), /read-only/);
        app.store.exitCommitView();
        const legacy = { ...backup }; delete legacy.nearbyChecklist;
        app.data.importBackup(backup, 'replace');
        app.data.importBackup(legacy, 'merge');
        assert.ok(hidden(app, note));
        app.data.importBackup(legacy, 'replace');
        assert.deepEqual(app.data.readNearbyChecklist(), {});
    } finally { app.dispose(); }
});

test('completed candidates can be read without reviving archived, deleted or untagged items', () => {
    const { app, todo, note, list, folder } = fixture();
    try {
        const { collectErrands } = app.load('src/lib/nearbyErrands.ts');
        const read = () => collectErrands(app.data.readAllItems(), app.data.readLists(), app.data.readFolders(), true);
        app.data.setNearbyTodoDone(todo, true);
        assert.deepEqual(read().map(errand => errand.item.id), [todo, note]);
        assert.deepEqual(collectErrands(app.data.readAllItems(), app.data.readLists(), app.data.readFolders()).map(errand => errand.item.id), [note]);
        app.data.updateFolder(folder, { archived: true }); assert.equal(read().length, 0);
        app.data.updateFolder(folder, { archived: false });
        app.data.updateList(list, { name: 'Shopping' }); assert.equal(read().length, 0);
        app.data.updateItem(note, { name: 'Voucher #coles' }); assert.equal(read().length, 1);
        app.data.deleteItem(note); assert.equal(read().length, 0);
    } finally { app.dispose(); }
});

test('bank reminders enter the checklist without locations and stay out of missing-location counts', () => {
    const { app, list } = fixture();
    try {
        const nearby = app.load('src/lib/nearbyErrands.ts');
        app.data.updateList(list, { name: 'Banking #BANK' });
        const bank = app.data.createItem(list, 'Withdraw cash');
        const other = app.data.createItem(list, 'Collect parcel #postoffice');
        const errands = nearby.collectErrands(app.data.readAllItems(), app.data.readLists(), app.data.readFolders());
        const bankErrand = errands.find(errand => errand.item.id === bank);
        assert.equal(nearby.isLocationOptionalErrand(bankErrand), true);
        assert.equal(nearby.isLocationOptionalErrand(errands.find(errand => errand.item.id === other)), false);
        assert.equal(nearby.isErrandPaused(bankErrand, ['bank']), true);
        // Exercise the screen's eligibility and routing expressions with no catalogue matches.
        const screen = readFileSync(path.join(root, 'src/lib/components/NearbyErrandsScreen.svelte'), 'utf8');
        const derive = (name, scope) => {
            const expression = screen.match(new RegExp(`const ${name} = \\$derived\\((.*)\\);`))[1];
            return new Function(...Object.keys(scope), `return ${expression}`)(...Object.values(scope));
        };
        const candidates = errands.map(errand => ({ errand, done: false, hidden: false, paused: false }));
        const nearbyIds = new Set(app.load('src/lib/nearbyPills.ts').nearbyTaskPills([], errands).map(pill => pill.errand.item.id));
        const scope = { candidates, supportedIds: new Set(), nearbyIds, isLocationOptionalErrand: nearby.isLocationOptionalErrand };
        assert.ok(derive('checklist', scope).some(row => row.errand.item.id === bank));
        assert.ok(!derive('checklist', scope).some(row => row.errand.item.id === other));
        const withDistantTask = derive('checklist', { ...scope, supportedIds: new Set([other]) });
        assert.ok(withDistantTask.findIndex(row => row.errand.item.id === bank) < withDistantTask.findIndex(row => row.errand.item.id === other));
        assert.equal(nearbyIds.has(bank), true);
        const locationErrands = derive('locationErrands', { errands, locationIds: new Set(), isLocationOptionalErrand: nearby.isLocationOptionalErrand });
        assert.ok(!nearby.suggestStops([], locationErrands).unavailable.some(errand => errand.item.id === bank));
        const matched = derive('locationErrands', { errands, locationIds: new Set([bank]), isLocationOptionalErrand: nearby.isLocationOptionalErrand });
        assert.ok(matched.some(errand => errand.item.id === bank), 'optional saved bank locations can still be suggested');
        app.data.rememberNearbyChecklist([entry(app, bank)]);
        app.data.setNearbyTodoDone(bank, true);
        assert.equal(hidden(app, bank), false);
        app.data.dismissNearbyChecklist([entry(app, bank)]);
        assert.equal(hidden(app, bank), true);
        app.data.setNearbyTodoDone(bank, false);
        assert.equal(hidden(app, bank), false);
    } finally { app.dispose(); }
});
