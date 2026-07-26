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

export async function logout() {
	try {
		await fetch('/api/logout', { method: 'POST' });
	} catch {
		// Genuine network failure (fetch threw) — if we appear to be online,
		// don't force-logout (the session is probably still valid on the server).
		if (typeof navigator !== 'undefined' && navigator.onLine) return;
	}
	// Always clear local state after a deliberate logout attempt,
	// even if the server returned a non-OK status.
	auth.username = null;
	localStorage.removeItem(AUTH_KEY);
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

	if (res.ok) {
		const body = await res.json();
		if (typeof body.username === 'string' && body.username) {
			auth.username = body.username;
			localStorage.setItem(AUTH_KEY, body.username);
			return true;
		}
	}

	// Non-ok response while we believe we're online — treat as genuine auth failure.
	// But if we have no network indicator and a saved username, keep the user logged in.
	if (auth.username !== null && typeof navigator !== 'undefined' && !navigator.onLine) {
		return true;
	}

	auth.username = null;
	localStorage.removeItem(AUTH_KEY);
	return false;
}
