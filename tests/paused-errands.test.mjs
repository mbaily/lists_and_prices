import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp, merge } from './helpers/app.mjs';

test('pausing IKEA leaves groceries active, preserves originals and defers edited and new tasks', () => {
    const app = createApp();
    try {
        const folder = app.data.createFolder('Errands', null);
        const list = app.data.createList('Shopping #supermarket', folder, 'plain');
        const milk = app.data.createItem(list, 'Milk');
        const shelf = app.data.createItem(list, 'Shelf #IKEA');
        const mixed = app.data.createItem(list, 'Boxes #ikea #supermarket');
        const { collectErrands, isErrandPaused, nearbyStops, suggestStops } = app.load('src/lib/nearbyErrands.ts');
        const original = app.data.readAllItems();
        app.data.setErrandTagPaused('#IKEA', true);
        assert.deepEqual(app.data.readAllItems(), original);
        const active = () => collectErrands(app.data.readAllItems(), app.data.readLists(), app.data.readFolders())
            .filter(errand => !isErrandPaused(errand, app.data.readPausedErrandTags()));
        assert.deepEqual(active().map(errand => errand.item.id), [milk]);
        const shops = [
            { id: 'coles', name: 'Coles', tags: ['coles'], latitude: -37.81, longitude: 145 },
            { id: 'ikea', name: 'IKEA', tags: ['ikea'], latitude: -37.81, longitude: 145 }
        ];
        const plan = suggestStops(nearbyStops(shops, shops[0], 5, active()), active());
        assert.deepEqual(plan.suggested.map(stop => stop.location.id), ['coles']);
        assert.deepEqual(plan.unavailable, []);
        app.data.updateItem(shelf, { name: 'New shelf #ikea' });
        const lamp = app.data.createItem(list, 'Lamp #ikea', null, null, true);
        assert.deepEqual(active().map(errand => errand.item.id), [milk]);
        app.data.setErrandTagPaused('ikea', false);
        assert.deepEqual(new Set(active().map(errand => errand.item.id)), new Set([milk, shelf, mixed, lamp]));
        app.data.setErrandTagPaused('#woolies', true);
        assert.ok(isErrandPaused({ tags: ['#Woolworths'] }, app.data.readPausedErrandTags()));
    } finally { app.dispose(); }
});

test('independent tag pauses sync and resume without losing other concurrent pauses', () => {
    const a = createApp(), b = createApp();
    try {
        a.data.setErrandTagPaused('ikea', true);
        b.data.setErrandTagPaused('bunnings', true);
        merge(a.doc, b.doc);
        assert.deepEqual(a.data.readPausedErrandTags(), ['bunnings', 'ikea']);
        assert.deepEqual(b.data.readPausedErrandTags(), a.data.readPausedErrandTags());
        a.data.setErrandTagPaused('ikea', false);
        merge(a.doc, b.doc);
        assert.deepEqual(b.data.readPausedErrandTags(), ['bunnings']);
        a.store.undoLastAction();
        merge(a.doc, b.doc);
        assert.deepEqual(b.data.readPausedErrandTags(), ['bunnings', 'ikea']);
    } finally { a.dispose(); b.dispose(); }
});

test('pauses round-trip through backups and history, including older backups', () => {
    const app = createApp();
    try {
        app.data.setErrandTagPaused('ikea', true);
        const backup = JSON.parse(JSON.stringify(app.data.exportBackup()));
        app.data.setErrandTagPaused('ikea', false);
        app.data.importBackup(backup, 'replace');
        assert.deepEqual(app.data.readPausedErrandTags(), ['ikea']);
        app.store.createCommit('IKEA paused');
        app.data.setErrandTagPaused('ikea', false);
        app.store.viewCommit(app.store.readCommits()[0].id);
        assert.deepEqual(app.data.readPausedErrandTags(), ['ikea']);
        assert.throws(() => app.data.setErrandTagPaused('ikea', false), /read-only/);
        app.store.exitCommitView();
        assert.deepEqual(app.data.readPausedErrandTags(), []);
        app.data.setErrandTagPaused('ikea', true);
        delete backup.pausedErrandTags;
        app.data.importBackup(backup, 'merge');
        assert.deepEqual(app.data.readPausedErrandTags(), ['ikea']);
        app.data.importBackup(backup, 'replace');
        assert.deepEqual(app.data.readPausedErrandTags(), []);
        app.store.undoLastAction();
        assert.deepEqual(app.data.readPausedErrandTags(), ['ikea']);
    } finally { app.dispose(); }
});

test('invalid pause data is rejected before replacing existing tasks or preferences', () => {
    const app = createApp();
    try {
        app.data.setErrandTagPaused('ikea', true);
        for (const invalid of [null, 'ikea', {}, [null], ['bad tag'], ['#']]) {
            const backup = { ...app.data.exportBackup(), pausedErrandTags: invalid };
            assert.throws(() => app.data.importBackup(backup, 'replace'), /Invalid paused errand tags/);
            assert.deepEqual(app.data.readPausedErrandTags(), ['ikea']);
        }
        assert.throws(() => app.data.setErrandTagPaused('bad tag', true), /Invalid errand tag/);
    } finally { app.dispose(); }
});
