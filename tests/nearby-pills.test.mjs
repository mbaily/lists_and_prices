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
