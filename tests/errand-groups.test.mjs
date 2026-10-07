import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp, merge, componentFunctions, transpile } from './helpers/app.mjs';

test('todos, subtodos and notes in one list form one nearby pill with a limited inline preview', () => {
    const app = createApp();
    try {
        const folder = app.data.createFolder('Errands', null);
        const list = app.data.createList('Shopping #supermarket', folder, 'plain');
        const first = app.data.createItem(list, 'Milk');
        app.data.createItem(list, 'Bread', null, first);
        app.data.createItem(list, 'Check\nopening hours', null, null, true);
        const completed = app.data.createItem(list, 'Already bought');
        app.data.updateItem(completed, { checked: true });
        const otherList = app.data.createList('Shopping #supermarket', folder, 'plain');
        app.data.createItem(otherList, 'Apples');
        const nearby = app.load('src/lib/nearbyErrands.ts');
        const { nearbyListPills } = app.load('src/lib/nearbyPills.ts');
        const { groupErrands } = app.load('src/lib/errandGroups.ts');
        const errands = nearby.collectErrands(app.data.readAllItems(), app.data.readLists(), app.data.readFolders());
        const shop = { id: 'coles', name: 'Coles', tags: ['coles'], latitude: -37.8, longitude: 145 };
        const stops = nearby.nearbyStops([shop, { ...shop, id: 'coles-other' }], shop, 5, errands);
        const pills = nearbyListPills(stops, errands, 2);
        assert.equal(pills.length, 2, 'different list IDs remain separate even with identical names');
        const grouped = pills.find(pill => pill.list.id === list);
        assert.equal(grouped.errands.length, 3);
        assert.equal(grouped.name, 'Milk · Bread · +1 more');
        assert.deepEqual(grouped.tags, ['supermarket']);
        assert.equal(nearbyListPills(stops, errands, 3).find(pill => pill.list.id === list).name, 'Milk · Bread · Check opening hours');
        assert.deepEqual(nearbyListPills([], errands, 3), []);
        const rows = errands.map(errand => ({ errand, done: false }));
        assert.equal(groupErrands(rows).length, 2);
        assert.equal(groupErrands(rows)[0].rows[0], rows[0], 'grouping preserves task state and identity');
    } finally { app.dispose(); }
});

test('explicit bank errands stay separate from inherited general errands and can be paused individually', () => {
    const app = createApp();
    try {
        const folder = app.data.createFolder('Errands', null);
        const list = app.data.createList('Tasks #errand', folder, 'plain');
        const bank = app.data.createItem(list, 'Withdraw cash #bank');
        app.data.createItem(list, 'Post a letter');
        const nearby = app.load('src/lib/nearbyErrands.ts');
        const { nearbyListPills } = app.load('src/lib/nearbyPills.ts');
        const active = () => nearby.collectErrands(app.data.readAllItems(), app.data.readLists(), app.data.readFolders())
            .filter(errand => !nearby.isErrandPaused(errand, [], app.data.readPausedErrandItemIds()));
        const pills = nearbyListPills([], active(), 3);
        assert.equal(pills.length, 2);
        assert.equal(pills[0].name, 'Withdraw cash');
        assert.deepEqual(pills[0].tags, ['bank']);
        assert.equal(pills[1].name, 'Post a letter');
        assert.deepEqual(pills[1].tags, ['errand']);
        app.data.setErrandItemPaused(bank, true);
        assert.equal(nearbyListPills([], active(), 3)[0].name, 'Post a letter');
    } finally { app.dispose(); }
});

test('only inherited tasks share an errand across pills, checklist, stops and unmatched rows', () => {
    const app = createApp();
    try {
        const folder = app.data.createFolder('Errands', null);
        const list = app.data.createList('Shopping #supermarket', folder, 'plain');
        const milk = app.data.createItem(list, 'Milk');
        const bread = app.data.createItem(list, 'Bread');
        const bank = app.data.createItem(list, 'Deposit money $110 #bank');
        app.data.saveCustomLocation({ id: 'custom-court', name: 'Loyola Court', tags: ['loyolacrt'], latitude: -37.8, longitude: 145 });
        const bag = app.data.createItem(list, 'washing bag #loyolacrt', null, null, true);
        const separate = app.data.createItem(list, 'Separate purchase #supermarket', null, milk);
        const unmatched = app.data.createItem(list, 'Far away #pharmacy');
        const nearby = app.load('src/lib/nearbyErrands.ts');
        const { nearbyListPills } = app.load('src/lib/nearbyPills.ts');
        const { groupErrands } = app.load('src/lib/errandGroups.ts');
        const errands = nearby.collectErrands(app.data.readAllItems(), app.data.readLists(), app.data.readFolders());
        const shop = { id: 'shop', name: 'Shop', tags: ['supermarket'], latitude: -37.8, longitude: 145 };
        const court = { ...shop, id: 'court', name: 'Loyola Court', tags: ['loyolacrt'] };
        const stops = nearby.nearbyStops([shop, court], shop, 5, errands);
        const pills = nearbyListPills(stops, errands, 9);
        assert.equal(pills.length, 4);
        assert.equal(new Set(pills.map(pill => pill.id)).size, 4, 'same parent list uses unique UI keys');
        assert.deepEqual(pills.find(pill => pill.id === `list:${list}`).errands.map(errand => errand.item.id), [milk, bread]);
        for (const [id, tag] of [[bank, 'bank'], [bag, 'loyolacrt'], [separate, 'supermarket']]) {
            const pill = pills.find(pill => pill.id === `item:${id}`);
            assert.deepEqual(pill.errands.map(errand => errand.item.id), [id]);
            assert.deepEqual(pill.tags, [tag]);
        }
        assert.ok(!pills.some(pill => pill.errands.some(errand => errand.item.id === unmatched)), 'nearby siblings do not pull in an unmatched explicitly tagged task');
        assert.equal(groupErrands(errands.map(errand => ({ errand }))).length, 5);
        assert.equal(groupErrands(stops.find(stop => stop.location.id === 'shop').errands.map(errand => ({ errand }))).length, 2);
        assert.deepEqual(groupErrands([{ errand: errands.find(errand => errand.item.id === unmatched) }]).map(group => group.id), [`item:${unmatched}`]);
        const bankOnly = nearbyListPills([], errands, 9);
        assert.deepEqual(bankOnly.map(pill => pill.id), [`item:${bank}`], 'a standalone match does not make its inherited siblings nearby');
    } finally { app.dispose(); }
});

test('group checkbox completes only its parent, preserves all child data, and keeps explicit errands through sync and undo', () => {
    const a = createApp(), b = createApp();
    try {
        const folder = a.data.createFolder('Errands', null);
        const list = a.data.createList('Shopping #supermarket', folder, 'plain');
        const milk = a.data.createItem(list, 'Milk');
        a.data.createItem(list, 'Bread', null, milk);
        a.data.createItem(list, 'Voucher', null, null, true);
        const bank = a.data.createItem(list, 'Deposit money $110 #bank');
        a.data.saveCustomLocation({ id: 'custom-court', name: 'Loyola Court', tags: ['loyolacrt'], latitude: -37.8, longitude: 145 });
        const bag = a.data.createItem(list, 'washing bag #loyolacrt', null, null, true);
        const done = a.data.createItem(list, 'Already done #bank');
        const box = a.data.addFolderCheckbox(folder, 'Finished');
        a.data.setItemCheckboxState(done, box, true);
        const another = a.data.createList('Other #supermarket', folder, 'plain');
        const other = a.data.createItem(another, 'Apples');
        const before = a.data.readAllItems();
        merge(a.doc, b.doc);
        const collect = app => app.load('src/lib/nearbyErrands.ts').collectErrands(app.data.readAllItems(), app.data.readLists(), app.data.readFolders());
        const originalIds = collect(a).map(errand => errand.item.id);
        const handler = new Function('updateList', 'commitState', transpile(componentFunctions('src/lib/components/NearbyErrandsScreen.svelte', ['setGroupDone'])) + '\nreturn setGroupDone;')(a.data.updateList, a.store.commitState);
        a.store.getUndoManager().clear();
        handler(list, true);
        assert.equal(a.data.readLists().find(entry => entry.id === list).done, true);
        assert.equal(a.data.readLists().find(entry => entry.id === another).done, false);
        assert.deepEqual(a.data.readAllItems(), before, 'neither checkbox maps nor any other item data changes');
        assert.deepEqual(collect(a).map(errand => errand.item.id), [bank, bag, other]);
        assert.equal(a.store.getUndoCount(), 1);
        merge(a.doc, b.doc);
        assert.deepEqual(b.data.readAllItems(), before);
        assert.deepEqual(collect(b).map(errand => errand.item.id), [bank, bag, other]);
        a.store.undoLastAction();
        assert.deepEqual(collect(a).map(errand => errand.item.id), originalIds, 'undo restores the inherited group');
        assert.deepEqual(a.data.readAllItems(), before);
        handler(list, true);
        handler(list, false);
        assert.deepEqual(collect(a).map(errand => errand.item.id), originalIds, 'unchecking the parent restores inherited tasks');
        a.store.createCommit('Original group');
        a.store.viewCommit(a.store.readCommits()[0].id);
        handler(list, true);
        assert.equal(a.data.readLists().find(entry => entry.id === list).done, false, 'history disables the group checkbox');
        a.store.exitCommitView();
        a.data.updateFolder(folder, { archived: true });
        assert.deepEqual(collect(a), [], 'explicit errands still respect archived parents');
    } finally { a.dispose(); b.dispose(); }
});

test('preview limit syncs and survives backups, undo and history with validated imports', () => {
    const a = createApp(), b = createApp();
    try {
        assert.equal(a.data.readNearbyPreviewLimit(), 3);
        a.data.saveNearbyPreviewLimit(5);
        merge(a.doc, b.doc);
        assert.equal(b.data.readNearbyPreviewLimit(), 5);
        const backup = JSON.parse(JSON.stringify(a.data.exportBackup()));
        assert.equal(backup.nearbyPreviewLimit, 5);
        a.store.getUndoManager().clear();
        a.data.saveNearbyPreviewLimit(2);
        a.store.undoLastAction();
        assert.equal(a.data.readNearbyPreviewLimit(), 5);
        a.store.createCommit('Five items');
        a.data.saveNearbyPreviewLimit(2);
        a.store.viewCommit(a.store.readCommits()[0].id);
        assert.equal(a.data.readNearbyPreviewLimit(), 5);
        assert.throws(() => a.data.saveNearbyPreviewLimit(4), /read-only/);
        a.store.exitCommitView();
        for (const invalid of [0, 51, 1.5, NaN, '3', null]) {
            assert.throws(() => a.data.saveNearbyPreviewLimit(invalid), /Invalid nearby preview limit/);
            assert.throws(() => a.data.importBackup({ ...backup, nearbyPreviewLimit: invalid }, 'replace'), /Invalid nearby preview limit/);
            assert.equal(a.data.readNearbyPreviewLimit(), 2);
        }
        a.data.importBackup(backup, 'replace');
        assert.equal(a.data.readNearbyPreviewLimit(), 5);
        assert.throws(() => a.data.saveNearbyPreviewLimit(10), /Invalid nearby preview limit/);
        a.data.importBackup({ ...backup, nearbyPreviewLimit: 50 }, 'replace');
        assert.equal(a.data.readNearbyPreviewLimit(), 9);
        assert.equal(a.data.exportBackup().nearbyPreviewLimit, 9);
        a.data.importBackup(backup, 'replace');
        const legacy = { ...backup }; delete legacy.nearbyPreviewLimit;
        a.data.importBackup(legacy, 'merge');
        assert.equal(a.data.readNearbyPreviewLimit(), 5);
        a.data.importBackup(legacy, 'replace');
        assert.equal(a.data.readNearbyPreviewLimit(), 3);
    } finally { a.dispose(); b.dispose(); }
});
