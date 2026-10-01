import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { searchSuburbs, type Suburb } from '../src/lib/suburbSearch.ts';
import { distanceKm, validCoordinates } from '../src/lib/retailLocations.ts';

const catalogue = JSON.parse(readFileSync(new URL('../src/lib/locations/melbourne-suburbs.json', import.meta.url), 'utf8'));
const suburbs: Suburb[] = catalogue.suburbs;

test('official suburb catalogue covers inner, outer and peninsula Melbourne independently of retailers', () => {
    assert.equal(catalogue.councils.length, 31);
    assert.ok(suburbs.length > 500);
    assert.equal(new Set(suburbs.map(suburb => suburb.id)).size, suburbs.length);
    for (const suburb of suburbs) {
        assert.ok(suburb.name.trim());
        assert.ok(validCoordinates(suburb));
        assert.ok(suburb.latitude < -37 && suburb.latitude > -39);
        assert.ok(suburb.longitude > 144 && suburb.longitude < 147);
    }
    for (const name of ['Melbourne', 'Richmond', 'Werribee', 'Sunbury', 'Pakenham', 'Warburton', 'Portsea', 'Fraser Rise', 'Wollert']) {
        assert.equal(searchSuburbs(suburbs, name)[0]?.name, name);
    }
    const melbourne = searchSuburbs(suburbs, 'Melbourne')[0];
    assert.ok(distanceKm(melbourne, { latitude: -37.8136, longitude: 144.9631 }) < 3);
    assert.ok(!suburbs.some(suburb => suburb.name === 'Geelong'));
});

test('fuzzy suburb search handles spelling, transpositions, case, punctuation and partial names', () => {
    for (const [query, expected] of [
        ['brunswik', 'Brunswick'], ['fitzory', 'Fitzroy'], ['mt waverly', 'Mount Waverley'],
        ['  RICHMOND  ', 'Richmond'], ['st-kilda', 'St Kilda'], ['brunswick e', 'Brunswick East']
    ]) assert.equal(searchSuburbs(suburbs, query)[0]?.name, expected, query);
    assert.deepEqual(searchSuburbs(suburbs, ''), []);
    assert.deepEqual(searchSuburbs(suburbs, 'zzzzzz'), []);
    assert.deepEqual(searchSuburbs(suburbs, 'melbourne', 0), []);
    assert.ok(searchSuburbs(suburbs, 'a').length <= 8);
    assert.ok(searchSuburbs(suburbs, 'brunswick').slice(1).some(suburb => suburb.name === 'Brunswick East'));
    assert.ok(searchSuburbs(suburbs, 'brunswick').slice(1).some(suburb => suburb.name === 'Brunswick West'));
});
