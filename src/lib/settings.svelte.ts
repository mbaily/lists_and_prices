/**
 * User settings persisted to localStorage.
 * Svelte 5 runes-based reactive state.
 */

const SETTINGS_KEY = 'pnl_settings';

interface Settings {
	currency: string;
	theme: 'light' | 'dark';
	handedness: 'left' | 'right';
}

function loadSettings(): Settings {
	if (typeof localStorage === 'undefined') return { currency: '$', theme: 'light', handedness: 'right' };
	try {
		const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null');
			if (saved) return { currency: '$', theme: 'light' as const, handedness: 'right' as const, ...saved };
	} catch { /* fall through */ }
	// No saved settings — detect OS preference rather than hardcoding light
	const prefersDark =
		typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
	return { currency: '$', theme: prefersDark ? 'dark' : 'light', handedness: 'right' };
}

function saveSettings(s: Settings) {
	if (typeof localStorage !== 'undefined') {
		localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
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

export function applyTheme() {
	document.documentElement.setAttribute('data-theme', settings.theme);
}
