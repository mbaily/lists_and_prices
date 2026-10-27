import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp, merge, componentFunctions, transpile } from './helpers/app.mjs';

function errands(app, locations = []) {
    return app.load('src/lib/nearbyErrands.ts').collectErrands(
        app.data.readAllItems(), app.data.readLists(), app.data.readFolders(), false, locations
    );
}

test('location-free tags default without writes and accept normalized, validated user additions', () => {
    const app = createApp();
    try {
        const stored = app.doc.getMap('location-optional-tags');
        assert.deepEqual(app.data.readLocationOptionalTags(), ['bank', 'errand']);
        assert.equal(stored.size, 0, 'reading defaults must not seed shared state');
        app.data.setLocationOptionalTag('  #SHOPPING  ', true);
        app.data.setLocationOptionalTag('shopping', true);
        app.data.setLocationOptionalTag('#Woolies', true);
        assert.deepEqual(app.data.readLocationOptionalTags(), ['bank', 'errand', 'shopping', 'woolworths']);
        assert.equal(stored.size, 2);
        for (const invalid of ['', '#', '#two tags', 'two-tags', '##shopping', null, 4]) {
            assert.throws(() => app.data.setLocationOptionalTag(invalid, true), /hashtag/);
        }
        assert.throws(() => app.data.setLocationOptionalTag('shopping', 'true'), /Invalid/);
        assert.equal(stored.size, 2, 'invalid input cannot change the saved tags');
    } finally { app.dispose(); }
});

test('adding and removing a tag changes task eligibility, list inheritance and pills without editing tasks', () => {
    const app = createApp();
    try {
        const nearby = app.load('src/lib/nearbyErrands.ts');
        const { nearbyTaskPills, nearbyListPills } = app.load('src/lib/nearbyPills.ts');
        const folder = app.data.createFolder('Tasks', null);
        const plain = app.data.createList('Tasks', folder, 'plain');
        const shopping = app.data.createItem(plain, 'Buy shoes #shopping');
        const tagged = app.data.createList('Weekend #shopping', folder, 'plain');
        const inherited = app.data.createItem(tagged, 'Buy socks #urgent');
        const note = app.data.createItem(tagged, 'Check sizes', null, null, true);
        const groceries = app.data.createList('Groceries #supermarket', folder, 'plain');
        const override = app.data.createItem(groceries, 'Buy bags #shopping');
        const supermarket = { id: 'shop', name: 'Shop', tags: ['supermarket'], latitude: 0, longitude: 0 };
        const collect = () => errands(app, [supermarket]);
        const before = app.data.readAllItems();
        assert.deepEqual(collect().map(row => row.item.id), [override]);
        assert.equal(collect()[0].inheritsListTags, true);
        app.data.setLocationOptionalTag('#shopping', true);
        const rows = collect();
        assert.deepEqual(rows.map(row => row.item.id), [shopping, inherited, note, override]);
        assert.equal(rows.find(row => row.item.id === inherited).inheritsListTags, true);
        assert.equal(rows.find(row => row.item.id === override).inheritsListTags, false);
        assert.ok(rows.every(nearby.isLocationOptionalErrand));
        assert.deepEqual(nearbyTaskPills([], rows).map(pill => pill.tag), ['shopping', 'shopping', 'shopping', 'shopping']);
        assert.equal(nearbyListPills([], rows, 3).length, 3, 'inherited tasks share a pill');
        const locationErrands = rows.filter(row => !nearby.isLocationOptionalErrand(row));
        assert.deepEqual(nearby.suggestStops([], locationErrands).unavailable, []);
        app.data.setLocationOptionalTag('shopping', false);
        assert.deepEqual(collect().map(row => row.item.id), [override]);
        assert.equal(collect()[0].inheritsListTags, true);
        assert.deepEqual(nearbyTaskPills([], collect()), []);
        assert.deepEqual(app.data.readAllItems(), before);
        const custom = { ...supermarket, tags: ['shopping'] };
        const registered = errands(app, [custom]);
        assert.equal(registered.length, 4, 'removing location-free membership retains registered location matches');
        assert.ok(registered.every(row => !nearby.isLocationOptionalErrand(row)));
        assert.equal(nearby.nearbyStops([custom], null, 5, registered)[0].errands.length, 4);
    } finally { app.dispose(); }
});

test('default removals and independent additions converge across devices without reintroducing defaults', () => {
    const a = createApp(), b = createApp(), fresh = createApp();
    try {
        a.data.readLocationOptionalTags(); b.data.readLocationOptionalTags();
        merge(a.doc, b.doc);
        a.data.setLocationOptionalTag('bank', false);
        a.data.setLocationOptionalTag('shopping', true);
        b.data.setLocationOptionalTag('errand', false);
        b.data.setLocationOptionalTag('tools', true);
        merge(a.doc, b.doc);
        assert.deepEqual(a.data.readLocationOptionalTags(), ['shopping', 'tools']);
        assert.deepEqual(b.data.readLocationOptionalTags(), ['shopping', 'tools']);
        fresh.data.readLocationOptionalTags();
        merge(a.doc, fresh.doc);
        assert.deepEqual(fresh.data.readLocationOptionalTags(), ['shopping', 'tools']);
        fresh.data.setLocationOptionalTag('shopping', false);
        merge(a.doc, fresh.doc);
        assert.deepEqual(a.data.readLocationOptionalTags(), ['tools']);
    } finally { a.dispose(); b.dispose(); fresh.dispose(); }
});

test('backups retain the exact tag list including empty lists, merge additions and restore legacy defaults', () => {
    const a = createApp(), b = createApp();
    try {
        a.data.setLocationOptionalTag('bank', false);
        a.data.setLocationOptionalTag('errand', false);
        a.data.setLocationOptionalTag('shopping', true);
        const backup = JSON.parse(JSON.stringify(a.data.exportBackup()));
        assert.deepEqual(backup.locationOptionalTags, ['shopping']);
        b.data.importBackup(backup, 'replace');
        assert.deepEqual(b.data.readLocationOptionalTags(), ['shopping']);
        b.data.setLocationOptionalTag('tools', true);
        b.data.importBackup(backup, 'merge');
        assert.deepEqual(b.data.readLocationOptionalTags(), ['shopping', 'tools']);
        b.data.importBackup({ ...backup, locationOptionalTags: [] }, 'replace');
        assert.deepEqual(b.data.readLocationOptionalTags(), []);
        assert.deepEqual(b.data.exportBackup().locationOptionalTags, []);
        b.data.importBackup({ ...backup, locationOptionalTags: ['#SHOPPING', 'shopping'] }, 'replace');
        assert.deepEqual(b.data.readLocationOptionalTags(), ['shopping']);
        const legacy = { ...backup }; delete legacy.locationOptionalTags;
        b.data.importBackup(legacy, 'merge');
        assert.deepEqual(b.data.readLocationOptionalTags(), ['shopping']);
        b.data.importBackup(legacy, 'replace');
        assert.deepEqual(b.data.readLocationOptionalTags(), ['bank', 'errand']);
        const folder = b.data.createFolder('Keep', null);
        for (const invalid of [null, 'shopping', [null], ['#'], ['two tags'], ['two-tags']]) {
            assert.throws(() => b.data.importBackup({ ...backup, locationOptionalTags: invalid }, 'replace'), /Invalid location-free/);
            assert.ok(b.data.readFolders().some(row => row.id === folder));
            assert.deepEqual(b.data.readLocationOptionalTags(), ['bank', 'errand']);
        }
    } finally { a.dispose(); b.dispose(); }
});

test('tag changes and backup replacement participate in undo and historical views', () => {
    const app = createApp();
    try {
        app.store.getUndoManager().clear();
        app.data.setLocationOptionalTag('bank', false);
        app.store.undoLastAction();
        assert.deepEqual(app.data.readLocationOptionalTags(), ['bank', 'errand']);
        app.data.setLocationOptionalTag('shopping', true);
        app.store.createCommit('Shopping enabled');
        app.data.setLocationOptionalTag('shopping', false);
        app.store.viewCommit(app.store.readCommits()[0].id);
        assert.deepEqual(app.data.readLocationOptionalTags(), ['bank', 'errand', 'shopping']);
        assert.throws(() => app.data.setLocationOptionalTag('tools', true), /read-only/);
        app.store.exitCommitView();
        assert.deepEqual(app.data.readLocationOptionalTags(), ['bank', 'errand']);
        const backup = app.data.exportBackup();
        app.store.getUndoManager().clear();
        app.data.importBackup({ ...backup, locationOptionalTags: [] }, 'replace');
        assert.deepEqual(app.data.readLocationOptionalTags(), []);
        app.store.undoLastAction();
        assert.deepEqual(app.data.readLocationOptionalTags(), ['bank', 'errand']);
    } finally { app.dispose(); }
});

test('the web form adds and removes tags, reports invalid input and blocks changes in history', () => {
    const app = createApp();
    try {
        const source = transpile(componentFunctions('src/lib/components/NearbyErrandsScreen.svelte', ['addOptionalTag', 'removeOptionalTag']));
        const form = new Function('setLocationOptionalTag', 'commitState', source + `
            let newOptionalTag = '', optionalTagError = '';
            return { add(tag) { newOptionalTag = tag; addOptionalTag(); return { value: newOptionalTag, error: optionalTagError }; }, remove: removeOptionalTag };
        `)(app.data.setLocationOptionalTag, app.store.commitState);
        assert.deepEqual(form.add('#shopping'), { value: '', error: '' });
        assert.ok(app.data.readLocationOptionalTags().includes('shopping'));
        assert.match(form.add('two tags').error, /one hashtag/);
        form.remove('bank');
        assert.deepEqual(app.data.readLocationOptionalTags(), ['errand', 'shopping']);
        app.store.createCommit('Tags');
        app.store.viewCommit(app.store.readCommits()[0].id);
        form.add('tools'); form.remove('shopping');
        app.store.exitCommitView();
        assert.deepEqual(app.data.readLocationOptionalTags(), ['errand', 'shopping']);
    } finally { app.dispose(); }
});
