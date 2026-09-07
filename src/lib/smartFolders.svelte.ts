/**
 * Smart folder (report) configuration — stored in the shared Y.Doc so it
 * syncs across devices just like folders, lists and items.
 *
 * Legacy JSON assignments are a read-only baseline. New writes use one CRDT
 * key per report/folder membership, so independent offline changes merge.
 *
 * The exported `smartFolders` is a plain reactive $state mirror that
 * HomeScreen components read directly; it is re-derived on every docState
 * tick so it stays live.
 */
import { getDoc, getMutableDoc, docState } from './yjsStore.svelte';
import { readReportAssignments, setReportMembership } from './reportAssignments';

function readAll(): Record<string, string[]> {
	try {
		return readReportAssignments(getDoc());
	} catch {
		return {};
	}
}

export type SmartFolderMap = Record<string, string[]>;

// Re-derive on every Yjs update tick so the UI stays reactive.
const _smartFolders: SmartFolderMap = $derived.by(() => {
	void docState.version; // subscribe to Yjs updates
	return readAll();
});
export function getSmartFolders(): SmartFolderMap { return _smartFolders; }

export function assignToReport(folderId: string, reportName: string) {
	const doc = getMutableDoc();
	doc.transact(() => setReportMembership(doc, reportName, folderId, true));
}

export function removeFromReport(folderId: string, reportName: string) {
	const doc = getMutableDoc();
	doc.transact(() => setReportMembership(doc, reportName, folderId, false));
}

export function deleteReport(reportName: string) {
	const doc = getMutableDoc();
	doc.transact(() => {
		for (const id of readReportAssignments(doc)[reportName] ?? []) setReportMembership(doc, reportName, id, false);
		doc.getMap('smart-folders').delete(reportName);
	});
}

/** Called by deleteFolder to purge a folder ID from all reports. */
export function removeFromAllReports(folderId: string) {
	const doc = getMutableDoc();
	doc.transact(() => {
		for (const [name, ids] of Object.entries(readReportAssignments(doc))) {
			if (ids.includes(folderId)) setReportMembership(doc, name, folderId, false);
		}
	});
}
