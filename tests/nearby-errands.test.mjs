import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { createApp, merge, root, componentFunctions, transpile, Y } from './helpers/app.mjs';

const supermarket = { id: 'coles-test', name: 'Coles Test', tags: ['coles', 'supermarket'], latitude: -37.8136, longitude: 144.9631 };
const custom = { id: 'custom-test', name: 'Pharmacy', tags: ['pharmacy'], latitude: -37.81, longitude: 144.96 };

test('list hashtags apply to untagged todos and notes while item tags take precedence', () => {
    const app = createApp();
    try {
        const nearby = app.load('src/lib/nearbyErrands.ts');
        const folder = app.data.createFolder('Errands #kmart', null);
        const list = app.data.createList('Shopping #supermarket', folder, 'plain');
        const milk = app.data.createItem(list, 'Milk');
        const note = app.data.createItem(list, 'Check opening hours', null, null, true);
        const bread = app.data.createItem(list, 'Bread #coles');
        const socks = app.data.createItem(list, 'Socks #kmart');
        const completed = app.data.createItem(list, 'Already bought');
        app.data.updateItem(completed, { checked: true });
        const collect = () => nearby.collectErrands(app.data.readAllItems(), app.data.readLists(), app.data.readFolders());
        const tags = new Map(collect().map(errand => [errand.item.id, errand.tags]));
        assert.deepEqual(tags.get(milk), ['supermarket']);
        assert.deepEqual(tags.get(note), ['supermarket']);
        assert.deepEqual(tags.get(bread), ['coles']);
        assert.deepEqual(tags.get(socks), ['kmart']);
        assert.equal(tags.has(completed), false);
        const woolworths = { ...supermarket, id: 'woolworths', tags: ['woolworths'] };
        const stops = nearby.nearbyStops([supermarket, woolworths], supermarket, 5, collect());
        assert.deepEqual(stops.find(stop => stop.location.id === supermarket.id).errands.map(errand => errand.item.id), [milk, note, bread]);
        assert.deepEqual(stops.find(stop => stop.location.id === woolworths.id).errands.map(errand => errand.item.id), [milk, note]);
        app.data.updateList(list, { name: 'Shopping' });
        assert.deepEqual(collect().map(errand => errand.item.id), [bread, socks]);
    } finally { app.dispose(); }
});

test('available hashtags mirror matching locations, normalize aliases and follow custom location changes', () => {
    const app = createApp();
    try {
        const { availableLocationTags, matchingLocationTags } = app.load('src/lib/retailLocations.ts');
        const woolworths = { ...supermarket, id: 'woolworths-test', tags: ['#WOOLIES', 'woolworths'] };
        const locations = [supermarket, woolworths, { ...custom, tags: ['PHARMACY', '#pharmacy'] }];
        assert.deepEqual(availableLocationTags(locations), [
            { tag: 'coles', count: 1 }, { tag: 'pharmacy', count: 1 },
            { tag: 'supermarket', count: 2 }, { tag: 'woolworths', count: 1 }
        ]);
        for (const entry of availableLocationTags(locations)) {
            assert.equal(entry.count, locations.filter(location => matchingLocationTags([entry.tag], location).length > 0).length);
        }
        const readTags = () => availableLocationTags([supermarket, ...app.data.readCustomLocations()]);
        assert.ok(!readTags().some(entry => entry.tag === 'pharmacy'));
        app.data.saveCustomLocation(custom);
        assert.ok(readTags().some(entry => entry.tag === 'pharmacy' && entry.count === 1));
        app.data.saveCustomLocation({ ...custom, tags: ['postoffice'] });
        assert.ok(!readTags().some(entry => entry.tag === 'pharmacy'));
        assert.ok(readTags().some(entry => entry.tag === 'postoffice'));
        app.data.deleteCustomLocation(custom.id);
        assert.ok(!readTags().some(entry => entry.tag === 'postoffice'));
    } finally { app.dispose(); }
});

test('retailer tags, supermarket compatibility and Woolworths spelling aliases', () => {
    const app = createApp();
    try {
        const match = app.load('src/lib/retailLocations.ts').matchingLocationTags;
        assert.deepEqual(match(['supermarket'], supermarket), ['supermarket']);
        assert.deepEqual(match(['coles'], supermarket), ['coles']);
        assert.deepEqual(match(['woolworths', 'kmart'], supermarket), []);
        assert.deepEqual(match(['SUPERmarket'], { ...supermarket, tags: ['coles'] }), ['supermarket']);
        assert.deepEqual(match(['wooloworths', 'woolies'], { ...supermarket, tags: ['woolworths'] }), ['woolworths']);
        assert.deepEqual(match(['constructor'], custom), []);
    } finally { app.dispose(); }
});

test('nearby stops use distance, radius and multiple compatible stores', () => {
    const app = createApp();
    try {
        const retail = app.load('src/lib/retailLocations.ts');
        const nearby = app.load('src/lib/nearbyErrands.ts');
        const folder = app.data.createFolder('Errands', null);
        const list = app.data.createList('Shopping', folder, 'plain');
        app.data.createItem(list, 'Milk #supermarket');
        app.data.createItem(list, 'Socks #kmart');
        const errands = nearby.collectErrands(app.data.readAllItems(), app.data.readLists(), app.data.readFolders());
        const woolworths = { ...supermarket, id: 'woolworths-test', tags: ['woolworths'], latitude: -37.8236 };
        const far = { ...supermarket, id: 'far', latitude: -38.3 };
        const stops = nearby.nearbyStops([far, woolworths, supermarket], supermarket, 5, errands);
        assert.deepEqual(stops.map(stop => stop.location.id), ['coles-test', 'woolworths-test']);
        assert.equal(stops[0].errands.length, 1);
        assert.equal(stops[0].distanceKm, 0);
        assert.ok(Math.abs(retail.distanceKm(supermarket, woolworths) - 1.112) < .01);
        assert.deepEqual(nearby.nearbyStops([supermarket], { latitude: NaN, longitude: 0 }, 5, errands), []);
        assert.deepEqual(nearby.nearbyStops([supermarket], supermarket, -1, errands), []);
    } finally { app.dispose(); }
});

test('suggested stops cover specialist errands alongside milk and hide repeated branches', () => {
    const app = createApp();
    try {
        const nearby = app.load('src/lib/nearbyErrands.ts');
        const folder = app.data.createFolder('Errands', null);
        const list = app.data.createList('Shopping', folder, 'plain');
        const milk = app.data.createItem(list, 'Milk #supermarket');
        const paper = app.data.createItem(list, 'Paper #officeworks');
        const screws = app.data.createItem(list, 'Screws #bunnings');
        const distant = app.data.createItem(list, 'Distant shop #far');
        const unknown = app.data.createItem(list, 'Unknown #notindatabase');
        const errands = nearby.collectErrands(app.data.readAllItems(), app.data.readLists(), app.data.readFolders());
        const branches = Array.from({ length: 30 }, (_, i) => ({ ...supermarket, id: `supermarket-${i}`, latitude: supermarket.latitude + i * .0001 }));
        const officeworks = { ...supermarket, id: 'officeworks', tags: ['officeworks'], latitude: supermarket.latitude + .01 };
        const bunnings = { ...supermarket, id: 'bunnings', tags: ['bunnings'], latitude: supermarket.latitude + .02 };
        const far = { ...supermarket, id: 'far', tags: ['far'], latitude: -38.1 };
        const stops = nearby.nearbyStops([...branches, officeworks, bunnings, far], supermarket, 5, errands);
        const plan = nearby.suggestStops(stops, errands);
        assert.deepEqual(plan.suggested.map(stop => stop.location.id), ['supermarket-0', 'officeworks', 'bunnings']);
        assert.deepEqual(plan.suggested.flatMap(stop => stop.errands.map(errand => errand.item.id)), [milk, paper, screws]);
        assert.equal(plan.alternatives.length, 29);
        assert.deepEqual(plan.unavailable.map(errand => errand.item.id), [distant, unknown]);
        assert.equal(stops.length, 32, 'planning does not mutate nearby alternatives');
        assert.equal(nearby.suggestStops(nearby.nearbyStops([...branches, officeworks, bunnings, far], supermarket, 1, errands), errands).suggested.length, 1);
        const restored = nearby.suggestStops(nearby.nearbyStops([...branches, officeworks, bunnings, far], supermarket, 50, errands), errands);
        assert.ok(restored.suggested.some(stop => stop.location.id === 'far'));
        assert.deepEqual(restored.unavailable.map(errand => errand.item.id), [unknown]);
    } finally { app.dispose(); }
});

test('suggestions prefer coverage, remove redundant stops and assign overlapping items once', () => {
    const app = createApp();
    try {
        const { suggestStops } = app.load('src/lib/nearbyErrands.ts');
        const errands = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => ({ item: { id }, list: { id: 'list' }, tags: [id] }));
        const stop = (id, distanceKm, items) => ({ location: { ...custom, id }, distanceKm, errands: items.map(i => errands[i]) });
        const stops = [stop('nearest-single', .1, [0]), stop('initial-four', .2, [0, 1, 2, 3]), stop('left', .3, [0, 1, 4]), stop('right', .4, [2, 3, 5])];
        const plan = suggestStops(stops, errands);
        assert.deepEqual(plan.suggested.map(stop => stop.location.id), ['left', 'right']);
        assert.equal(new Set(plan.suggested.flatMap(stop => stop.errands.map(errand => errand.item.id))).size, 6);
        assert.equal(plan.unavailable.length, 0);
        const overlap = suggestStops([stop('first', 1, [0, 1]), stop('second', 2, [1, 2])], errands.slice(0, 3));
        assert.deepEqual(overlap.suggested.map(stop => stop.errands.map(errand => errand.item.id)), [['a', 'b'], ['c']]);
        const tie = suggestStops([stop('z', 1, [0]), stop('a', 1, [0])], errands.slice(0, 1));
        assert.equal(tie.suggested[0].location.id, 'a');
        assert.deepEqual(suggestStops([], errands).unavailable, errands);
        assert.deepEqual(suggestStops([], []).suggested, []);
    } finally { app.dispose(); }
});

test('include tagged notes but exclude completed todos, headings, archived ancestors and completed lists', () => {
    const app = createApp();
    try {
        const nearby = app.load('src/lib/nearbyErrands.ts');
        const parent = app.data.createFolder('Parent', null);
        const folder = app.data.createFolder('Shopping', parent);
        const list = app.data.createList('Shopping', folder, 'plain');
        const kept = app.data.createItem(list, 'Milk #coles');
        const completed = app.data.createItem(list, 'Completed #coles'); app.data.updateItem(completed, { checked: true });
        const note = app.data.createItem(list, 'Note #coles', null, null, true);
        const heading = app.data.createItem(list, 'Heading #coles'); app.data.updateItem(heading, { heading: true });
        const plain = app.data.createItem(list, 'No tags');
        const collect = () => nearby.collectErrands(app.data.readAllItems(), app.data.readLists(), app.data.readFolders());
        assert.deepEqual(collect().map(errand => errand.item.id), [kept, note]);
        app.data.updateFolder(parent, { archived: true }); assert.deepEqual(collect(), []);
        app.data.updateFolder(parent, { archived: false });
        app.data.updateList(list, { done: true }); assert.deepEqual(collect(), []);
        app.data.updateList(list, { done: false });
        const checkbox = app.data.addFolderCheckbox(folder, 'Bought');
        app.data.setItemCheckboxState(kept, checkbox, true);
        // Legacy checked=true is ignored when named checkboxes determine completion.
        assert.deepEqual(collect().map(errand => errand.item.id), [completed, note]);
        assert.equal(collect().some(errand => errand.item.id === plain), false);
    } finally { app.dispose(); }
});

test('custom locations sync, undo, backup, restore and history remain consistent', () => {
    const a = createApp(), b = createApp();
    try {
        a.data.saveCustomLocation(custom);
        b.data.saveCustomLocation({ ...custom, id: 'custom-other', name: 'Other shop' });
        merge(a.doc, b.doc);
        assert.equal(a.data.readCustomLocations().length, 2);
        a.data.deleteCustomLocation(custom.id); a.store.undoLastAction();
        assert.equal(a.data.readCustomLocations().length, 2);
        const backup = JSON.parse(JSON.stringify(a.data.exportBackup()));
        a.data.deleteCustomLocation(custom.id);
        a.data.importBackup(backup, 'replace');
        assert.equal(a.data.readCustomLocations().length, 2);
        a.store.createCommit('With locations');
        a.data.deleteCustomLocation(custom.id);
        a.store.viewCommit(a.store.readCommits()[0].id);
        assert.equal(a.data.readCustomLocations().length, 2);
        assert.throws(() => a.data.saveCustomLocation(custom), /read-only/);
        assert.throws(() => a.data.deleteCustomLocation(custom.id), /read-only/);
        a.store.exitCommitView();
        assert.equal(a.data.readCustomLocations().length, 1);
        const oldBackup = a.data.exportBackup(); delete oldBackup.customLocations;
        a.data.importBackup(oldBackup, 'merge'); assert.equal(a.data.readCustomLocations().length, 1);
        a.data.importBackup(oldBackup, 'replace'); assert.equal(a.data.readCustomLocations().length, 0);
        a.store.undoLastAction(); assert.equal(a.data.readCustomLocations().length, 1);
    } finally { a.dispose(); b.dispose(); }
});

test('invalid location backup is rejected before destructive replace', () => {
    const app = createApp();
    try {
        app.data.saveCustomLocation(custom);
        const backup = app.data.exportBackup();
        backup.customLocations = [{ ...custom, latitude: 100 }];
        assert.throws(() => app.data.importBackup(backup, 'replace'), /valid latitude/);
        assert.deepEqual(app.data.readCustomLocations(), [custom]);
        assert.throws(() => app.data.saveCustomLocation({ ...custom, id: 'coles-test' }), /custom-/);
        assert.throws(() => app.data.saveCustomLocation({ ...custom, tags: ['bad tag'] }), /tags/);
    } finally { app.dispose(); }
});

test('Melbourne catalogue has valid unique locations, retailer sources and coordinate accuracy metadata', () => {
    const catalogue = JSON.parse(readFileSync(path.join(root, 'src/lib/locations/melbourne.json'), 'utf8'));
    const app = createApp();
    try {
        app.load('src/lib/retailLocations.ts').validateLocations(catalogue.locations);
        assert.ok(catalogue.locations.length > 300);
        for (const location of catalogue.locations) {
            assert.match(location.source, /^https?:\/\//);
            assert.ok(location.latitude < -37 && location.longitude > 144);
            assert.ok(location.tags.every(tag => /^[a-z0-9_]+$/.test(tag)));
            if (location.collection === 'retail-expansion') assert.ok(['store', 'shopping-centre'].includes(location.coordinateAccuracy));
        }
        assert.match(catalogue.license, /CC0 1.0/);
    } finally { app.dispose(); }
});

test('expanded catalogue supports both centre directories, hardware chains and avoids duplicate supermarket branches', () => {
    const catalogue = JSON.parse(readFileSync(path.join(root, 'src/lib/locations/melbourne.json'), 'utf8'));
    const app = createApp();
    try {
        const { matchingLocationTags, availableLocationTags } = app.load('src/lib/retailLocations.ts');
        const tags = new Map(availableLocationTags(catalogue.locations).map(entry => [entry.tag, entry.count]));
        assert.ok(tags.get('northland') > 150);
        assert.ok(tags.get('emporium') > 100);
        assert.ok(tags.get('bunnings') >= 40);
        assert.ok(tags.get('mitre10') >= 20);
        assert.equal(tags.get('hardware'), tags.get('bunnings') + tags.get('mitre10'));
        assert.ok(tags.get('coles') >= 170);
        assert.ok(tags.get('woolworths') >= 190);
        assert.ok(tags.get('kmart') >= 40);
        for (const tag of ['jbhifi', 'uniqlo', 'muji', 'chemistwarehouse', 'hardware', 'northland', 'emporium']) {
            assert.ok(catalogue.locations.some(location => matchingLocationTags([tag], location).length > 0), tag);
        }
        for (const location of catalogue.locations.filter(location => location.coordinateAccuracy === 'shopping-centre')) {
            assert.ok(location.centre);
            assert.ok(location.source.includes('/stores/') || location.source === 'https://muji.com.au/pages/store-locator');
            assert.ok(!/centre management/i.test(location.name));
            if (location.centre === 'Northland') assert.deepEqual([location.latitude, location.longitude], [-37.738332, 145.030056]);
            if (location.centre === 'Emporium Melbourne') assert.deepEqual([location.latitude, location.longitude], [-37.812242, 144.963604]);
        }
        assert.deepEqual(matchingLocationTags(['hardware'], { ...custom, tags: ['bunnings'] }), ['hardware']);
    } finally { app.dispose(); }
});

test('chain inventory has a coverage row for every original brand and preserves old hashtag aliases', () => {
    const manifest = JSON.parse(readFileSync(path.join(root, 'scripts/retail-chain-sources.json'), 'utf8'));
    const report = JSON.parse(readFileSync(path.join(root, 'docs/retail-chain-coverage.json'), 'utf8'));
    const catalogue = JSON.parse(readFileSync(path.join(root, 'src/lib/locations/melbourne.json'), 'utf8'));
    assert.equal(report.locations, catalogue.locations.length);
    assert.deepEqual(report.brands.map(row => row.tag), manifest.brands.map(row => row.tag));
    const app = createApp();
    try {
        const { matchingLocationTags } = app.load('src/lib/retailLocations.ts');
        for (const [alias, canonical] of [['rebelsport', 'rebel'], ['qbdthebookshop', 'qbdbooks'], ['t2', 't2tea'], ['seed', 'seedheritage']]) {
            assert.deepEqual(matchingLocationTags([alias], { ...custom, tags: [canonical] }), [canonical]);
        }
        assert.deepEqual(matchingLocationTags(['supermarket'], { ...custom, tags: ['aldi'] }), ['supermarket']);
    } finally { app.dispose(); }
});

test('Officeworks locator branches are available by hashtag and exclude regional stores', () => {
    const catalogue = JSON.parse(readFileSync(path.join(root, 'src/lib/locations/melbourne.json'), 'utf8'));
    const report = JSON.parse(readFileSync(path.join(root, 'docs/retail-chain-coverage.json'), 'utf8'));
    const stores = catalogue.locations.filter(location => location.tags.includes('officeworks'));
    assert.equal(stores.length, report.sources['officeworks-official'].acceptedMetro);
    assert.ok(stores.length >= 40);
    assert.ok(stores.some(store => store.name === 'Preston Officeworks'));
    assert.ok(stores.some(store => store.name === 'Mornington Officeworks'));
    assert.ok(stores.every(store => store.coordinateAccuracy === 'store' && store.address && store.source.startsWith('https://www.officeworks.com.au/shop/officeworks/storepage/')));
    assert.ok(!stores.some(store => /Geelong|Bendigo|Ballarat/i.test(store.name)));
    const app = createApp();
    try {
        const { matchingLocationTags } = app.load('src/lib/retailLocations.ts');
        assert.deepEqual(matchingLocationTags(['#officeworks'], stores[0]), ['officeworks']);
    } finally { app.dispose(); }
});

test('stale GPS callbacks cannot replace a manually selected starting location', () => {
    const callbacks = [];
    const state = { requestVersion: 0, locating: false, locationError: '', origin: null, originLabel: '', accuracy: null, suburbQuery: '', navigator: { geolocation: { getCurrentPosition: (success, error) => callbacks.push({ success, error }) } } };
    state.commitState = { isHistorical: false };
    state.saveStartingLocation = location => { state.origin = { latitude: location.latitude, longitude: location.longitude }; };
    const source = componentFunctions('src/lib/components/NearbyErrandsScreen.svelte', ['useGps', 'selectSuburb']);
    const handlers = new Function('state', `with(state) { ${transpile(source)}; return { useGps, selectSuburb }; }`)(state);
    handlers.useGps(); assert.equal(state.locating, true);
    handlers.selectSuburb({ id: 'melbourne', name: 'Melbourne', latitude: supermarket.latitude, longitude: supermarket.longitude });
    callbacks[0].success({ coords: { latitude: 0, longitude: 0, accuracy: 5 } });
    assert.deepEqual(state.origin, { latitude: supermarket.latitude, longitude: supermarket.longitude });
    assert.equal(state.locating, false);
});

test('GPS permission denial and timeout preserve an existing starting point', () => {
    let reject;
    const state = { requestVersion: 0, locating: false, locationError: '', origin: { latitude: 1, longitude: 2 }, originLabel: 'Selected store', accuracy: null, anchorId: '', navigator: { geolocation: { getCurrentPosition: (_success, error) => { reject = error; } } } };
    state.commitState = { isHistorical: false };
    const source = componentFunctions('src/lib/components/NearbyErrandsScreen.svelte', ['useGps']);
    const useGps = new Function('state', `with(state) { ${transpile(source)}; return useGps; }`)(state);
    useGps(); reject({ code: 1 });
    assert.match(state.locationError, /permission was denied/);
    assert.equal(state.locating, false);
    assert.deepEqual(state.origin, { latitude: 1, longitude: 2 });
    useGps(); reject({ code: 3 });
    assert.match(state.locationError, /Try again/);
    assert.equal(state.locating, false);
});

test('GPS callback after unmount is ignored', () => {
    let resolve;
    const state = { requestVersion: 0, locating: false, locationError: '', origin: null, originLabel: '', accuracy: null, anchorId: '', navigator: { geolocation: { getCurrentPosition: (success) => { resolve = success; } } } };
    state.commitState = { isHistorical: false };
    const source = componentFunctions('src/lib/components/NearbyErrandsScreen.svelte', ['useGps']);
    const useGps = new Function('state', `with(state) { ${transpile(source)}; return useGps; }`)(state);
    useGps();
    // Mirrors the onDestroy cancellation token, without a DOM fixture.
    state.requestVersion++;
    resolve({ coords: { latitude: 1, longitude: 2, accuracy: 5 } });
    assert.equal(state.origin, null);
});

test('starting location restores from Yjs persistence and follows updates from another device', () => {
    const a = createApp(), b = createApp(), reopened = createApp();
    try {
        const suburb = { latitude: -37.82, longitude: 145, source: 'suburb', label: 'Richmond', accuracy: null, updatedAt: '2026-09-30T06:00:00.000Z' };
        const gps = { latitude: -37.9, longitude: 145.1, source: 'gps', label: 'Last GPS location', accuracy: 12, updatedAt: '2026-10-01T06:00:00.000Z' };
        assert.equal(a.data.readStartingLocation(), null);
        a.data.saveStartingLocation(suburb);
        merge(a.doc, b.doc);
        assert.deepEqual(b.data.readStartingLocation(), suburb);
        Y.applyUpdate(reopened.doc, Y.encodeStateAsUpdate(a.doc), 'persisted');
        assert.deepEqual(reopened.data.readStartingLocation(), suburb);
        b.data.saveStartingLocation(gps);
        merge(a.doc, b.doc);
        assert.deepEqual(a.data.readStartingLocation(), gps);
        assert.deepEqual(b.data.readStartingLocation(), gps);
        // Concurrent changes must converge to one complete point, not mixed coordinates.
        a.data.saveStartingLocation(suburb);
        b.data.saveStartingLocation({ ...gps, latitude: -38, longitude: 144.8 });
        merge(a.doc, b.doc);
        assert.deepEqual(a.data.readStartingLocation(), b.data.readStartingLocation());
        assert.ok([JSON.stringify(suburb), JSON.stringify({ ...gps, latitude: -38, longitude: 144.8 })].includes(JSON.stringify(a.data.readStartingLocation())));
        a.data.clearStartingLocation();
        merge(a.doc, b.doc);
        assert.equal(a.data.readStartingLocation(), null);
        assert.equal(b.data.readStartingLocation(), null);
    } finally { a.dispose(); b.dispose(); reopened.dispose(); }
});

test('starting location participates in backups, history and undo with validated imports', () => {
    const app = createApp();
    try {
        const suburb = { latitude: -37.82, longitude: 145, source: 'suburb', label: 'Richmond', accuracy: null, updatedAt: '2026-09-30T06:00:00.000Z' };
        const gps = { ...suburb, source: 'gps', label: 'Last GPS location', accuracy: 8 };
        app.data.saveStartingLocation(suburb);
        const backup = JSON.parse(JSON.stringify(app.data.exportBackup()));
        assert.deepEqual(backup.startingLocation, suburb);
        app.store.createCommit('Starting in Richmond');
        app.data.saveStartingLocation(gps);
        app.store.viewCommit(app.store.readCommits()[0].id);
        assert.deepEqual(app.data.readStartingLocation(), suburb);
        assert.throws(() => app.data.saveStartingLocation(gps), /read-only/);
        app.store.exitCommitView();
        assert.deepEqual(app.data.readStartingLocation(), gps);
        app.store.undoLastAction();
        assert.deepEqual(app.data.readStartingLocation(), suburb);
        app.data.saveStartingLocation(gps);
        assert.throws(() => app.data.importBackup({ ...backup, startingLocation: { ...suburb, latitude: NaN } }, 'replace'), /Invalid starting location/);
        assert.deepEqual(app.data.readStartingLocation(), gps);
        app.data.importBackup(backup, 'replace');
        assert.deepEqual(app.data.readStartingLocation(), suburb);
        const legacy = { ...backup }; delete legacy.startingLocation;
        app.data.importBackup(legacy, 'merge');
        assert.deepEqual(app.data.readStartingLocation(), suburb);
        app.data.importBackup(legacy, 'replace');
        assert.equal(app.data.readStartingLocation(), null);
    } finally { app.dispose(); }
});

test('GPS success persists the chosen point and accuracy while history blocks updates', () => {
    const app = createApp();
    try {
        let resolve;
        const state = { requestVersion: 0, locating: false, locationError: '', commitState: app.store.commitState,
            saveStartingLocation: app.data.saveStartingLocation,
            navigator: { geolocation: { getCurrentPosition: success => { resolve = success; } } } };
        const source = componentFunctions('src/lib/components/NearbyErrandsScreen.svelte', ['useGps']);
        const useGps = new Function('state', `with(state) { ${transpile(source)}; return useGps; }`)(state);
        useGps(); resolve({ coords: { latitude: -37.8, longitude: 145, accuracy: 20 } });
        assert.equal(app.data.readStartingLocation().accuracy, 20);
        assert.equal(app.data.readStartingLocation().source, 'gps');
        assert.equal(state.locating, false);
        state.commitState.isHistorical = true;
        resolve = null; useGps();
        assert.equal(resolve, null);
    } finally { app.dispose(); }
});

test('PC parts category matches all four specialist chains, including custom locations', () => {
    const catalogue = JSON.parse(readFileSync(path.join(root, 'src/lib/locations/melbourne.json'), 'utf8'));
    const app = createApp();
    try {
        const { matchingLocationTags, availableLocationTags } = app.load('src/lib/retailLocations.ts');
        for (const [tag, count] of [['scorptec', 4], ['centrecom', 6], ['cpl', 3], ['msy', 3]]) {
            const stores = catalogue.locations.filter(location => location.tags.includes(tag));
            assert.equal(stores.length, count, tag);
            for (const store of stores) assert.deepEqual(matchingLocationTags(['#pcparts'], store), ['pcparts']);
            assert.deepEqual(matchingLocationTags(['pcparts'], { ...custom, tags: [tag] }), ['pcparts']);
        }
        assert.equal(availableLocationTags(catalogue.locations).find(entry => entry.tag === 'pcparts').count, 16);
        assert.deepEqual(matchingLocationTags(['pcparts'], { ...custom, tags: ['officeworks'] }), []);
        assert.ok(!catalogue.locations.some(location => location.tags.includes('msy') && /dandenong/i.test(location.name)));
    } finally { app.dispose(); }
});

test('MUJI covers four Melbourne branches and DAISO covers all eight current Victoria branches', () => {
    const locations = JSON.parse(readFileSync(path.join(root, 'src/lib/locations/melbourne.json'), 'utf8')).locations;
    const muji = locations.filter(location => location.tags.includes('muji'));
    assert.equal(muji.length, 4);
    for (const branch of ['Chadstone', 'Emporium', 'Highpoint', 'Knox']) assert.equal(muji.filter(location => location.name.includes(branch)).length, 1, branch);
    const daiso = locations.filter(location => location.tags.includes('daiso'));
    assert.equal(daiso.length, 8);
    for (const branch of ['Chadstone', 'QV', 'Midtown Plaza', 'Highpoint', 'Box Hill', 'Eastland', 'Glen Waverley', 'Knox']) {
        const store = daiso.find(location => location.name.includes(branch));
        assert.ok(store, branch);
        assert.equal(store.coordinateAccuracy, 'store');
        assert.match(store.source, /^https:\/\/mydaiso.com.au\//);
    }
});
