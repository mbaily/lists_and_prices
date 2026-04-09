/**
 * User settings persisted to localStorage.
 * Svelte 5 runes-based reactive state.
 */
import { auth } from './auth.svelte';

const SETTINGS_KEY = 'pnl_settings';

function settingsKey(): string {
	const user = typeof localStorage !== 'undefined' && auth.username ? auth.username : '_guest';
	return `${SETTINGS_KEY}:${user}`;
}

interface Settings {
	currency: string;
	theme: 'light' | 'dark';
	handedness: 'left' | 'right';
	addItemPosition: 'bottom' | 'top';
	addListPosition: 'bottom' | 'top';
}

function loadSettings(): Settings {
	if (typeof localStorage === 'undefined') return { currency: '$', theme: 'light', handedness: 'right', addItemPosition: 'bottom', addListPosition: 'bottom' };
	try {
		const saved = JSON.parse(localStorage.getItem(settingsKey()) ?? 'null');
			if (saved) return { currency: '$', theme: 'light' as const, handedness: 'right' as const, addItemPosition: 'bottom' as const, addListPosition: 'bottom' as const, ...saved };
	} catch { /* fall through */ }
	// No saved settings — detect OS preference rather than hardcoding light
	const prefersDark =
		typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
	return { currency: '$', theme: prefersDark ? 'dark' : 'light', handedness: 'right', addItemPosition: 'bottom', addListPosition: 'bottom' };
}

function saveSettings(s: Settings) {
	if (typeof localStorage !== 'undefined') {
		localStorage.setItem(settingsKey(), JSON.stringify(s));
	}
}

export const settings = $state<Settings>(loadSettings());

export function updateSettings(patch: Partial<Settings>) {
	Object.assign(settings, patch);
	saveSettings({ ...settings });
	if (patch.theme) {
		document.documentElement.setAttribute('data-theme', settings.theme);
	}
}

/** Call after login so the correct user's settings are loaded and applied. */
export function reloadSettings() {
	Object.assign(settings, loadSettings());
	applyTheme();
}

export function applyTheme() {
	document.documentElement.setAttribute('data-theme', settings.theme);
}
