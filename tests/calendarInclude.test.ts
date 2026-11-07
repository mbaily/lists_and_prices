import { test } from 'node:test';
import { deepStrictEqual, strictEqual, throws } from 'node:assert';
import {
	calendarLine, calendarOccurrenceLabel, calendarRange, calendarQueryRange, findCalendarSections,
	isImportantOccurrence, parseCalendarResponse, CALENDAR_LOOKBACK_DAYS,
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
		{ occurrences: [{ ...row, occurrence_at: '2026-11-01T09:05:00Z' }] },
		{ occurrences: [{ ...row, is_late: 'yes' }] },
		{ occurrences: [{ ...row, is_important: 1 }] },
		{ occurrences: [{ ...row, event: { ...row.event, important_if_late: 'false' } }] }]) {
		throws(() => parseCalendarResponse(bad), /Invalid calendar/);
	}
});

test('parses important_if_late, is_late and is_important metadata when provided', () => {
	const row = {
		event: { id: 42, title: 'Urgent task', all_day: false, important_if_late: true },
		occurrence_at: '2026-10-25T10:00:00',
		completed: false,
		is_late: true,
		is_important: true
	};
	deepStrictEqual(parseCalendarResponse({ occurrences: [row] }), [{
		event: { id: 42, title: 'Urgent task', all_day: false, important_if_late: true },
		occurrence_at: '2026-10-25T10:00:00',
		completed: false,
		is_late: true,
		is_important: true
	}]);
});

test('isImportantOccurrence identifies uncompleted late important occurrences', () => {
	const now = new Date(2026, 10, 4, 10); // 2026-11-04
	const lateImportant: CalendarOccurrence = {
		event: { id: 1, title: 'Fix leak', all_day: true, important_if_late: true },
		occurrence_at: '2026-11-01T00:00:00',
		completed: false,
		is_late: true,
		is_important: true
	};
	strictEqual(isImportantOccurrence(lateImportant, now), true);

	// Completed event is never important
	strictEqual(isImportantOccurrence({ ...lateImportant, completed: true, is_important: false }, now), false);
	strictEqual(isImportantOccurrence({ ...lateImportant, completed: true, is_important: true }, now), false);

	// Event without important_if_late is not important
	strictEqual(isImportantOccurrence({
		event: { id: 2, title: 'Normal', all_day: false, important_if_late: false },
		occurrence_at: '2026-11-01T09:00:00',
		completed: false,
		is_late: true,
		is_important: false
	}, now), false);

	// Event from today or future without is_important flag set
	strictEqual(isImportantOccurrence({
		event: { id: 3, title: 'Today event', all_day: false, important_if_late: true },
		occurrence_at: '2026-11-04T15:00:00',
		completed: false
	}, now), false);

	// Fallback calculation when is_important is omitted
	strictEqual(isImportantOccurrence({
		event: { id: 4, title: 'Overdue fallback', all_day: false, important_if_late: true },
		occurrence_at: '2026-11-02T15:00:00',
		completed: false
	}, now), true);
});

test('calendarQueryRange looks back CALENDAR_LOOKBACK_DAYS without exceeding 365 day span', () => {
	const now = new Date(2026, 10, 4); // 2026-11-04
	const query = calendarQueryRange(['next_7_days'], now);
	strictEqual(query.end, '2026-11-10');
	const start = new Date(query.start);
	const end = new Date(query.end);
	const spanDays = Math.round((end.getTime() - start.getTime()) / (86400 * 1000));
	strictEqual(spanDays <= 365, true);
	strictEqual(query.start, '2025-11-14');
});
