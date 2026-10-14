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

test('recently modified ordering sorts source lists, keeps ties stable and puts missing dates last', () => {
    const app = createApp();
    try {
        const { nearbyListPills } = app.load('src/lib/nearbyPills.ts');
        const errand = (id, updatedAt, inherited = false) => ({
            item: { id, name: inherited ? id : `${id} #errand`, updatedAt },
            list: { id: inherited ? 'group' : `list-${id}` }, tags: ['errand'], inheritsListTags: inherited
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

test('recently modified ordering keeps every pill from the same list in source order', () => {
    const app = createApp();
    try {
        const { nearbyListPills } = app.load('src/lib/nearbyPills.ts');
        const errand = (id, listId, updatedAt, inherited = false) => ({
            item: { id, name: inherited ? id : `${id} #errand`, updatedAt },
            list: { id: listId }, tags: ['errand'], inheritsListTags: inherited
        });
        const errands = [
            errand('other', 'other-list', '2026-10-03T00:00:00Z'),
            errand('first', 'source-list', null),
            errand('group-first', 'source-list', '2026-01-01T00:00:00Z', true),
            errand('last', 'source-list', '2026-10-04T00:00:00Z'),
            errand('group-last', 'source-list', '2026-10-02T00:00:00Z', true),
            { ...errand('unmatched', 'other-list', '2030-01-01T00:00:00Z'), tags: ['kmart'] }
        ];
        const original = nearbyListPills([], errands, 1);
        assert.deepEqual(original.map(pill => pill.id), ['item:other', 'item:first', 'list:source-list', 'item:last']);
        const sorted = nearbyListPills([], errands, 1, true);
        assert.deepEqual(sorted.map(pill => pill.id), ['item:first', 'list:source-list', 'item:last', 'item:other'],
            'latest eligible task moves its whole source list ahead, retaining every pill position within it');
        assert.deepEqual(sorted.filter(pill => pill.list.id === 'source-list'), original.filter(pill => pill.list.id === 'source-list'));
        assert.equal(sorted[1].name, 'group-first · +1 more');
        assert.deepEqual(nearbyListPills([], errands.filter(row => row.list.id === 'source-list'), 1, true), sorted.slice(0, 3),
            'a single source list keeps exactly the same order when enabled');
        assert.deepEqual(nearbyListPills([], errands, 1, false), original);
    } finally { app.dispose(); }
});

test('recently modified preference syncs, restores from backups and respects undo and history', () => {
    const a = createApp(), b = createApp();
    try {
        assert.equal(a.data.readNearbyRecentlyModifiedFirst(), false);
        const handler = () => new Function('saveNearbyRecentlyModifiedFirst', 'commitState', 'recentlyModifiedFirst',
            transpile(componentFunctions('src/lib/components/NearbyErrandsScreen.svelte', ['toggleRecentlyModifiedFirst'])) + '\nreturn toggleRecentlyModifiedFirst;'
        )(a.data.saveNearbyRecentlyModifiedFirst, a.store.commitState, a.data.readNearbyRecentlyModifiedFirst())();
        handler();
        assert.equal(a.data.readNearbyRecentlyModifiedFirst(), true);
        handler();
        assert.equal(a.data.readNearbyRecentlyModifiedFirst(), false);
        handler();
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
        handler();
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
