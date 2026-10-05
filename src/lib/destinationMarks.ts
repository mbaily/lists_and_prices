import { auth } from './auth.svelte';

export const DEFAULT_MARK_NAME = 'default';
const STORAGE_KEY = 'pnl_destination_marks';

/** A stable reference, independent of Yjs and open to other entity kinds. */
export interface MarkedEntity {
	kind: string;
	id: string;
}

function storageKey(): string {
	return `${STORAGE_KEY}:${auth.username ?? '_guest'}`;
}

function isMarkedEntity(value: unknown): value is MarkedEntity {
	return typeof value === 'object' && value !== null &&
		'kind' in value && typeof value.kind === 'string' && value.kind.trim().length > 0 &&
		'id' in value && typeof value.id === 'string' && value.id.trim().length > 0;
}

export function readDestinationMarks(): Record<string, MarkedEntity> {
	if (typeof localStorage === 'undefined') return {};
	try {
		const saved: unknown = JSON.parse(localStorage.getItem(storageKey()) ?? 'null');
		if (typeof saved !== 'object' || saved === null || Array.isArray(saved)) return {};
		return Object.fromEntries(Object.entries(saved).flatMap(([name, entity]) =>
			name.trim() && isMarkedEntity(entity)
				? [[name, { kind: entity.kind, id: entity.id }]]
				: []
		));
	} catch {
		return {};
	}
}

export function getDestinationMark(name = DEFAULT_MARK_NAME): MarkedEntity | null {
	const marks = readDestinationMarks();
	const key = name.trim();
	return Object.hasOwn(marks, key) ? marks[key] : null;
}

export function setDestinationMark(name: string, entity: MarkedEntity): void {
	const key = name.trim();
	if (!key) throw new Error('Enter a name for the mark.');
	if (!isMarkedEntity(entity)) throw new Error('Invalid mark destination.');
	if (typeof localStorage === 'undefined') throw new Error('Local storage is unavailable.');
	const marks = { ...readDestinationMarks(), [key]: { kind: entity.kind, id: entity.id } };
	localStorage.setItem(storageKey(), JSON.stringify(marks));
}
