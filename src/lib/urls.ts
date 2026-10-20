import { base } from '$app/paths';

/** Resolve from the app root, including on nested report pages. */
export function appUrl(path: `/${string}`): string {
	return `${base}${path}`;
}

export function yjsUrl(location: Pick<Location, 'protocol' | 'host'> = window.location): string {
	const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
	return `${protocol}//${location.host}${appUrl('/yjs')}`;
}
