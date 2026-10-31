export const calendarSections = {
	today: 'Today',
	today_tomorrow: 'Today and tomorrow',
	next_7_days: 'Next 7 days',
	yesterday_today_tomorrow: 'Yesterday, today and tomorrow'
} as const;
export type CalendarSection = keyof typeof calendarSections;

export type CalendarOccurrence = {
	event: { id: number; title: string; all_day: boolean };
	occurrence_at: string;
	completed: boolean;
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

export function parseCalendarResponse(data: unknown): CalendarOccurrence[] {
	if (!data || typeof data !== 'object' || !('occurrences' in data) || !Array.isArray(data.occurrences)) {
		throw new Error('Invalid calendar response.');
	}
	return data.occurrences.map((row: unknown) => {
		if (!row || typeof row !== 'object' || !('event' in row) || !row.event ||
			typeof row.event !== 'object' || !('id' in row.event) || typeof row.event.id !== 'number' || !Number.isSafeInteger(row.event.id) ||
			!('title' in row.event) || typeof row.event.title !== 'string' ||
			!('all_day' in row.event) || typeof row.event.all_day !== 'boolean' ||
			!('occurrence_at' in row) || typeof row.occurrence_at !== 'string' ||
			!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?$/.test(row.occurrence_at) ||
			!('completed' in row) || typeof row.completed !== 'boolean') {
			throw new Error('Invalid calendar occurrence.');
		}
		const [year, month, day] = row.occurrence_at.slice(0, 10).split('-').map(Number);
		if (localDate(new Date(year, month - 1, day)) !== row.occurrence_at.slice(0, 10)) {
			throw new Error('Invalid calendar occurrence date.');
		}
		return {
			event: { id: row.event.id, title: row.event.title, all_day: row.event.all_day },
			occurrence_at: row.occurrence_at,
			completed: row.completed
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
