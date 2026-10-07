import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp, merge, componentFunctions, transpile, Y } from './helpers/app.mjs';

const shop = { id: 'custom-shop', name: 'Shop', tags: ['supermarket'], latitude: -37.8, longitude: 145 };

function collect(app, includeCompleted = false) {
    return app.load('src/lib/nearbyErrands.ts').collectErrands(app.data.readAllItems(), app.data.readLists(), app.data.readFolders(), includeCompleted, [shop]);
}

test('nearby previews and stop rows use source-list tree order after top insertion and reordering', () => {
    const app = createApp();
    try {
        const folder = app.data.createFolder('Errands', null);
        const list = app.data.createList('Groceries #supermarket', folder, 'plain');
        const milk = app.data.createItem(list, 'Soy milk x 5');
        const garlic = app.data.createItem(list, 'Minced garlic #urgent');
        const heading = app.data.createItem(list, 'Pantry');
        const headingChild = app.data.createItem(list, 'Check pantry', null, heading, true);
        const bread = app.data.createItem(list, 'Bread');
        const milkChild = app.data.createItem(list, 'Check expiry date', null, milk, true);
        const completed = app.data.createItem(list, 'Completed parent');
        const completedChild = app.data.createItem(list, 'Remaining child', null, completed);
        for (const [id, order] of [[garlic, -1], [heading, 0], [bread, 1], [milk, 2], [completed, 3], [headingChild, 999], [milkChild, -999], [completedChild, -999]]) app.data.updateItem(id, { order });
        app.data.updateItem(heading, { heading: true });
        app.data.updateItem(completed, { checked: true });
        assert.equal(app.data.readAllItems()[0].id, milk, 'storage order differs from displayed order');
        const before = Y.encodeStateAsUpdate(app.doc);
        const errands = collect(app);
        const expected = app.hierarchy.buildItemTreeOrder(app.data.readItems(list)).map(row => row.item).filter(item => !item.heading && !item.checked).map(item => item.id);
        assert.deepEqual(expected, [garlic, headingChild, bread, milk, milkChild, completedChild]);
        assert.deepEqual(errands.map(errand => errand.item.id), expected);
        const stops = app.load('src/lib/nearbyErrands.ts').nearbyStops([shop], null, 5, errands);
        assert.deepEqual(stops[0].errands.map(errand => errand.item.id), expected);
        const pill = app.load('src/lib/nearbyPills.ts').nearbyListPills(stops, errands, 3)[0];
        assert.equal(pill.id, `list:${list}`);
        assert.equal(pill.name, 'Minced garlic · Check pantry · Bread · +3 more');
        assert.deepEqual(pill.errands.map(errand => errand.item.id), expected);
        assert.deepEqual(collect(app, true).map(errand => errand.item.id), [garlic, headingChild, bread, milk, milkChild, completed, completedChild]);
        assert.deepEqual(Y.encodeStateAsUpdate(app.doc), before, 'reading nearby order does not rewrite stored items');
    } finally { app.dispose(); }
});

test('nearby ordering follows synced list reorders without changing storage order', () => {
    const a = createApp(), b = createApp();
    try {
        const folder = a.data.createFolder('Errands', null);
        const list = a.data.createList('Groceries #supermarket', folder, 'plain');
        const milk = a.data.createItem(list, 'Soy milk x 5');
        const garlic = a.data.createItem(list, 'Minced garlic');
        merge(a.doc, b.doc);
        assert.deepEqual(collect(b).map(errand => errand.item.id), [milk, garlic]);
        a.data.updateItem(garlic, { order: -1 });
        merge(a.doc, b.doc);
        assert.deepEqual(collect(b).map(errand => errand.item.id), [garlic, milk]);
        assert.equal(b.data.readAllItems()[0].id, milk);
        const errands = collect(b);
        const stops = b.load('src/lib/nearbyErrands.ts').nearbyStops([shop], shop, 1, errands);
        assert.equal(b.load('src/lib/nearbyPills.ts').nearbyListPills(stops, errands, 3)[0].name, 'Minced garlic · Soy milk x 5');
    } finally { a.dispose(); b.dispose(); }
});

test('inherited pills open the list even for one task, while explicit item pills target their item', () => {
    const app = createApp();
    try {
        const folder = app.data.createFolder('Errands', null);
        const list = app.data.createList('Groceries #supermarket', folder, 'plain');
        app.data.createItem(list, 'Minced garlic #urgent');
        const explicit = app.data.createItem(list, 'Soy milk x 5 #supermarket');
        const errands = collect(app);
        const stops = app.load('src/lib/nearbyErrands.ts').nearbyStops([shop], null, 5, errands);
        const pills = app.load('src/lib/nearbyPills.ts').nearbyListPills(stops, errands, 3);
        const calls = [];
        const state = { onOpenList: id => calls.push(['list', id]), onOpenItem: (listId, itemId) => calls.push(['item', listId, itemId]) };
        const source = componentFunctions('src/lib/components/NearbyErrandsScreen.svelte', ['openPill']);
        const openPill = new Function('state', `with(state) { ${transpile(source)}; return openPill; }`)(state);
        openPill(pills.find(pill => pill.id === `list:${list}`));
        openPill(pills.find(pill => pill.id === `item:${explicit}`));
        assert.deepEqual(calls, [['list', list], ['item', list, explicit]]);
    } finally { app.dispose(); }
});

test('opening a list from nearby clears an old item target and returning clears the whole navigation target', () => {
    const state = { showNearby: true, openListId: null, openItemId: 'old-item', nearbyOpenedTarget: null };
    const source = componentFunctions('src/lib/components/HomeScreen.svelte', ['openFromNearby', 'returnToNearby']);
    const navigation = new Function('state', `with(state) { ${transpile(source)}; return { openFromNearby, returnToNearby }; }`)(state);
    navigation.openFromNearby('groceries');
    assert.deepEqual(state, { showNearby: false, openListId: 'groceries', openItemId: null, nearbyOpenedTarget: { listId: 'groceries', itemId: null } });
    navigation.returnToNearby();
    assert.deepEqual(state, { showNearby: true, openListId: null, openItemId: null, nearbyOpenedTarget: null });
    navigation.openFromNearby('groceries', 'milk');
    assert.deepEqual(state.nearbyOpenedTarget, { listId: 'groceries', itemId: 'milk' });
    assert.equal(state.openItemId, 'milk');
    navigation.returnToNearby();
    assert.equal(state.nearbyOpenedTarget, null);
    assert.equal(state.openItemId, null);
});
