import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp } from './helpers/app.mjs';

test('all Melbourne suburbs have valid unique location hashtags and centres', () => {
    const app = createApp();
    try {
        const { suburbLocations } = app.load('src/lib/suburbLocations.ts');
        const catalogue = app.load('src/lib/locations/melbourne-suburbs.json');
        const { validateLocations, availableLocationTags, matchingLocationTags } = app.load('src/lib/retailLocations.ts');
        validateLocations(suburbLocations);
        assert.equal(suburbLocations.length, catalogue.suburbs.length);
        assert.equal(new Set(suburbLocations.flatMap(location => location.tags)).size, suburbLocations.length);
        for (const suburb of catalogue.suburbs) {
            const location = suburbLocations.find(location => location.id === `suburb-${suburb.id}`);
            assert.equal(location.latitude, suburb.latitude);
            assert.equal(location.longitude, suburb.longitude);
            assert.equal(location.coordinateAccuracy, 'suburb');
        }
        for (const tag of ['brunswick', 'richmond', 'brunswickeast', 'stkilda', 'mountwaverley']) {
            assert.ok(availableLocationTags(suburbLocations).some(entry => entry.tag === tag && entry.count === 1));
        }
        const brunswick = suburbLocations.find(location => location.tags.includes('brunswick'));
        assert.deepEqual(matchingLocationTags(['#BRUNSWICK'], brunswick), ['brunswick']);
    } finally { app.dispose(); }
});

test('suburb hashtags match inherited todos and notes within the selected radius', () => {
    const app = createApp();
    try {
        const { suburbLocations } = app.load('src/lib/suburbLocations.ts');
        const { collectErrands, nearbyStops } = app.load('src/lib/nearbyErrands.ts');
        const folder = app.data.createFolder('Errands', null);
        const list = app.data.createList('Visit #brunswickeast', folder, 'plain');
        const todo = app.data.createItem(list, 'Visit friend');
        const note = app.data.createItem(list, 'Remember the keys', null, todo, true);
        app.data.createItem(list, 'Buy milk #coles');
        const errands = collectErrands(app.data.readAllItems(), app.data.readLists(), app.data.readFolders());
        const centre = suburbLocations.find(location => location.tags.includes('brunswickeast'));
        const stops = nearbyStops(suburbLocations, centre, 1, errands);
        assert.equal(stops.length, 1);
        assert.equal(stops[0].location.id, centre.id);
        assert.deepEqual(stops[0].errands.map(errand => errand.item.id).sort(), [todo, note].sort());
        assert.deepEqual(nearbyStops(suburbLocations, { latitude: -38.5, longitude: 145 }, 1, errands), []);
    } finally { app.dispose(); }
});
