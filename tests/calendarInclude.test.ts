import { test } from 'node:test';
import { deepStrictEqual, strictEqual, throws } from 'node:assert';
import {
	calendarLine, calendarOccurrenceLabel, calendarRange, findCalendarSections, parseCalendarResponse,
	type CalendarOccurrence
} from '../src/lib/calendarInclude';

test('finds known distinct calendar includes without changing bill references', () => {
	deepStrictEqual(findCalendarSections('[[calendar:TODAY]] [[bills:upcoming]] [[calendar:next_7_days]] [[calendar:today]] [[calendar:unknown]]'),
		['today', 'next_7_days']);
});

test('accepts icon includes while rejecting unknown options and sections', () => {
	deepStrictEqual(findCalendarSections('[[calendar:today:icon]] [[CALENDAR:NEXT_7_DAYS:ICON]] [[calendar:today]] [[calendar:today_tomorrow:other]] [[calendar:unknown:icon]]'),
		['today', 'next_7_days']);
});

test('finds wrapped ranges while excluding them from vertical lists', () => {
	const text = '[[calendar:today:wrap]] [[calendar:next_7_days:icon:wrap]] [[calendar:today_tomorrow:wrap:icon]] [[calendar:yesterday_today_tomorrow]] [[calendar:today:wrap:wrap]]';
	deepStrictEqual(findCalendarSections(text), ['today', 'next_7_days', 'today_tomorrow', 'yesterday_today_tomorrow']);
	deepStrictEqual(findCalendarSections(text, false), ['yesterday_today_tomorrow']);
	deepStrictEqual(findCalendarSections('[[calendar:today:wrap]] [[calendar:today]]', false), ['today']);
});

test('ranges include the requested days across month and year boundaries', () => {
	const now = new Date(2026, 11, 31, 23, 55);
	deepStrictEqual(calendarRange('today', now), { start: '2026-12-31', end: '2026-12-31' });
	deepStrictEqual(calendarRange('today_tomorrow', now), { start: '2026-12-31', end: '2027-01-01' });
	deepStrictEqual(calendarRange('next_7_days', now), { start: '2026-12-31', end: '2027-01-06' });
	deepStrictEqual(calendarRange('yesterday_today_tomorrow', now), { start: '2026-12-30', end: '2027-01-01' });
});

test('labels relative days and shows wall-clock time only for timed events', () => {
	const now = new Date(2026, 10, 1, 23);
	const occurrence: CalendarOccurrence = {
		event: { id: 1, title: 'Meeting', all_day: false },
		occurrence_at: '2026-10-31T09:05:00',
		completed: false
	};
	strictEqual(calendarOccurrenceLabel(occurrence, now), 'Yesterday 09:05');
	strictEqual(calendarOccurrenceLabel({ ...occurrence, occurrence_at: '2026-11-01T23:59:00' }, now), 'Today 23:59');
	strictEqual(calendarOccurrenceLabel({ ...occurrence, occurrence_at: '2026-11-02T00:00:00' }, now), 'Tomorrow 00:00');
	strictEqual(calendarOccurrenceLabel({ ...occurrence, event: { ...occurrence.event, all_day: true }, occurrence_at: '2026-11-02T00:00:00' }, now), 'Tomorrow');
	strictEqual(calendarOccurrenceLabel({ ...occurrence, occurrence_at: '2026-11-03T14:30:00' }, now),
		`${new Date(2026, 10, 3).toLocaleDateString(undefined, { dateStyle: 'medium' })} 14:30`);
	strictEqual(calendarOccurrenceLabel({ ...occurrence, event: { ...occurrence.event, all_day: true }, occurrence_at: '2026-11-03T00:00:00' }, now),
		new Date(2026, 10, 3).toLocaleDateString(undefined, { dateStyle: 'medium' }));
});

test('formats calendar date and title with a comma', () => {
	strictEqual(calendarLine('Today 09:05', 'Meeting'), 'Today 09:05, Meeting');
	strictEqual(calendarLine('Tomorrow', 'Dinner, then a movie'), 'Tomorrow, Dinner, then a movie');
});

test('accepts API occurrences including completed recurrence and rejects malformed data', () => {
	const row = { event: { id: 1, title: 'Meeting', all_day: false, note: 'extra' }, occurrence_at: '2026-11-01T09:05:00.123456', completed: true };
	deepStrictEqual(parseCalendarResponse({ occurrences: [row] }), [{
		event: { id: 1, title: 'Meeting', all_day: false },
		occurrence_at: '2026-11-01T09:05:00.123456', completed: true
	}]);
	deepStrictEqual(parseCalendarResponse({ occurrences: [] }), []);
	for (const bad of [null, {}, { occurrences: [null] }, { occurrences: [{ ...row, completed: 'true' }] },
		{ occurrences: [{ ...row, occurrence_at: '2026-02-30T09:05:00' }] },
		{ occurrences: [{ ...row, occurrence_at: '2026-11-01T09:05:00Z' }] }]) {
		throws(() => parseCalendarResponse(bad), /Invalid calendar/);
	}
});
