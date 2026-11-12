export const calendarSections = {
	today: 'Today',
	today_tomorrow: 'Today and tomorrow',
	next_7_days: 'Next 7 days',
	yesterday_today_tomorrow: 'Yesterday, today and tomorrow'
} as const;
export type CalendarSection = keyof typeof calendarSections;

export type CalendarOccurrence = {
	event: { id: number; title: string; all_day: boolean; important_if_late?: boolean };
	occurrence_at: string;
	completed: boolean;
	is_late?: boolean;
	is_important?: boolean;
};

export function calendarLine(label: string, title: string): string {
	return `${label}, ${title}`;
}

export function findCalendarSections(text: string, includeWrapped = true): CalendarSection[] {
	const found: CalendarSection[] = [];
	for (const token of findIncludeTokens(text)) {
		if (token.type !== 'calendar' || (!includeWrapped && token.wrap)) continue;
		const section = token.section as CalendarSection;
		if (Object.hasOwn(calendarSections, section) && !found.includes(section)) found.push(section);
	}
	return found;
}

function localDate(date: Date, offset = 0): string {
	const day = new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset);
	return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
}

export function calendarRange(section: CalendarSection, now: Date): { start: string; end: string } {
	const startOffset = section === 'yesterday_today_tomorrow' ? -1 : 0;
	const endOffset = section === 'next_7_days' ? 6 : section === 'today' ? 0 : 1;
	return { start: localDate(now, startOffset), end: localDate(now, endOffset) };
}

export const CALENDAR_LOOKBACK_DAYS = 355;

export function calendarQueryRange(sections: CalendarSection[], now: Date): { start: string; end: string } {
	if (sections.length === 0) return { start: localDate(now), end: localDate(now) };
	const ranges = sections.map((section) => calendarRange(section, now));
	const end = ranges.map((range) => range.end).sort().reverse()[0];
	const start = localDate(now, -CALENDAR_LOOKBACK_DAYS);
	return { start, end };
}

export function isImportantOccurrence(occurrence: CalendarOccurrence, now: Date): boolean {
	if (occurrence.completed) return false;
	if (occurrence.is_important !== undefined) return Boolean(occurrence.is_important);
	if (!occurrence.event.important_if_late) return false;
	return occurrence.occurrence_at.slice(0, 10) < localDate(now);
}

/** The same range and overdue-important rules apply wherever an include is used. */
export function calendarSectionRows(occurrences: CalendarOccurrence[], section: CalendarSection, now: Date): CalendarOccurrence[] {
	const range = calendarRange(section, now);
	return occurrences.filter(row => {
		const date = row.occurrence_at.slice(0, 10);
		return (date >= range.start && date <= range.end)
			|| (date < range.start && isImportantOccurrence(row, now));
	});
}

export function parseCalendarResponse(data: unknown): CalendarOccurrence[] {
	if (!data || typeof data !== 'object' || !('occurrences' in data) || !Array.isArray(data.occurrences)) {
		throw new Error('Invalid calendar response.');
	}
	return data.occurrences.map((rawRow: unknown) => {
		if (!rawRow || typeof rawRow !== 'object' || !('event' in rawRow) || !rawRow.event ||
			typeof rawRow.event !== 'object' || !('id' in rawRow.event) || typeof rawRow.event.id !== 'number' || !Number.isSafeInteger(rawRow.event.id) ||
			!('title' in rawRow.event) || typeof rawRow.event.title !== 'string' ||
			!('all_day' in rawRow.event) || typeof rawRow.event.all_day !== 'boolean' ||
			!('occurrence_at' in rawRow) || typeof rawRow.occurrence_at !== 'string' ||
			!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?$/.test(rawRow.occurrence_at) ||
			!('completed' in rawRow) || typeof rawRow.completed !== 'boolean') {
			throw new Error('Invalid calendar occurrence.');
		}
		const row = rawRow as {
			event: { id: number; title: string; all_day: boolean; important_if_late?: unknown };
			occurrence_at: string;
			completed: boolean;
			is_late?: unknown;
			is_important?: unknown;
		};
		if ('is_late' in row && typeof row.is_late !== 'boolean') {
			throw new Error('Invalid calendar occurrence.');
		}
		if ('is_important' in row && typeof row.is_important !== 'boolean') {
			throw new Error('Invalid calendar occurrence.');
		}
		if ('important_if_late' in row.event && typeof row.event.important_if_late !== 'boolean') {
			throw new Error('Invalid calendar occurrence.');
		}
		const [year, month, day] = row.occurrence_at.slice(0, 10).split('-').map(Number);
		if (localDate(new Date(year, month - 1, day)) !== row.occurrence_at.slice(0, 10)) {
			throw new Error('Invalid calendar occurrence date.');
		}
		return {
			event: {
				id: row.event.id,
				title: row.event.title,
				all_day: row.event.all_day,
				...(typeof row.event.important_if_late === 'boolean' ? { important_if_late: row.event.important_if_late } : {})
			},
			occurrence_at: row.occurrence_at,
			completed: row.completed,
			...(typeof row.is_late === 'boolean' ? { is_late: row.is_late } : {}),
			...(typeof row.is_important === 'boolean' ? { is_important: row.is_important } : {})
		};
	});
}

export function calendarOccurrenceLabel(occurrence: CalendarOccurrence, now: Date): string {
	const date = occurrence.occurrence_at.slice(0, 10);
	let label: string;
	if (date === localDate(now, -1)) label = 'Yesterday';
	else if (date === localDate(now)) label = 'Today';
	else if (date === localDate(now, 1)) label = 'Tomorrow';
	else {
		const [year, month, day] = date.split('-').map(Number);
		label = new Date(year, month - 1, day).toLocaleDateString(undefined, { dateStyle: 'medium' });
	}
	if (!occurrence.event.all_day) label += ` ${occurrence.occurrence_at.slice(11, 16)}`;
	return label;
}
import { findIncludeTokens } from './includeTokens';
