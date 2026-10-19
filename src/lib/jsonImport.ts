import { isFolderDefaultItems } from './folderDefaultItems';
import type { RichTextOperation } from './noteText';

export const MAX_BACKUP_BYTES = 100 * 1024 * 1024;
type RecordKind = 'folders' | 'lists' | 'items' | 'sheets';
const common = ['id', 'name', 'order', 'createdAt', 'updatedAt'];
const archivable = ['color', 'favouriteOrder', 'done', 'favourite', 'archived', 'archivedPrevId', 'archivedNextId', 'filterView'];
const fields: Record<RecordKind, Set<string>> = {
	folders: new Set([...common, ...archivable, 'parentId', 'foldersFirst', 'localNav', 'checkboxes', 'defaultItems']),
	lists: new Set([...common, ...archivable, 'folderId', 'type', 'defaultIsNote', 'journalMode']),
	items: new Set([...common, 'listId', 'price', 'qty', 'checked', 'checks', 'checkedNames', 'heading', 'parentId', 'note', 'pinned', 'fullScreen', 'richText']),
	sheets: new Set([...common, 'folderId', 'cells'])
};
const booleanFields = ['done', 'favourite', 'archived', 'foldersFirst', 'localNav', 'defaultIsNote', 'journalMode', 'checked', 'heading', 'note', 'pinned', 'fullScreen'];
const unsafeKeys = new Set(['__proto__', 'constructor', 'prototype']);

export function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isJsonValue(value: unknown, depth = 0): boolean {
	if (depth > 32) return false;
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
	if (typeof value === 'number') return Number.isFinite(value);
	if (Array.isArray(value)) return value.every(entry => isJsonValue(entry, depth + 1));
	return isRecord(value) && Object.entries(value).every(([key, entry]) => !unsafeKeys.has(key) && isJsonValue(entry, depth + 1));
}

export function validateRichText(value: unknown, name: string): asserts value is RichTextOperation[] {
	if (!Array.isArray(value)) throw new Error('Invalid rich-text content.');
	let plain = '';
	for (const op of value) {
		if (!isRecord(op) || !Object.hasOwn(op, 'insert') || Object.keys(op).some(key => key !== 'insert' && key !== 'attributes') ||
			!(typeof op.insert === 'string' || (isRecord(op.insert) && Object.keys(op.insert).length === 1 && isJsonValue(op.insert)))) {
			throw new Error('Invalid rich-text operation: only inserted text or embeds are allowed.');
		}
		if (op.attributes !== undefined && (!isRecord(op.attributes) || Object.entries(op.attributes).some(([key, attribute]) =>
			unsafeKeys.has(key) || !(attribute === null || ['string', 'boolean'].includes(typeof attribute) || (typeof attribute === 'number' && Number.isFinite(attribute)))))) {
			throw new Error('Invalid rich-text formatting.');
		}
		if (typeof op.insert === 'string') plain += op.insert;
	}
	if (plain.replace(/\n$/, '') !== name) throw new Error('Rich-text content does not match the item name.');
}

/** Yjs transactions do not roll back exceptions. Reject malformed input and
 * internal storage fields before entering any mutation transaction. */
export function validateRecords(records: unknown, kind: RecordKind): asserts records is Record<string, unknown>[] {
	if (!Array.isArray(records)) throw new Error(`Invalid ${kind} in import.`);
	const ids = new Set<string>();
	for (const record of records) {
		if (!isRecord(record) || typeof record.id !== 'string' || !record.id.trim() || typeof record.name !== 'string' || ids.has(record.id)) throw new Error(`Invalid or duplicate ${kind} record.`);
		ids.add(record.id);
		for (const key of Object.keys(record)) if (!fields[kind].has(key)) throw new Error(`Unrecognized ${kind} field: ${key}. This backup may require a newer app.`);
		for (const key of ['parentId', 'folderId', 'archivedPrevId', 'archivedNextId']) {
			if (record[key] != null && (typeof record[key] !== 'string' || !record[key].trim())) throw new Error(`Invalid ${key}.`);
		}
		if (record.listId !== undefined && (typeof record.listId !== 'string' || !record.listId.trim())) throw new Error('Invalid listId.');
		for (const key of booleanFields) if (record[key] !== undefined && typeof record[key] !== 'boolean') throw new Error(`Invalid ${key}: expected a boolean.`);
		for (const key of ['price', 'qty', 'order', 'favouriteOrder']) {
			if (record[key] != null && (typeof record[key] !== 'number' || !Number.isFinite(record[key]))) throw new Error(`Invalid ${key}.`);
		}
		for (const key of ['createdAt', 'updatedAt']) if (record[key] != null && (typeof record[key] !== 'string' || !Number.isFinite(Date.parse(record[key])))) throw new Error(`Invalid ${key}.`);
		if (record.color !== undefined && typeof record.color !== 'string') throw new Error('Invalid color.');
		if (record.type !== undefined && !['plain', 'priced', 'divider'].includes(record.type as string)) throw new Error('Invalid list type.');
		if (record.filterView !== undefined && !['all', 'unchecked', 'checked'].includes(record.filterView as string)) throw new Error('Invalid filter view.');
		if (record.checks !== undefined && (!isRecord(record.checks) || Object.entries(record.checks).some(([id, state]) => !id.trim() || typeof state !== 'boolean'))) throw new Error('Invalid checkbox states.');
		if (record.checkboxes !== undefined) {
			const boxes = record.checkboxes;
			if (!Array.isArray(boxes) || boxes.length > 8 || boxes.some(box => !isRecord(box) || typeof box.id !== 'string' || !box.id.trim() || typeof box.name !== 'string' || !box.name.trim()) ||
				new Set(boxes.map(box => box.id)).size !== boxes.length || new Set(boxes.map(box => box.name.trim().toLowerCase())).size !== boxes.length) throw new Error('Invalid checkbox definitions.');
		}
		if (kind === 'folders' && record.defaultItems !== undefined && !isFolderDefaultItems(record.defaultItems)) throw new Error('Invalid default items.');
		if (record.checkedNames !== undefined && (!Array.isArray(record.checkedNames) || record.checkedNames.some(name => typeof name !== 'string'))) throw new Error('Invalid checkbox names.');
		if (record.richText !== undefined) validateRichText(record.richText, record.name);
		if (record.cells !== undefined && (!isRecord(record.cells) || Object.entries(record.cells).some(([key, value]) => !/^(0|[1-9]\d*),(0|[1-9]\d*)$/.test(key) || key.split(',').some(part => !Number.isSafeInteger(Number(part))) || typeof value !== 'string'))) throw new Error('Invalid spreadsheet cells.');
	}
	if (kind === 'items' || kind === 'folders') orderParentFirst(records.map(record => ({ id: record.id as string, parentId: record.parentId as string | null | undefined })));
}

/** Accept arbitrary file order without flattening children whose parent appears
 * later. Missing parents are handled by the app's existing orphan recovery. */
export function orderParentFirst<T extends { id: string; parentId?: string | null }>(records: readonly T[]): T[] {
	const byId = new Map(records.map(record => [record.id, record]));
	const done = new Set<string>(), result: T[] = [];
	for (const record of records) {
		const chain: T[] = [], visiting = new Set<string>();
		let current: T | undefined = record;
		while (current && !done.has(current.id)) {
			if (visiting.has(current.id)) throw new Error('Invalid parent hierarchy: cycle detected.');
			visiting.add(current.id);
			chain.push(current);
			current = current.parentId ? byId.get(current.parentId) : undefined;
		}
		for (const entry of chain.reverse()) { done.add(entry.id); result.push(entry); }
	}
	return result;
}
