import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp, merge, componentFunctions, transpile } from './helpers/app.mjs';

test('nearby pills deduplicate tasks, strip inline hashtags and label the actual match', () => {
    const app = createApp();
    try {
        const { nearbyTaskPills } = app.load('src/lib/nearbyPills.ts');
        const first = { item: { id: 'todo', name: 'Buy\nmilk #coles #supermarket' }, list: { id: 'list' }, tags: ['coles', 'supermarket'] };
        const note = { item: { id: 'note', name: 'Check opening hours' }, list: { id: 'list' }, tags: ['supermarket'] };
        const woolworths = { id: 'woolworths', tags: ['woolworths'] };
        const coles = { id: 'coles', tags: ['coles'] };
        const pills = nearbyTaskPills([
            { location: woolworths, distanceKm: 1, errands: [first, note] },
            { location: coles, distanceKm: 2, errands: [first, note] }
        ]);
        assert.deepEqual(pills.map(({ errand, name, tag }) => ({ id: errand.item.id, name, tag })), [
            { id: 'todo', name: 'Buy milk', tag: 'supermarket' },
            { id: 'note', name: 'Check opening hours', tag: 'supermarket' }
        ]);
        assert.deepEqual(nearbyTaskPills([]), []);
    } finally { app.dispose(); }
});

test('bank errands appear without a location and are not duplicated by saved matches', () => {
    const app = createApp();
    try {
        const { nearbyTaskPills } = app.load('src/lib/nearbyPills.ts');
        const bank = { item: { id: 'bank', name: 'Withdraw cash #BANK' }, list: { id: 'list' }, tags: ['BANK'] };
        const note = { item: { id: 'note', name: 'Check account details' }, list: { id: 'list' }, tags: ['bank'] };
        const general = { item: { id: 'general', name: 'Post a letter #ERRAND' }, list: { id: 'list' }, tags: ['ERRAND'] };
        const other = { item: { id: 'other', name: 'Collect parcel #postoffice' }, list: { id: 'list' }, tags: ['postoffice'] };
        assert.deepEqual(nearbyTaskPills([], [bank, note, general, other]).map(({ errand, name, tag }) => ({ id: errand.item.id, name, tag })), [
            { id: 'bank', name: 'Withdraw cash', tag: 'bank' },
            { id: 'note', name: 'Check account details', tag: 'bank' },
            { id: 'general', name: 'Post a letter', tag: 'errand' }
        ]);
        const saved = { location: { id: 'saved-bank', tags: ['bank'] }, distanceKm: 1, errands: [bank] };
        assert.equal(nearbyTaskPills([saved], [bank]).length, 1);
    } finally { app.dispose(); }
});

test('recently modified ordering sorts whole pills, keeps ties stable and puts missing dates last', () => {
    const app = createApp();
    try {
        const { nearbyListPills } = app.load('src/lib/nearbyPills.ts');
        const errand = (id, updatedAt, inherited = false) => ({
            item: { id, name: inherited ? id : `${id} #errand`, updatedAt },
            list: { id: inherited ? 'group' : 'list' }, tags: ['errand'], inheritsListTags: inherited
        });
        const errands = [
            errand('missing', null),
            errand('old', '2026-01-01T00:00:00Z'),
            errand('group-old', '2025-01-01T00:00:00Z', true),
            errand('tie', '2026-10-01T00:00:00Z'),
            errand('group-new', '2026-10-01T00:00:00Z', true),
            errand('invalid', 'invalid-date')
        ];
        const original = nearbyListPills([], errands, 1);
        const sorted = nearbyListPills([], errands, 1, true);
        assert.deepEqual(sorted.map(pill => pill.id), ['list:group', 'item:tie', 'item:old', 'item:missing', 'item:invalid']);
        assert.equal(sorted[0].name, 'group-old · +1 more', 'latest date includes tasks outside the visible preview');
        assert.deepEqual(sorted[0].errands.map(row => row.item.id), ['group-old', 'group-new']);
        assert.deepEqual(nearbyListPills([], errands, 1, false), original, 'off restores the existing order');
        assert.deepEqual(errands.map(row => row.item.id), ['missing', 'old', 'group-old', 'tie', 'group-new', 'invalid']);
        assert.deepEqual(nearbyListPills([], [], 3, true), []);
    } finally { app.dispose(); }
});

test('recently modified preference syncs, restores from backups and respects undo and history', () => {
    const a = createApp(), b = createApp();
    try {
        assert.equal(a.data.readNearbyRecentlyModifiedFirst(), false);
        const handler = new Function('saveNearbyRecentlyModifiedFirst', 'commitState', 'recentlyModifiedFirst',
            transpile(componentFunctions('src/lib/components/NearbyErrandsScreen.svelte', ['setRecentlyModifiedFirst'])) + '\nreturn setRecentlyModifiedFirst;'
        )(a.data.saveNearbyRecentlyModifiedFirst, a.store.commitState, true);
        handler({ currentTarget: { checked: true } });
        assert.equal(a.data.readNearbyRecentlyModifiedFirst(), true);
        merge(a.doc, b.doc);
        assert.equal(b.data.readNearbyRecentlyModifiedFirst(), true);
        const backup = JSON.parse(JSON.stringify(a.data.exportBackup()));
        assert.equal(backup.nearbyRecentlyModifiedFirst, true);
        a.store.getUndoManager().clear();
        a.data.saveNearbyRecentlyModifiedFirst(false);
        a.store.undoLastAction();
        assert.equal(a.data.readNearbyRecentlyModifiedFirst(), true);
        a.store.createCommit('Recently modified enabled');
        a.data.saveNearbyRecentlyModifiedFirst(false);
        a.store.viewCommit(a.store.readCommits()[0].id);
        assert.equal(a.data.readNearbyRecentlyModifiedFirst(), true);
        assert.throws(() => a.data.saveNearbyRecentlyModifiedFirst(false), /read-only/);
        handler({ currentTarget: { checked: false } });
        assert.equal(a.data.readNearbyRecentlyModifiedFirst(), true, 'toggle handler ignores historical changes');
        a.store.exitCommitView();
        assert.equal(a.data.readNearbyRecentlyModifiedFirst(), false);
        a.data.importBackup(backup, 'replace');
        assert.equal(a.data.readNearbyRecentlyModifiedFirst(), true);
        for (const invalid of [null, 'true', 1]) {
            assert.throws(() => a.data.saveNearbyRecentlyModifiedFirst(invalid), /Invalid nearby recently modified order/);
            assert.throws(() => a.data.importBackup({ ...backup, nearbyRecentlyModifiedFirst: invalid }, 'replace'), /Invalid nearby recently modified order/);
            assert.equal(a.data.readNearbyRecentlyModifiedFirst(), true);
        }
        const legacy = { ...backup };
        delete legacy.nearbyRecentlyModifiedFirst;
        a.data.importBackup(legacy, 'merge');
        assert.equal(a.data.readNearbyRecentlyModifiedFirst(), true);
        a.data.importBackup(legacy, 'replace');
        assert.equal(a.data.readNearbyRecentlyModifiedFirst(), false);
    } finally { a.dispose(); b.dispose(); }
});
