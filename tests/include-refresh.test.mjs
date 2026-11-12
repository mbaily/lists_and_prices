import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp, componentFunctions, transpile } from './helpers/app.mjs';

test('include snapshots survive navigation but remain isolated by document, service, range and day', () => {
    const app = createApp();
    try {
        const { readIncludeCache, writeIncludeCache } = app.load('src/lib/includeCache.ts');
        const day = new Date(2026, 10, 12, 12), nextDay = new Date(2026, 10, 13, 12);
        const narrow = [], wide = [{ title: 'Tomorrow' }], bills = { upcoming: [] };
        writeIncludeCache(app.doc, 'calendar:today', narrow, 'narrow', day);
        writeIncludeCache(app.doc, 'calendar:today_tomorrow', wide, 'wide', day);
        writeIncludeCache(app.doc, 'bills', bills, 'bills', day);
        assert.equal(readIncludeCache(app.doc, 'calendar:today', day).value, narrow, 'An empty successful result is cached too');
        assert.equal(readIncludeCache(app.doc, 'calendar:today_tomorrow', day).value, wide, 'Opening a narrower include cannot overwrite the wider Nearby result');
        assert.equal(readIncludeCache(app.doc, 'bills', day).value, bills);
        assert.equal(readIncludeCache({}, 'bills', day), undefined, 'New accounts/documents cannot reuse earlier responses');
        assert.equal(readIncludeCache(app.doc, 'bills', nextDay), undefined);
        assert.equal(readIncludeCache(app.doc, 'calendar:today', nextDay), undefined);
        writeIncludeCache(app.doc, 'bills', { upcoming: [{ id: 1 }] }, 'new', nextDay);
        assert.equal(readIncludeCache(app.doc, 'calendar:today_tomorrow', day), undefined, 'Old-day ranges are evicted when fresh data arrives');
        assert.equal(readIncludeCache(app.doc, 'bills', nextDay).checksum, 'new');
    } finally { app.dispose(); }
});

for (const kind of ['bills', 'calendar']) {
    test(`${kind} refresh retains visible data, skips identical replacements and preserves the snapshot on failure`, async () => {
        const app = createApp();
        try {
            const { readIncludeCache, writeIncludeCache } = app.load('src/lib/includeCache.ts');
            const calendar = app.load('src/lib/calendarInclude.ts');
            const value = kind === 'bills' ? { upcoming: [{ id: 1, name: 'Bill #bank' }] } : [{
                event: { id: 1, title: 'Event #errand', all_day: true }, occurrence_at: '2026-11-12T00:00:00', completed: false
            }];
            const payload = kind === 'bills' ? value : { occurrences: value };
            let responseText = JSON.stringify(payload), release;
            const gate = new Promise(resolve => { release = resolve; });
            const state = {
                hasLoaded: true, lastChecksum: responseText, lastValue: value, lastSectionsKey: '',
                loading: false, refreshing: false, error: '', controller: undefined, cacheScope: app.doc,
                data: kind === 'bills' ? value : null, occurrences: kind === 'calendar' ? value : [], now: new Date(),
                base: '', calendarQueryRange: calendar.calendarQueryRange, parseCalendarResponse: calendar.parseCalendarResponse,
                simpleTodoApiUrl: app.load('src/lib/simpleTodo.ts').simpleTodoApiUrl,
                writeIncludeCache, fetch: async () => { await gate; return { ok: true, status: 200, text: async () => responseText }; }
            };
            const name = kind === 'bills' ? 'fetchBills' : 'refreshSelected';
            const file = kind === 'bills' ? 'BillsInclude' : 'CalendarInclude';
            const source = componentFunctions(`src/lib/components/${file}.svelte`, [name]);
            const refresh = new Function('state', `with(state) { ${transpile(source)}; return ${name}; }`)(state);
            const section = kind === 'bills' ? 'upcoming' : 'today';
            const running = refresh([section], true);
            assert.equal(state.loading, false, 'Background refresh cannot replace existing rows with loading UI');
            assert.equal(state.refreshing, true);
            assert.equal(kind === 'bills' ? state.data : state.occurrences, value);
            release();
            await running;
            assert.equal(kind === 'bills' ? state.data : state.occurrences, value, 'An identical response preserves the original array/object identity');
            assert.equal(state.refreshing, false);
            const key = kind === 'bills' ? 'bills' : 'calendar:today';
            assert.equal(readIncludeCache(app.doc, key).value, value, 'An unchanged successful response renews the cache');
            responseText = '<html>Unavailable</html>';
            await refresh([section], true);
            assert.equal(kind === 'bills' ? state.data : state.occurrences, value);
            assert.equal(state.lastChecksum, JSON.stringify(payload), 'Invalid responses cannot poison the successful checksum');
            assert.equal(readIncludeCache(app.doc, key).value, value);
            state.fetch = async () => { throw new Error('Offline'); };
            await refresh([section], true);
            assert.equal(state.error, '', 'A temporary failure keeps already loaded rows visible');
            assert.equal(state.refreshing, false);
            state.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify(kind === 'bills' ? { upcoming: [] } : { occurrences: [] }) });
            await refresh([section], true);
            assert.deepEqual(kind === 'bills' ? state.data : state.occurrences, kind === 'bills' ? { upcoming: [] } : [], 'Real API changes still replace the previous result');
        } finally { app.dispose(); }
    });
}
