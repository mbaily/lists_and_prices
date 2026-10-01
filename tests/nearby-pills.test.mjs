import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp } from './helpers/app.mjs';

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
        const other = { item: { id: 'other', name: 'Collect parcel #postoffice' }, list: { id: 'list' }, tags: ['postoffice'] };
        assert.deepEqual(nearbyTaskPills([], [bank, note, other]).map(({ errand, name, tag }) => ({ id: errand.item.id, name, tag })), [
            { id: 'bank', name: 'Withdraw cash', tag: 'bank' },
            { id: 'note', name: 'Check account details', tag: 'bank' }
        ]);
        const saved = { location: { id: 'saved-bank', tags: ['bank'] }, distanceKm: 1, errands: [bank] };
        assert.equal(nearbyTaskPills([saved], [bank]).length, 1);
    } finally { app.dispose(); }
});
