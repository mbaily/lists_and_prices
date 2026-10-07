import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp, merge, componentFunctions, transpile, Y } from './helpers/app.mjs';

const home = { id: 'custom-home', name: 'London home', tags: ['home'], latitude: 51.5074, longitude: -0.1278, startingPoint: true };
const overseas = { id: 'custom-overseas', name: 'New York office', tags: ['office'], latitude: 40.7128, longitude: -74.006 };
const starting = { latitude: home.latitude, longitude: home.longitude, source: 'custom', customLocationId: home.id, label: home.name, accuracy: null, updatedAt: '2026-10-07T01:00:00.000Z' };

function tasks(app) {
    const folder = app.data.createFolder('Errands', null);
    const list = app.data.createList('Tasks', folder, 'plain');
    return { folder, list, collect: () => app.load('src/lib/nearbyErrands.ts').collectErrands(app.data.readAllItems(), app.data.readLists(), app.data.readFolders()) };
}

test('No filter includes worldwide hashtag matches without an origin or radius and orders stops by name', () => {
    const app = createApp();
    try {
        const { list, collect } = tasks(app);
        const parcel = app.data.createItem(list, 'Collect parcel #home');
        const meeting = app.data.createItem(list, 'Attend meeting #office');
        const unknown = app.data.createItem(list, 'Unknown destination #missing');
        const bank = app.data.createItem(list, 'Withdraw cash #bank');
        const alternative = { ...overseas, id: 'custom-alternative', name: 'Zurich office', latitude: 47.3769, longitude: 8.5417 };
        const invalid = { ...overseas, id: 'custom-invalid', latitude: NaN };
        const locations = [alternative, overseas, invalid, home];
        const nearby = app.load('src/lib/nearbyErrands.ts');
        const errands = collect();
        const stops = nearby.nearbyStops(locations, null, 0, errands);
        assert.deepEqual(stops.map(stop => [stop.location.name, stop.distanceKm]), [
            ['London home', null], ['New York office', null], ['Zurich office', null]
        ]);
        assert.deepEqual(nearby.nearbyStops(locations, null, NaN, errands), stops);
        const plan = nearby.suggestStops(stops, errands);
        assert.deepEqual(plan.suggested.map(stop => stop.location.name), ['London home', 'New York office']);
        assert.deepEqual(plan.suggested.flatMap(stop => stop.errands.map(errand => errand.item.id)), [parcel, meeting]);
        assert.deepEqual(plan.alternatives.map(stop => stop.location.name), ['Zurich office']);
        assert.deepEqual(plan.unavailable.map(errand => errand.item.id), [unknown, bank]);
        const pills = app.load('src/lib/nearbyPills.ts').nearbyTaskPills;
        assert.deepEqual(new Set(pills(stops, errands).map(pill => pill.errand.item.id)), new Set([parcel, meeting, bank]));
        const filtered = nearby.nearbyStops(locations, home, 1, errands);
        assert.deepEqual(filtered.map(stop => stop.location.id), [home.id]);
        assert.equal(filtered[0].distanceKm, 0);
        assert.equal(pills(filtered, errands).some(pill => pill.errand.item.id === meeting), false);
    } finally { app.dispose(); }
});

test('No filter preserves task eligibility and individual and hashtag pauses', () => {
    const app = createApp();
    try {
        const { folder, list, collect } = tasks(app);
        const active = app.data.createItem(list, 'Active #home');
        const paused = app.data.createItem(list, 'Deferred #home');
        const taggedPause = app.data.createItem(list, 'Deferred office #office');
        const done = app.data.createItem(list, 'Done #home');
        const heading = app.data.createItem(list, 'Heading #home');
        app.data.updateItem(done, { checked: true });
        app.data.updateItem(heading, { heading: true });
        const archivedList = app.data.createList('Archived', folder, 'plain');
        app.data.createItem(archivedList, 'Archived #home');
        app.data.updateList(archivedList, { archived: true });
        app.data.setErrandItemPaused(paused, true);
        app.data.setErrandTagPaused('office', true);
        const nearby = app.load('src/lib/nearbyErrands.ts');
        const errands = collect().filter(errand => !nearby.isErrandPaused(errand, app.data.readPausedErrandTags(), app.data.readPausedErrandItemIds()));
        assert.deepEqual(nearby.nearbyStops([home, overseas], null, 5, errands).flatMap(stop => stop.errands.map(errand => errand.item.id)), [active]);
        assert.deepEqual(new Set(collect().map(errand => errand.item.id)), new Set([active, paused, taggedPause]));
    } finally { app.dispose(); }
});

test('the No filter choice syncs and reopens while retaining the last starting location', () => {
    const a = createApp(), b = createApp(), reopened = createApp();
    try {
        assert.equal(a.data.readNearbyLocationFilterEnabled(), true);
        a.data.saveCustomLocation(home);
        a.data.saveStartingLocation(starting);
        const saved = a.data.readStartingLocation();
        a.data.saveNearbyLocationFilterEnabled(false);
        merge(a.doc, b.doc);
        Y.applyUpdate(reopened.doc, Y.encodeStateAsUpdate(a.doc), 'persisted');
        for (const app of [a, b, reopened]) {
            assert.equal(app.data.readNearbyLocationFilterEnabled(), false);
            assert.deepEqual(app.data.readStartingLocation(), saved);
        }
        b.data.saveStartingLocation(starting);
        merge(a.doc, b.doc);
        assert.equal(a.data.readNearbyLocationFilterEnabled(), true);
        a.data.saveNearbyLocationFilterEnabled(false);
        b.data.saveStartingLocation({ latitude: 40.7128, longitude: -74.006, source: 'gps', label: 'Last GPS location', accuracy: 10, updatedAt: starting.updatedAt });
        merge(a.doc, b.doc);
        assert.equal(a.data.readNearbyLocationFilterEnabled(), b.data.readNearbyLocationFilterEnabled());
        assert.deepEqual(a.data.readStartingLocation(), b.data.readStartingLocation());
    } finally { a.dispose(); b.dispose(); reopened.dispose(); }
});

test('No filter participates in validated backups and supports legacy merge and replace', () => {
    const app = createApp();
    try {
        const { list } = tasks(app);
        const item = app.data.createItem(list, 'Preserve this task');
        app.data.saveNearbyLocationFilterEnabled(false);
        const backup = JSON.parse(JSON.stringify(app.data.exportBackup()));
        assert.equal(backup.nearbyLocationFilterEnabled, false);
        app.data.saveNearbyLocationFilterEnabled(true);
        app.data.importBackup(backup, 'replace');
        assert.equal(app.data.readNearbyLocationFilterEnabled(), false);
        for (const invalid of [null, 'false', 0, {}]) {
            assert.throws(() => app.data.importBackup({ ...backup, items: [], nearbyLocationFilterEnabled: invalid }, 'replace'), /Invalid nearby location filter/);
            assert.equal(app.data.readAllItems()[0].id, item);
            assert.equal(app.data.readNearbyLocationFilterEnabled(), false);
            assert.throws(() => app.data.saveNearbyLocationFilterEnabled(invalid), /Invalid nearby location filter/);
        }
        const legacy = { ...backup }; delete legacy.nearbyLocationFilterEnabled;
        app.data.importBackup(legacy, 'merge');
        assert.equal(app.data.readNearbyLocationFilterEnabled(), false);
        app.data.importBackup(legacy, 'replace');
        assert.equal(app.data.readNearbyLocationFilterEnabled(), true);
    } finally { app.dispose(); }
});

test('selecting an origin re-enables filtering atomically, and undo and history restore No filter', () => {
    const app = createApp();
    try {
        app.data.saveCustomLocation(home);
        app.data.saveStartingLocation(starting);
        const saved = app.data.readStartingLocation();
        app.data.saveNearbyLocationFilterEnabled(false);
        app.store.createCommit('No filter');
        const changes = [];
        const observer = () => changes.push([app.data.readNearbyLocationFilterEnabled(), app.data.readStartingLocation()?.source]);
        app.doc.on('afterTransaction', observer);
        app.data.saveStartingLocation({ latitude: 40.7128, longitude: -74.006, source: 'gps', label: 'Last GPS location', accuracy: 10, updatedAt: starting.updatedAt });
        app.doc.off('afterTransaction', observer);
        assert.deepEqual(changes, [[true, 'gps']]);
        app.store.undoLastAction();
        assert.equal(app.data.readNearbyLocationFilterEnabled(), false);
        assert.deepEqual(app.data.readStartingLocation(), saved);
        app.data.saveStartingLocation(starting);
        app.store.viewCommit(app.store.readCommits()[0].id);
        assert.equal(app.data.readNearbyLocationFilterEnabled(), false);
        assert.throws(() => app.data.saveNearbyLocationFilterEnabled(true), /read-only/);
        app.store.exitCommitView();
        assert.equal(app.data.readNearbyLocationFilterEnabled(), true);
    } finally { app.dispose(); }
});

test('No filter cancels pending GPS callbacks and selecting a starting-point pill restores filtering', () => {
    const app = createApp();
    try {
        let gpsSuccess, gpsError;
        const state = {
            requestVersion: 0, locating: false, locationError: 'Previous error', showLocations: true, showLocationDetails: true,
            commitState: app.store.commitState, saveStartingLocation: app.data.saveStartingLocation,
            saveNearbyLocationFilterEnabled: app.data.saveNearbyLocationFilterEnabled,
            navigator: { geolocation: { getCurrentPosition: (success, error) => { gpsSuccess = success; gpsError = error; } } }
        };
        const source = componentFunctions('src/lib/components/NearbyErrandsScreen.svelte', ['useGps', 'selectNoFilter', 'selectSuburb']);
        const handlers = new Function('state', `with(state) { ${transpile(source)}; return { useGps, selectNoFilter, selectSuburb }; }`)(state);
        handlers.useGps();
        assert.equal(state.locating, true);
        handlers.selectNoFilter();
        assert.equal(state.locating, false);
        assert.equal(state.locationError, '');
        assert.equal(state.showLocations, false);
        assert.equal(state.showLocationDetails, false);
        gpsSuccess({ coords: { latitude: 0, longitude: 0, accuracy: 5 } });
        gpsError({ code: 1 });
        assert.equal(app.data.readNearbyLocationFilterEnabled(), false);
        assert.equal(app.data.readStartingLocation(), null);
        assert.equal(state.locationError, '');
        handlers.selectSuburb({ name: 'Test suburb', latitude: -37.8136, longitude: 144.9631 });
        assert.equal(app.data.readNearbyLocationFilterEnabled(), true);
        assert.equal(app.data.readStartingLocation().label, 'Test suburb');
        handlers.selectNoFilter();
        handlers.useGps();
        gpsSuccess({ coords: { latitude: 40.7128, longitude: -74.006, accuracy: 5 } });
        assert.equal(app.data.readNearbyLocationFilterEnabled(), true);
        assert.equal(app.data.readStartingLocation().source, 'gps');
        state.commitState.isHistorical = true;
        handlers.selectNoFilter();
        assert.equal(app.data.readNearbyLocationFilterEnabled(), true);
    } finally { app.dispose(); }
});
