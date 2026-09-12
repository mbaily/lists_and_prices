import express from 'express';
import { COOKIE_NAME, SessionStore, isValidPassword, isValidUsername, readSessionCookie } from './auth.ts';

export function requireAuth(sessions: SessionStore): express.RequestHandler {
	return (req: express.Request, res: express.Response, next: express.NextFunction) => {
		const session = sessions.verify(readSessionCookie(req.headers.cookie));
		if (!session) return res.status(401).json({ error: 'Invalid session' });
		res.locals.session = session;
		next();
	};
}

/** Mount under /api; callers supply the actual TLS policy. */
export function createAuthRouter(sessions: SessionStore, secure: boolean) {
	const router = express.Router();
	const cookieOptions = { httpOnly: true, secure, sameSite: 'strict' as const, path: '/' };
	router.use((_req: express.Request, res: express.Response, next: express.NextFunction) => {
		res.set('Cache-Control', 'no-store');
		next();
	});
	router.use(express.json());

	router.post('/login', async (req: express.Request, res: express.Response) => {
		const { username, password } = req.body ?? {};
		if (!isValidUsername(username) || !isValidPassword(password)) {
			return res.status(400).json({ error: 'Invalid credentials format' });
		}
		const session = await sessions.login(username, password);
		if (!session) return res.status(401).json({ error: 'Invalid username or password' });
		// Rotate any current browser session rather than leaving a replaced cookie usable.
		sessions.revoke(readSessionCookie(req.headers.cookie));
		res.cookie(COOKIE_NAME, session.token, { ...cookieOptions, maxAge: sessions.ttlMs });
		res.json({ ok: true });
	});

	router.post('/logout', (req: express.Request, res: express.Response) => {
		sessions.revoke(readSessionCookie(req.headers.cookie));
		res.clearCookie(COOKIE_NAME, cookieOptions);
		res.json({ ok: true });
	});

	router.get('/session', requireAuth(sessions), (_req: express.Request, res: express.Response) => {
		res.json({ username: res.locals.session.username });
	});
	router.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
		// JSON parser errors can contain the submitted password in their message/body.
		// Do not pass authentication errors to Express's default response/logger.
		const status = typeof error === 'object' && error !== null && 'status' in error &&
			typeof error.status === 'number' && Number.isInteger(error.status) && error.status >= 400 && error.status < 500
			? error.status : 503;
		res.status(status).json({ error: status < 500 ? 'Invalid request' : 'Authentication unavailable' });
	});
	return router;
}
