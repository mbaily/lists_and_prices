import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp, merge, componentFunctions, transpile, Y } from './helpers/app.mjs';

const home = { id: 'custom-london-home', name: 'London home', tags: ['home'], latitude: 51.5074, longitude: -0.1278, startingPoint: true };
const pharmacy = { id: 'custom-london-pharmacy', name: 'Local pharmacy', tags: ['pharmacy'], latitude: 51.508, longitude: -0.126 };
const starting = {
    latitude: home.latitude, longitude: home.longitude, source: 'custom', customLocationId: home.id,
    label: home.name, accuracy: null, updatedAt: '2026-10-07T01:00:00.000Z'
};

test('an overseas custom place works as both origin and destination without restricting other destination tags', () => {
    const app = createApp();
    try {
        app.data.saveCustomLocation(home);
        app.data.saveCustomLocation(pharmacy);
        app.data.saveStartingLocation(starting);
        const folder = app.data.createFolder('Errands', null);
        const list = app.data.createList('London', folder, 'plain');
        const homeTask = app.data.createItem(list, 'Collect parcel #home');
        const pharmacyTask = app.data.createItem(list, 'Collect prescription #pharmacy');
        const nearby = app.load('src/lib/nearbyErrands.ts');
        const errands = nearby.collectErrands(app.data.readAllItems(), app.data.readLists(), app.data.readFolders());
        const stops = nearby.nearbyStops(app.data.readCustomLocations(), app.data.readStartingLocation(), 1, errands);
        assert.deepEqual(stops.map(stop => [stop.location.id, stop.errands.map(errand => errand.item.id)]), [
            [home.id, [homeTask]], [pharmacy.id, [pharmacyTask]]
        ]);
        assert.equal(stops[0].distanceKm, 0);
        assert.ok(stops[1].distanceKm > 0 && stops[1].distanceKm < 1);
        assert.deepEqual(app.data.readCustomLocations(), [home, pharmacy]);
        assert.deepEqual(app.data.readStartingLocation(), starting);
    } finally { app.dispose(); }
});

test('selecting a custom origin cancels an outstanding GPS request, returns to errands and is disabled in history', () => {
    const app = createApp();
    try {
        app.data.saveCustomLocation(home);
        let gpsSuccess, gpsError;
        const state = {
            requestVersion: 0, locating: false, locationError: 'Previous GPS error', showLocations: true, showLocationDetails: false,
            commitState: app.store.commitState, readCustomLocations: app.data.readCustomLocations, saveStartingLocation: app.data.saveStartingLocation,
            navigator: { geolocation: { getCurrentPosition: (success, error) => { gpsSuccess = success; gpsError = error; } } }
        };
        const source = componentFunctions('src/lib/components/NearbyErrandsScreen.svelte', ['useGps', 'selectCustomLocation']);
        const handlers = new Function('state', `with(state) { ${transpile(source)}; return { useGps, selectCustomLocation }; }`)(state);
        handlers.useGps();
        assert.equal(state.locating, true);
        handlers.selectCustomLocation(home.id);
        assert.equal(state.locating, false);
        assert.equal(state.showLocations, false);
        assert.equal(state.showLocationDetails, true);
        assert.equal(state.locationError, '');
        const selected = app.data.readStartingLocation();
        assert.equal(selected.customLocationId, home.id);
        assert.equal(selected.source, 'custom');
        gpsSuccess({ coords: { latitude: 0, longitude: 0, accuracy: 5 } });
        gpsError({ code: 1 });
        assert.deepEqual(app.data.readStartingLocation(), selected);
        assert.equal(state.locationError, '');
        app.data.saveCustomLocation(pharmacy);
        state.locationError = '';
        handlers.selectCustomLocation(pharmacy.id);
        assert.match(state.locationError, /no longer available as a starting point/);
        assert.deepEqual(app.data.readStartingLocation(), selected);
        handlers.selectCustomLocation('custom-missing');
        assert.match(state.locationError, /no longer available/);
        assert.deepEqual(app.data.readStartingLocation(), selected);

        app.store.createCommit('Custom origin');
        app.store.viewCommit(app.store.readCommits()[0].id);
        state.locationError = '';
        handlers.selectCustomLocation(pharmacy.id);
        assert.equal(state.locationError, '');
        assert.deepEqual(app.data.readStartingLocation(), selected);
    } finally { app.dispose(); }
});

test('legacy and disabled custom places remain destinations and require opting in before selection', () => {
    const app = createApp();
    try {
        const legacy = { ...home }; delete legacy.startingPoint;
        app.data.saveCustomLocation(legacy);
        const locations = app.load('src/lib/retailLocations.ts');
        assert.deepEqual(locations.matchingLocationTags(['home'], app.data.readCustomLocations()[0]), ['home']);
        assert.throws(() => app.data.saveStartingLocation(starting), /no longer available as a starting point/);
        assert.equal(app.data.readStartingLocation(), null);
        // An old client may have selected an unmarked place. Enabling its pill
        // should not select that stale reference automatically.
        app.doc.getMap('nearby-preferences').set('starting-location', starting);
        assert.equal(app.data.readStartingLocation(), null);
        app.data.saveCustomLocation(home);
        assert.equal(app.data.readStartingLocation(), null);
        app.data.saveStartingLocation(starting);
        assert.deepEqual(app.data.readStartingLocation(), starting);
        app.data.saveCustomLocation({ ...home, startingPoint: false });
        assert.equal(app.data.readStartingLocation(), null);
        assert.deepEqual(locations.matchingLocationTags(['home'], app.data.readCustomLocations()[0]), ['home']);
        assert.throws(() => app.data.saveStartingLocation(starting), /no longer available as a starting point/);
        app.data.saveCustomLocation(home);
        assert.equal(app.data.readStartingLocation(), null);
    } finally { app.dispose(); }
});

test('disabling the selected starting-point toggle syncs and is restored with its selection by one undo', () => {
    const app = createApp(), other = createApp();
    try {
        app.data.saveCustomLocation(home);
        app.data.saveCustomLocation(pharmacy);
        app.data.saveStartingLocation(starting);
        merge(app.doc, other.doc);
        app.store.getUndoManager().clear();
        app.data.saveCustomLocation({ ...home, startingPoint: false });
        assert.equal(app.store.getUndoManager().undoStack.length, 1);
        assert.deepEqual(app.data.readCustomLocations(), [{ ...home, startingPoint: false }, pharmacy]);
        assert.equal(app.data.readStartingLocation(), null);
        merge(app.doc, other.doc);
        assert.equal(other.data.readCustomLocations()[0].startingPoint, false);
        assert.equal(other.data.readStartingLocation(), null);
        app.store.undoLastAction();
        assert.deepEqual(app.data.readStartingLocation(), starting);
        assert.deepEqual(app.data.readCustomLocations(), [home, pharmacy]);
        merge(app.doc, other.doc);
        assert.deepEqual(other.data.readStartingLocation(), starting);
        assert.equal(other.data.readCustomLocations()[0].startingPoint, true);
        // Turning off an unrelated location must preserve the active starting point.
        app.data.saveCustomLocation({ ...pharmacy, startingPoint: false });
        assert.deepEqual(app.data.readStartingLocation(), starting);
    } finally { app.dispose(); other.dispose(); }
});

test('concurrent disabling and selection cannot use a disabled starting point or silently select it on reenabling', () => {
    const a = createApp(), b = createApp();
    try {
        a.data.saveCustomLocation(home);
        merge(a.doc, b.doc);
        a.data.saveStartingLocation(starting);
        b.data.saveCustomLocation({ ...home, startingPoint: false });
        merge(a.doc, b.doc);
        assert.equal(a.data.readStartingLocation(), null);
        assert.equal(b.data.readStartingLocation(), null);
        assert.throws(() => b.data.saveStartingLocation(starting), /no longer available as a starting point/);
        b.data.saveCustomLocation(home);
        merge(a.doc, b.doc);
        assert.equal(a.data.readStartingLocation(), null);
        assert.equal(b.data.readStartingLocation(), null);
    } finally { a.dispose(); b.dispose(); }
});

test('starting-point flags survive backups and history, while invalid flags reject imports before mutation', () => {
    const app = createApp();
    try {
        app.data.saveCustomLocation(home);
        app.data.saveCustomLocation({ ...pharmacy, startingPoint: false });
        app.data.saveStartingLocation(starting);
        const backup = JSON.parse(JSON.stringify(app.data.exportBackup()));
        assert.deepEqual(backup.customLocations.map(location => location.startingPoint), [true, false]);
        app.store.createCommit('Starting-point toggle on');
        app.data.saveCustomLocation({ ...home, startingPoint: false });
        app.store.viewCommit(app.store.readCommits()[0].id);
        assert.equal(app.data.readCustomLocations()[0].startingPoint, true);
        assert.deepEqual(app.data.readStartingLocation(), starting);
        app.store.exitCommitView();
        assert.equal(app.data.readCustomLocations()[0].startingPoint, false);
        assert.equal(app.data.readStartingLocation(), null);
        for (const mode of ['merge', 'replace']) {
            app.data.importBackup(backup, mode);
            assert.deepEqual(app.data.readCustomLocations(), backup.customLocations);
            assert.deepEqual(app.data.readStartingLocation(), starting);
        }
        for (const startingPoint of ['true', 1, null, {}]) {
            assert.throws(() => app.data.saveCustomLocation({ ...home, startingPoint }), /Each location/);
            assert.throws(() => app.data.importBackup({ ...backup, customLocations: [{ ...home, startingPoint }] }, 'replace'), /Each location/);
            assert.deepEqual(app.data.readCustomLocations(), backup.customLocations);
            assert.deepEqual(app.data.readStartingLocation(), starting);
        }
        const legacy = { ...backup, customLocations: backup.customLocations.map(({ startingPoint, ...location }) => location) };
        app.data.importBackup(legacy, 'replace');
        assert.ok(app.data.readCustomLocations().every(location => location.startingPoint === undefined));
        assert.equal(app.data.readStartingLocation(), null);
    } finally { app.dispose(); }
});

test('custom origins persist and converge with concurrent location edits and selections across devices', () => {
    const a = createApp(), b = createApp(), reopened = createApp();
    try {
        a.data.saveCustomLocation(home);
        merge(a.doc, b.doc);
        // Selecting old coordinates on one device while editing the place on another
        // must resolve to the edited place, whichever preference value wins.
        a.data.saveStartingLocation(starting);
        const edited = { ...home, name: 'New home', latitude: 51.52, longitude: -0.14 };
        b.data.saveCustomLocation(edited);
        merge(a.doc, b.doc);
        const expected = { ...starting, label: edited.name, latitude: edited.latitude, longitude: edited.longitude };
        assert.deepEqual(a.data.readStartingLocation(), expected);
        assert.deepEqual(b.data.readStartingLocation(), expected);
        Y.applyUpdate(reopened.doc, Y.encodeStateAsUpdate(a.doc), 'persisted');
        assert.deepEqual(reopened.data.readStartingLocation(), expected);
        // Selection canonicalises stale coordinates against the current saved place.
        b.data.saveStartingLocation({ ...starting, latitude: 0, longitude: 0, label: 'Old label', accuracy: 15 });
        assert.deepEqual(b.data.readStartingLocation(), expected);
        a.data.deleteCustomLocation(home.id);
        merge(a.doc, b.doc);
        assert.equal(a.data.readStartingLocation(), null);
        assert.equal(b.data.readStartingLocation(), null);
    } finally { a.dispose(); b.dispose(); reopened.dispose(); }
});

test('editing and deleting the selected custom place are atomic undo actions and leave other places unchanged', () => {
    const app = createApp();
    try {
        app.data.saveCustomLocation(home);
        app.data.saveCustomLocation(pharmacy);
        app.data.saveStartingLocation(starting);
        app.store.getUndoManager().clear();
        const edited = { ...home, name: 'Updated home', latitude: 51.51, longitude: -0.13 };
        app.data.saveCustomLocation(edited);
        assert.equal(app.store.getUndoManager().undoStack.length, 1);
        assert.equal(app.data.readStartingLocation().label, edited.name);
        assert.equal(app.data.readStartingLocation().latitude, edited.latitude);
        app.store.undoLastAction();
        assert.deepEqual(app.data.readStartingLocation(), starting);
        assert.deepEqual(app.data.readCustomLocations(), [home, pharmacy]);
        app.store.getUndoManager().clear();
        app.data.deleteCustomLocation(home.id);
        assert.equal(app.store.getUndoManager().undoStack.length, 1);
        assert.equal(app.data.readStartingLocation(), null);
        assert.deepEqual(app.data.readCustomLocations(), [pharmacy]);
        app.store.undoLastAction();
        assert.deepEqual(app.data.readStartingLocation(), starting);
        app.data.deleteCustomLocation(pharmacy.id);
        assert.deepEqual(app.data.readStartingLocation(), starting);
    } finally { app.dispose(); }
});

test('custom origins round-trip through backups and history, and invalid references cannot overwrite current data', () => {
    const app = createApp();
    try {
        app.data.saveCustomLocation(home);
        app.data.saveStartingLocation(starting);
        const backup = JSON.parse(JSON.stringify(app.data.exportBackup()));
        assert.deepEqual(backup.startingLocation, starting);
        app.store.createCommit('London home origin');
        app.data.saveCustomLocation({ ...home, name: 'Moved home', latitude: 51.53 });
        app.store.viewCommit(app.store.readCommits()[0].id);
        assert.deepEqual(app.data.readStartingLocation(), starting);
        assert.throws(() => app.data.saveStartingLocation(starting), /read-only/);
        assert.throws(() => app.data.saveCustomLocation(home), /read-only/);
        assert.throws(() => app.data.deleteCustomLocation(home.id), /read-only/);
        app.store.exitCommitView();
        assert.equal(app.data.readStartingLocation().latitude, 51.53);
        for (const mode of ['merge', 'replace']) {
            app.data.importBackup(backup, mode);
            assert.deepEqual(app.data.readStartingLocation(), starting);
        }
        for (const customLocationId of [undefined, '', 'custom-', 'not-custom']) {
            assert.throws(() => app.data.importBackup({ ...backup, startingLocation: { ...starting, customLocationId } }, 'replace'), /Invalid starting location/);
            assert.deepEqual(app.data.readStartingLocation(), starting);
            assert.deepEqual(app.data.readCustomLocations(), [home]);
        }
        assert.throws(() => app.data.saveStartingLocation({ ...starting, customLocationId: 'custom-missing' }), /no longer available/);
        assert.deepEqual(app.data.readStartingLocation(), starting);
        // A stale selection received after a concurrent deletion must not revive the place.
        app.data.deleteCustomLocation(home.id);
        app.doc.getMap('nearby-preferences').set('starting-location', starting);
        assert.equal(app.data.readStartingLocation(), null);
        const legacy = { ...backup }; delete legacy.startingLocation;
        app.data.importBackup(legacy, 'replace');
        assert.equal(app.data.readStartingLocation(), null);
        assert.deepEqual(app.data.readCustomLocations(), [home]);
    } finally { app.dispose(); }
});
