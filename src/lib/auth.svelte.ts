/**
 * Auth state — stores logged-in username client-side.
 * The actual session cookie is managed server-side (HttpOnly).
 */

const AUTH_KEY = 'pnl_user';

export const auth = $state<{ username: string | null }>({
	username: typeof localStorage !== 'undefined' ? (localStorage.getItem(AUTH_KEY) ?? null) : null
});

export async function login(
	username: string,
	password: string
): Promise<{ ok: boolean; error?: string }> {
	let res: Response;
	try {
		res = await fetch('/api/login', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ username, password })
		});
	} catch {
		return { ok: false, error: 'Network error — check your connection.' };
	}
	if (res.ok) {
		auth.username = username;
		localStorage.setItem(AUTH_KEY, username);
		return { ok: true };
	}
	const body = await res.json().catch(() => ({}));
	return { ok: false, error: body.error ?? 'Login failed' };
}

/** Only discard the working session after the server confirms revocation. */
export async function logout(): Promise<boolean> {
	try {
		const response = await fetch('/api/logout', { method: 'POST' });
		if (!response.ok && response.status !== 401) return false;
	} catch {
		// Keep the local document usable and let the user retry. Clearing only
		// local state would leave the HttpOnly server session active anyway.
		return false;
	}
	auth.username = null;
	localStorage.removeItem(AUTH_KEY);
	return true;
}

export async function checkSession(): Promise<boolean> {
	// Fast-path: if the browser knows we're offline, trust the locally cached
	// username rather than attempting a fetch that will either throw or return a
	// SW-generated error response — either of which previously wiped the session.
	if (typeof navigator !== 'undefined' && !navigator.onLine && auth.username !== null) {
		return true;
	}

	let res: Response;
	try {
		res = await fetch('/api/session');
	} catch {
		// Network failure (fetch threw) — keep existing auth state (app may be offline / PWA)
		return auth.username !== null;
	}

	// Only an explicit authentication rejection should discard offline access.
	// Gateway/server errors and malformed responses do not prove session expiry.
	if (res.status !== 401 && res.status !== 403) {
		if (res.ok) {
			try {
				const body = await res.json();
				if (typeof body.username === 'string' && body.username) {
					auth.username = body.username;
					localStorage.setItem(AUTH_KEY, body.username);
					return true;
				}
			} catch { /* Keep cached access when the response is unavailable. */ }
		}
		return auth.username !== null;
	}

	auth.username = null;
	localStorage.removeItem(AUTH_KEY);
	return false;
}
