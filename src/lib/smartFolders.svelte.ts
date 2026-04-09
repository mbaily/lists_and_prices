/**
 * Smart folder (report) configuration — persisted to localStorage per user.
 * Maps report name → array of folder IDs included in that report.
 */
import { auth } from './auth.svelte';

const SF_KEY = 'pnl_smart_folders';

function sfKey(): string {
	const user = typeof localStorage !== 'undefined' && auth.username ? auth.username : '_guest';
	return `${SF_KEY}:${user}`;
}

type SmartFolderMap = Record<string, string[]>;

function load(): SmartFolderMap {
	if (typeof localStorage === 'undefined') return {};
	try { return JSON.parse(localStorage.getItem(sfKey()) ?? '{}'); } catch { return {}; }
}

function save(map: SmartFolderMap) {
	if (typeof localStorage !== 'undefined')
		localStorage.setItem(sfKey(), JSON.stringify(map));
}

export const smartFolders = $state<SmartFolderMap>(load());

export function assignToReport(folderId: string, reportName: string) {
	if (!smartFolders[reportName]) smartFolders[reportName] = [];
	if (!smartFolders[reportName].includes(folderId)) {
		smartFolders[reportName] = [...smartFolders[reportName], folderId];
	}
	save({ ...smartFolders });
}

export function removeFromReport(folderId: string, reportName: string) {
	if (!smartFolders[reportName]) return;
	smartFolders[reportName] = smartFolders[reportName].filter((id) => id !== folderId);
	if (smartFolders[reportName].length === 0) {
		delete smartFolders[reportName];
	}
	save({ ...smartFolders });
}

export function deleteReport(reportName: string) {
	delete smartFolders[reportName];
	save({ ...smartFolders });
}

/** Reload after login/user switch so the correct user's config is loaded. */
export function reloadSmartFolders() {
	const fresh = load();
	for (const key of Object.keys(smartFolders)) delete smartFolders[key];
	Object.assign(smartFolders, fresh);
}
