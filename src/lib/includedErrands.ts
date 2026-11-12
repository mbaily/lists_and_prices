import { isItemDone, isListEffectivelyArchived, type Folder, type Item, type ListMeta } from './data';
import { findBillSections, type BillSection } from './billsInclude';
import { findCalendarSections, type CalendarSection } from './calendarInclude';
import { collectErrands, type Errand } from './nearbyErrands';
import type { IncludeEntry } from './includeEntries';
import type { RetailLocation } from './retailLocations';

export type InclusionSource = { item: Item; list: ListMeta; bills: BillSection[]; calendar: CalendarSection[] };

export function findInclusionSources(items: Item[], lists: ListMeta[], folders: Folder[]): InclusionSource[] {
	const available = new Map(lists.filter(list => list.type !== 'divider' && !isListEffectivelyArchived(list, folders)).map(list => [list.id, list]));
	const folderById = new Map(folders.map(folder => [folder.id, folder]));
	return items.flatMap(item => {
		const list = available.get(item.listId);
		if (!list || item.heading || (!item.note && isItemDone(item, folderById.get(list.folderId)))) return [];
		const bills = findBillSections(item.name), calendar = findCalendarSections(item.name);
		return bills.length || calendar.length ? [{ item, list, bills, calendar }] : [];
	});
}

/** Live rows use the normal tag, alias, list-inheritance and archive rules, without creating todos. */
export function collectIncludedErrands(sources: InclusionSource[], entries: {
	bills: (section: BillSection) => IncludeEntry[];
	calendar: (section: CalendarSection) => IncludeEntry[];
}, folders: Folder[], locations: readonly RetailLocation[]): Errand[] {
	const found = new Map<string, Errand>();
	for (const source of sources) {
		for (const type of ['bills', 'calendar'] as const) {
			const items = new Map<string, Item>();
			for (const section of source[type]) {
				const rows = type === 'bills' ? entries.bills(section as BillSection) : entries.calendar(section as CalendarSection);
				for (const entry of rows) {
					if (found.has(entry.id)) continue;
					const item: Item = { ...source.item, id: entry.id, name: entry.name,
						heading: false, parentId: null, note: true, checked: false, checks: {} };
					items.set(item.id, item);
				}
			}
			for (const errand of collectErrands([...items.values()], [source.list], folders, false, locations)) {
				found.set(errand.item.id, { ...errand, inclusion: { sourceItemId: source.item.id, type } });
			}
		}
	}
	return [...found.values()];
}
