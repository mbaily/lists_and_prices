export function getSimpleTodoSetting(): string {
	if (typeof __SIMPLE_TODO_URL__ !== 'undefined') {
		return __SIMPLE_TODO_URL__;
	}
	if (typeof process !== 'undefined' && process.env) {
		return process.env.SIMPLE_TODO_URL ?? process.env.PUBLIC_SIMPLE_TODO_URL ?? '';
	}
	return '';
}

export function resolveSimpleTodoBaseUrl(configuredUrl = getSimpleTodoSetting(), appBase = ''): string {
	const raw = (configuredUrl || '').trim();
	if (!raw) {
		return `${appBase || ''}/../simple_todo`;
	}
	return raw.replace(/\/+$/, '');
}

export function simpleTodoPageUrl(
	page: 'bills' | 'calendar',
	appBase = '',
	configuredUrl = getSimpleTodoSetting()
): string {
	const baseUrl = resolveSimpleTodoBaseUrl(configuredUrl, appBase);
	const cleanPage = page.replace(/^\/+/, '');
	return `${baseUrl}/${cleanPage}`;
}

export function simpleTodoApiUrl(
	path: string,
	appBase = '',
	options?: { configuredUrl?: string; appBase?: string; origin?: string }
): URL {
	const configured = options?.configuredUrl ?? getSimpleTodoSetting();
	const base = options?.appBase ?? appBase;
	const cleanPath = path.replace(/^\/+/, '');
	const trimmed = (configured || '').trim().replace(/\/+$/, '');
	const origin = options?.origin ?? (typeof location !== 'undefined' ? location.origin : 'http://localhost');

	if (!trimmed) {
		const baseHref = `${origin}${base || ''}/`;
		return new URL(`../simple_todo/${cleanPath}`, baseHref);
	}
	if (/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(trimmed)) {
		return new URL(`${trimmed}/${cleanPath}`);
	}
	if (trimmed.startsWith('/')) {
		return new URL(`${trimmed}/${cleanPath}`, origin);
	}
	const baseHref = `${origin}${base || ''}/`;
	return new URL(`${trimmed}/${cleanPath}`, baseHref);
}

