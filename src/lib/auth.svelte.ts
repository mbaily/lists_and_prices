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
	const res = await fetch('/api/login', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ username, password })
	});
	if (res.ok) {
		auth.username = username;
		localStorage.setItem(AUTH_KEY, username);
		return { ok: true };
	}
	const body = await res.json().catch(() => ({}));
	return { ok: false, error: body.error ?? 'Login failed' };
}

export async function logout() {
	await fetch('/api/logout', { method: 'POST' });
	auth.username = null;
	localStorage.removeItem(AUTH_KEY);
}

export async function checkSession(): Promise<boolean> {
	const res = await fetch('/api/session');
	if (res.ok) {
		const body = await res.json();
		auth.username = body.username;
		localStorage.setItem(AUTH_KEY, body.username);
		return true;
	}
	auth.username = null;
	localStorage.removeItem(AUTH_KEY);
	return false;
}
