import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp, merge } from './helpers/app.mjs';

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
        const { groupErrandsByList } = app.load('src/lib/errandGroups.ts');
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
        assert.equal(groupErrandsByList(rows).length, 2);
        assert.equal(groupErrandsByList(rows)[0].rows[0], rows[0], 'grouping preserves task state and identity');
    } finally { app.dispose(); }
});

test('grouped bank and general errands retain tags and exclude individually paused tasks', () => {
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
        assert.equal(pills.length, 1);
        assert.equal(pills[0].name, 'Withdraw cash · Post a letter');
        assert.deepEqual(pills[0].tags, ['bank', 'errand']);
        app.data.setErrandItemPaused(bank, true);
        assert.equal(nearbyListPills([], active(), 3)[0].name, 'Post a letter');
    } finally { app.dispose(); }
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
