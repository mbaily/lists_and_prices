import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp, componentFunctions, transpile, merge } from './helpers/app.mjs';

const now = new Date(2026, 10, 12, 12);
const shop = { id: 'shop', name: 'Woolworths', tags: ['woolworths'], latitude: -37.8, longitude: 145 };
const occurrence = (id, title, date = '2026-11-12', extra = {}) => ({
    event: { id, title, all_day: true }, occurrence_at: date + 'T00:00:00', completed: false, ...extra
});

function fixture() {
    const app = createApp();
    const includes = app.load('src/lib/includedErrands.ts');
    const entries = app.load('src/lib/includeEntries.ts');
    const folder = app.data.createFolder('Tasks', null);
    const list = app.data.createList('Plans', folder, 'plain');
    const source = app.data.createItem(list, '[[calendar:today:wrap:icon]] [[bills:upcoming]]', null, null, true);
    const sources = () => includes.findInclusionSources(app.data.readAllItems(), app.data.readLists(), app.data.readFolders());
    const collect = (calendar = [], bills = {}, locations = [shop]) => includes.collectIncludedErrands(sources(), {
        calendar: section => entries.calendarIncludeEntries(calendar, section, now),
        bills: section => entries.billIncludeEntries(bills, section)
    }, app.data.readFolders(), locations);
    return { app, entries, folder, list, source, sources, collect };
}

test('inclusion text uses normal case-insensitive hashtag boundaries and preserves other text', () => {
    const app = createApp();
    try {
        const { splitHashtags, extractTags } = app.load('src/lib/tags.ts');
        const text = 'Today, Collect #ERRANDS\n#Woolies https://example.com/#not_a_tag, #urgent';
        const parts = splitHashtags(text);
        assert.equal(parts.map(part => part.value).join(''), text);
        assert.deepEqual(parts.filter(part => part.type === 'tag').map(part => part.value), ['#ERRANDS', '#Woolies', '#urgent']);
        assert.deepEqual(extractTags(text), ['errands', 'woolies', 'urgent']);
    } finally { app.dispose(); }
});

test('included calendar titles and bill names enter existing matching rules without creating items', () => {
    const { app, source, list, collect } = fixture();
    try {
        const before = app.data.readAllItems();
        const calendar = [occurrence(1, 'Collect parcel #errand'), occurrence(2, 'Buy milk #WOOLIES'),
            occurrence(3, 'Unregistered #errands'), occurrence(4, 'Ordinary #urgent')];
        const bills = { overdue: [{ id: 1, name: 'Pay cash #bank', next_due_date: '2026-11-01' }],
            upcoming: [{ id: 2, name: 'Pay shop #woolworths', next_due_date: '2026-11-15', effective_amount: 10 }] };
        let errands = collect(calendar, bills);
        assert.equal(errands.length, 4);
        assert.ok(errands.every(errand => errand.list.id === list && errand.inclusion.sourceItemId === source && errand.item.note));
        assert.deepEqual(app.data.readAllItems(), before);
        const nearby = app.load('src/lib/nearbyErrands.ts');
        assert.equal(nearby.nearbyStops([shop], shop, 1, errands)[0].errands.length, 2);
        const distant = { ...shop, latitude: -38.5 };
        assert.deepEqual(nearby.nearbyStops([distant], shop, 1, errands), []);
        assert.equal(nearby.nearbyStops([distant], null, 1, errands)[0].errands.length, 2);
        assert.equal(app.load('src/lib/nearbyPills.ts').nearbyTaskPills([], errands).length, 2);
        app.data.setLocationOptionalTag('errands', true);
        errands = collect(calendar, bills);
        assert.equal(errands.length, 5);
        assert.equal(app.load('src/lib/nearbyPills.ts').nearbyTaskPills([], errands).length, 3);
    } finally { app.dispose(); }
});

test('calendar inclusion range, late-important and completion rules match the rendered section', () => {
    const { app, entries } = fixture();
    try {
        const rows = [occurrence(1, 'Today #errand'), occurrence(1, 'Tomorrow #errand', '2026-11-13'),
            occurrence(2, 'Done #errand', '2026-11-12', { completed: true }),
            occurrence(3, 'Old #errand', '2026-11-01'),
            occurrence(4, 'Important #errand', '2026-11-01', { is_important: true }),
            occurrence(5, 'Next week #errand', '2026-11-20')];
        assert.deepEqual(entries.calendarIncludeEntries(rows, 'today', now).map(row => row.id), [
            'include:calendar:1:2026-11-12T00:00:00', 'include:calendar:4:2026-11-01T00:00:00'
        ]);
        assert.equal(entries.calendarIncludeEntries(rows, 'today_tomorrow', now).length, 3);
        assert.deepEqual(entries.calendarIncludeEntries(rows.map(row => ({ ...row, completed: true })), 'today', now), []);
    } finally { app.dispose(); }
});

test('informational and paid bill sections stay out of active errands and cycles have separate identities', () => {
    const { app, entries } = fixture();
    try {
        const bill = { id: 3, name: 'Account #errand', next_due_date: '2026-11-12', is_active: true };
        const first = entries.billIncludeEntries({ upcoming: [bill], overdue: [bill] }, 'upcoming');
        assert.equal(first[0].id, 'include:bill:3:2026-11-12');
        assert.notEqual(entries.billIncludeEntries({ upcoming: [{ ...bill, next_due_date: '2026-12-12' }] }, 'upcoming')[0].id, first[0].id);
        for (const section of ['covered_early', 'recent_payments', 'monthly_estimates', 'inactive_bills']) {
            assert.deepEqual(entries.billIncludeEntries({ [section]: [bill] }, section), []);
        }
        assert.deepEqual(entries.billIncludeEntries({ upcoming: [{ ...bill, is_active: false }, null, 'bad', {}] }, 'upcoming'), []);
        assert.deepEqual(entries.billIncludeEntries({}, 'upcoming'), []);
        assert.equal(entries.billIncludeEntries({ unscheduled: [{ ...bill, next_due_date: null }] }, 'unscheduled')[0].id, 'include:bill:3:none');
    } finally { app.dispose(); }
});

test('duplicate wrapped and vertical references collapse, while recurring occurrences stay separate', () => {
    const { app, list, source, collect } = fixture();
    try {
        app.data.updateItem(source, { name: '[[calendar:today_tomorrow:wrap]] [[calendar:today]] [[bills:upcoming]] [[bills:overdue:wrap]]' });
        app.data.createItem(list, '[[calendar:today]] [[bills:upcoming:icon]]', null, null, true);
        const bills = { overdue: [{ id: 1, name: 'Bill #errand', next_due_date: '2026-11-01' }], upcoming: [] };
        const errands = collect([occurrence(1, 'Recurring #errand'), occurrence(1, 'Recurring #errand', '2026-11-13')], bills);
        assert.equal(errands.length, 3);
        assert.equal(new Set(errands.map(errand => errand.item.id)).size, 3);
        assert.ok(errands.every(errand => errand.inclusion.sourceItemId === source));
    } finally { app.dispose(); }
});

test('included entries inherit list tags and explicit recognized tags override inheritance', () => {
    const { app, list, collect } = fixture();
    try {
        app.data.updateList(list, { name: 'Shopping #supermarket' });
        const rows = [occurrence(1, 'Plain #urgent'), occurrence(2, 'Withdraw #bank'), occurrence(3, 'Unregistered #errands')];
        let errands = collect(rows);
        assert.deepEqual(errands.map(errand => errand.tags), [['urgent', 'supermarket'], ['bank'], ['errands', 'supermarket']]);
        assert.deepEqual(errands.map(errand => errand.inheritsListTags), [true, false, true]);
        app.data.updateList(list, { done: true });
        errands = collect(rows);
        assert.equal(errands.length, 1);
        assert.deepEqual(errands[0].tags, ['bank']);
        app.data.updateList(list, { archived: true });
        assert.deepEqual(collect(rows), []);
    } finally { app.dispose(); }
});

test('completed source todos, headings and archived ancestors do not expose their inclusions', () => {
    const { app, source, folder, list, sources } = fixture();
    try {
        assert.equal(sources().length, 1);
        app.data.updateItem(source, { heading: true });
        assert.deepEqual(sources(), []);
        app.data.updateItem(source, { heading: false, note: false, checked: true });
        assert.deepEqual(sources(), []);
        app.data.updateItem(source, { note: true });
        assert.equal(sources().length, 1, 'notes ignore todo checkbox state');
        app.data.updateFolder(folder, { archived: true });
        assert.deepEqual(sources(), []);
        app.data.updateFolder(folder, { archived: false });
        app.data.updateItem(source, { note: false, checked: false });
        app.data.updateFolder(folder, { checkboxes: [{ id: 'done', name: 'Done' }] });
        app.data.setItemCheckboxState(source, 'done', true);
        assert.deepEqual(sources(), [], 'named completion uses the source folder rules');
        assert.equal(app.data.readLists().find(row => row.id === list).archived, false);
    } finally { app.dispose(); }
});

test('included rows can pause and dismiss independently and navigating opens the containing inclusion', () => {
    const { app, source, list, collect } = fixture();
    const peer = createApp();
    try {
        const [errand] = collect([occurrence(1, 'Collect #errand')]);
        app.data.setErrandItemPaused(errand.item.id, true);
        assert.deepEqual(app.data.readPausedErrandItemIds(), [errand.item.id]);
        assert.equal(app.load('src/lib/nearbyErrands.ts').isErrandPaused(errand, [], app.data.readPausedErrandItemIds()), true);
        merge(app.doc, peer.doc);
        assert.deepEqual(peer.data.readPausedErrandItemIds(), [errand.item.id]);
        app.data.setErrandItemPaused(errand.item.id, false);
        const fingerprint = app.data.nearbyItemFingerprint(errand.item, errand.list, app.data.readFolders()[0]);
        app.data.dismissNearbyChecklist([{ id: errand.item.id, fingerprint }]);
        assert.equal(app.load('src/lib/nearbyChecklist.ts').isChecklistDismissed(app.data.readNearbyChecklist()[errand.item.id], fingerprint, false), true);
        const before = app.data.readAllItems();
        app.data.setNearbyTodoDone(errand.item.id, true);
        assert.deepEqual(app.data.readAllItems(), before, 'included entries cannot complete the containing todo');
        const calls = [];
        const code = componentFunctions('src/lib/components/NearbyErrandsScreen.svelte', ['openPill', 'openErrand']);
        const actions = new Function('onOpenItem', 'onOpenList', `${transpile(code)}; return {openPill, openErrand};`)(
            (listId, itemId) => calls.push([listId, itemId]), () => assert.fail('explicit tag should target its inclusion')
        );
        actions.openPill({ id: `item:${errand.item.id}`, list: errand.list, errands: [errand] });
        actions.openErrand(errand);
        assert.deepEqual(calls, [[list, source], [list, source]]);
    } finally { app.dispose(); peer.dispose(); }
});
