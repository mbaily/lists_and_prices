import { billLine, type BillSection } from './billsInclude';
import { calendarLine, calendarOccurrenceLabel, calendarSectionRows, type CalendarOccurrence, type CalendarSection } from './calendarInclude';

export type IncludeEntry = { id: string; name: string };

/** Stable identities keep pause/dismiss state separate from the containing item. */
export function isIncludedErrandId(id: string): boolean {
	return /^include:calendar:\d+:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(id)
		|| /^include:bill:\d+:(?:\d{4}-\d{2}-\d{2}|none)$/.test(id);
}

export function calendarIncludeEntries(occurrences: CalendarOccurrence[], section: CalendarSection, now: Date): IncludeEntry[] {
	return calendarSectionRows(occurrences, section, now).filter(row => !row.completed).map(row => ({
		id: `include:calendar:${row.event.id}:${row.occurrence_at}`,
		name: calendarLine(calendarOccurrenceLabel(row, now), row.event.title)
	}));
}

/** Paid, inactive and budget-summary sections are informational, rather than open errands. */
export function billIncludeEntries(data: Record<string, unknown>, section: BillSection): IncludeEntry[] {
	if (['covered_early', 'recent_payments', 'monthly_estimates', 'inactive_bills'].includes(section)) return [];
	if (!Array.isArray(data[section])) return [];
	const overdue = (section === 'upcoming' || section === 'due_today') && Array.isArray(data.overdue) ? data.overdue : [];
	return [...overdue, ...data[section]].flatMap((row: unknown) => {
		if (!row || typeof row !== 'object' || Array.isArray(row)) return [];
		const bill = row as Record<string, unknown>;
		if (!Number.isSafeInteger(bill.id) || bill.is_active === false) return [];
		const due = typeof bill.next_due_date === 'string' ? bill.next_due_date.slice(0, 10) : 'none';
		const id = `include:bill:${bill.id}:${due}`;
		return isIncludedErrandId(id) ? [{ id, name: billLine(bill, section) }] : [];
	});
}
