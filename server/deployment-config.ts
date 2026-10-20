import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** Old builds have no metadata and continue to use the hostname root. */
export function readPublicBasePath(buildDirectory: string): string {
	const file = path.join(buildDirectory, 'deployment.json');
	if (!existsSync(file)) return '';
	const { basePath } = JSON.parse(readFileSync(file, 'utf8'));
	if (typeof basePath !== 'string' || (basePath !== '' && !/^(?:\/[A-Za-z0-9_~-]+)+$/.test(basePath))) {
		throw new Error('Invalid public base path in build/deployment.json; rebuild the frontend.');
	}
	return basePath;
}

export function tlsEnabled(value: string | undefined, hasCertificate: boolean): boolean {
	if (value === undefined || value === 'auto') return hasCertificate;
	if (value === 'off') return false;
	throw new Error('LISTS_TLS must be auto or off.');
}

/** Forwarded headers cannot change the session policy. HTTPS proxies opt in explicitly. */
export function secureCookies(value: string | undefined, useTls: boolean): boolean {
	if (value === undefined) return useTls;
	if (value === 'true') return true;
	if (value === 'false') return false;
	throw new Error('SESSION_COOKIE_SECURE must be true or false.');
}
