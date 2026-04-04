/**
 * User settings persisted to localStorage.
 * Svelte 5 runes-based reactive state.
 */

const SETTINGS_KEY = 'pnl_settings';

interface Settings {
	currency: string;
	theme: 'light' | 'dark';
}

function loadSettings(): Settings {
	if (typeof localStorage === 'undefined') return { currency: '$', theme: 'light' };
	try {
		return JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null') ?? {
			currency: '$',
			theme: 'light'
		};
	} catch {
		return { currency: '$', theme: 'light' };
	}
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
