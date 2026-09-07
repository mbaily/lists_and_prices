import type * as Y from 'yjs';

export type ReportAssignments = Record<string, string[]>;
export const REPORT_MEMBERSHIPS = 'smart-folder-memberships';

/** A flat key per (report, folder) avoids both whole-array overwrites and
 * concurrent creation of competing nested maps. False values are tombstones. */
export function readReportAssignments(doc: Y.Doc): ReportAssignments {
	const reports = new Map<string, Set<string>>();
	doc.getMap<unknown>('smart-folders').forEach((value, name) => {
		try {
			const ids = typeof value === 'string' ? JSON.parse(value) : [];
			if (Array.isArray(ids)) reports.set(name, new Set(ids.filter((id): id is string => typeof id === 'string')));
		} catch { /* Ignore malformed legacy entries. */ }
	});
	doc.getMap<boolean>(REPORT_MEMBERSHIPS).forEach((present, key) => {
		try {
			const [name, id] = JSON.parse(key);
			if (typeof name !== 'string' || typeof id !== 'string') return;
			const ids = reports.get(name) ?? new Set<string>();
			if (present) ids.add(id); else ids.delete(id);
			reports.set(name, ids);
		} catch { /* Ignore malformed entries. */ }
	});
	return Object.fromEntries([...reports].filter(([, ids]) => ids.size > 0).map(([name, ids]) => [name, [...ids].sort()]));
}

export function setReportMembership(doc: Y.Doc, name: string, id: string, present: boolean): void {
	doc.getMap<boolean>(REPORT_MEMBERSHIPS).set(JSON.stringify([name, id]), present);
}

export function restoreReportAssignments(doc: Y.Doc, reports: ReportAssignments, replace: boolean): void {
	if (replace) {
		doc.getMap('smart-folders').clear();
		doc.getMap(REPORT_MEMBERSHIPS).clear();
	}
	for (const [name, ids] of Object.entries(reports)) {
		for (const id of ids) setReportMembership(doc, name, id, true);
	}
}