/**
 * Smart folder (report) configuration — stored in the shared Y.Doc so it
 * syncs across devices just like folders, lists and items.
 *
 * Yjs structure: Y.Map<string> keyed 'smart-folders', where each entry is
 *   reportName → JSON-encoded string[] of folder IDs
 *
 * The exported `smartFolders` is a plain reactive $state mirror that
 * HomeScreen components read directly; it is re-derived on every docState
 * tick so it stays live.
 */
import * as Y from 'yjs';
import { getDoc, docState } from './yjsStore.svelte';

function getYMap(): Y.Map<string> {
	return getDoc().getMap('smart-folders');
}

function readAll(): Record<string, string[]> {
	try {
		const m = getYMap();
		const out: Record<string, string[]> = {};
		m.forEach((val, key) => {
			try { out[key] = JSON.parse(val); } catch { /* skip corrupt entry */ }
		});
		return out;
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
	const m = getYMap();
	const current: string[] = (() => { try { return JSON.parse(m.get(reportName) ?? '[]'); } catch { return []; } })();
	if (!current.includes(folderId)) {
		m.set(reportName, JSON.stringify([...current, folderId]));
	}
}

export function removeFromReport(folderId: string, reportName: string) {
	const m = getYMap();
	const current: string[] = (() => { try { return JSON.parse(m.get(reportName) ?? '[]'); } catch { return []; } })();
	const next = current.filter((id) => id !== folderId);
	if (next.length === 0) {
		m.delete(reportName);
	} else {
		m.set(reportName, JSON.stringify(next));
	}
}

export function deleteReport(reportName: string) {
	getYMap().delete(reportName);
}

/** Called by deleteFolder to purge a folder ID from all reports. */
export function removeFromAllReports(folderId: string) {
	const m = getYMap();
	m.forEach((val, reportName) => {
		try {
			const ids: string[] = JSON.parse(val);
			if (ids.includes(folderId)) {
				const next = ids.filter((id) => id !== folderId);
				if (next.length === 0) m.delete(reportName);
				else m.set(reportName, JSON.stringify(next));
			}
		} catch { /* skip corrupt entry */ }
	});
}
