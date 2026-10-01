import { digest } from 'lib0/hash/sha256';

export interface NearbyChecklistState { fingerprint: string; dismissed: boolean }
export const NEARBY_CHECKLIST_MEMBERSHIP_ORIGIN = Symbol('nearby-checklist-membership');

export function isNearbyChecklistState(value: unknown): value is NearbyChecklistState {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const state = value as NearbyChecklistState;
    return typeof state.fingerprint === 'string' && /^[a-f0-9]{64}$/.test(state.fingerprint) && typeof state.dismissed === 'boolean';
}

function stable(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, stable(entry)]));
    return value;
}

export function checklistFingerprint(value: unknown): string {
    return [...digest(new TextEncoder().encode(JSON.stringify(stable(value))))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Editing a cleared completed todo does not revive it; unchecking it can. */
export function isChecklistDismissed(state: NearbyChecklistState | undefined, fingerprint: string, done: boolean): boolean {
    return !!state?.dismissed && (done || state.fingerprint === fingerprint);
}
