import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp, merge } from './helpers/app.mjs';

test('hot suburbs default without writes, sync in saved order and allow an empty list', () => {
    const a = createApp(), b = createApp();
    try {
        const { defaultHotSuburbIds, suburbById } = a.load('src/lib/hotSuburbs.ts');
        const before = a.doc.getMap('nearby-preferences').size;
        assert.deepEqual(a.data.readHotSuburbIds().map(id => suburbById.get(id).name), ['Melbourne', 'Brunswick', 'Richmond']);
        assert.equal(a.doc.getMap('nearby-preferences').size, before);
        const ordered = [...defaultHotSuburbIds].reverse();
        a.data.saveHotSuburbIds(ordered);
        merge(a.doc, b.doc);
        assert.deepEqual(b.data.readHotSuburbIds(), ordered);
        ordered.reverse();
        assert.notDeepEqual(a.data.readHotSuburbIds(), ordered, 'saved data does not share the caller array');
        b.data.saveHotSuburbIds([]);
        merge(a.doc, b.doc);
        assert.deepEqual(a.data.readHotSuburbIds(), []);
    } finally { a.dispose(); b.dispose(); }
});

test('hot suburbs support undo, backups and historical views and reject invalid lists before replacement', () => {
    const app = createApp();
    try {
        const defaults = app.data.readHotSuburbIds();
        app.store.getUndoManager().clear();
        app.data.saveHotSuburbIds([defaults[1]]);
        app.store.undoLastAction();
        assert.deepEqual(app.data.readHotSuburbIds(), defaults);
        app.data.saveHotSuburbIds([defaults[1]]);
        const backup = JSON.parse(JSON.stringify(app.data.exportBackup()));
        assert.deepEqual(backup.hotSuburbIds, [defaults[1]]);
        app.store.createCommit('One hot suburb');
        app.data.saveHotSuburbIds([]);
        app.store.viewCommit(app.store.readCommits()[0].id);
        assert.deepEqual(app.data.readHotSuburbIds(), [defaults[1]]);
        assert.throws(() => app.data.saveHotSuburbIds(defaults), /read-only/);
        app.store.exitCommitView();
        assert.deepEqual(app.data.readHotSuburbIds(), []);
        assert.throws(() => app.data.saveHotSuburbIds(['missing']), /Invalid hot suburbs/);
        assert.throws(() => app.data.importBackup({ ...backup, hotSuburbIds: [defaults[0], defaults[0]] }, 'replace'), /Invalid hot suburbs/);
        assert.deepEqual(app.data.readHotSuburbIds(), []);
        app.data.importBackup(backup, 'replace');
        assert.deepEqual(app.data.readHotSuburbIds(), [defaults[1]]);
        const legacy = { ...backup }; delete legacy.hotSuburbIds;
        app.data.importBackup(legacy, 'merge');
        assert.deepEqual(app.data.readHotSuburbIds(), [defaults[1]]);
        app.data.importBackup(legacy, 'replace');
        assert.deepEqual(app.data.readHotSuburbIds(), defaults);
    } finally { app.dispose(); }
});
