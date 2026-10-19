import { createRequire } from 'node:module';
import express from 'express';
import type * as Yjs from 'yjs';
import { requireAuth } from './auth-http.ts';
import { readSessionCookie, type SessionStore } from './auth.ts';
import type { TaskDocuments } from './task-documents.ts';
import { decodeSyncMessage, encodeSyncMessage } from '../src/lib/syncProtocol.ts';

const Y = createRequire(import.meta.url)('yjs') as typeof Yjs;
class SessionChanged extends Error {}

/** A state-vector exchange followed by a persisted update acknowledgement.
 * The account is checked before any upload can touch a live document. */
export function createOfflineSyncRouter(sessions: SessionStore, documents: TaskDocuments) {
	const router = express.Router();
	router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
	router.use(requireAuth(sessions));
	router.use(express.raw({ type: 'application/octet-stream', limit: '64mb' }));
	router.post(['/', '/state'], async (req, res) => {
		let message: ReturnType<typeof decodeSyncMessage>;
		try {
			if (!Buffer.isBuffer(req.body)) throw new Error('Expected binary sync data');
			message = decodeSyncMessage(req.body);
			Y.decodeStateVector(message.vector);
			if (message.update.length) Y.decodeUpdate(message.update);
		} catch { return res.status(400).json({ error: 'Invalid sync data' }); }
		const username = res.locals.session.username as string;
		if (message.username !== username) return res.status(409).json({ error: 'Sign in with the account used by this local document.' });
		const write = req.path !== '/state';
		if (!write && message.update.length) return res.status(400).json({ error: 'Unexpected upload' });
		const result = await documents.use(username, doc => {
			// Credentials may have expired or been revoked during a cold disk load.
			if (sessions.verify(readSessionCookie(req.headers.cookie))?.username !== username) throw new SessionChanged();
			if (write && message.update.length) Y.applyUpdate(doc, message.update, 'offline-sync');
			return encodeSyncMessage(username, Y.encodeStateVector(doc), Y.encodeStateAsUpdate(doc, message.vector));
		}, write);
		if (sessions.verify(readSessionCookie(req.headers.cookie))?.username !== username) return res.status(401).json({ error: 'Sign in again to sync.' });
		res.type('application/octet-stream').send(Buffer.from(result));
	});
	router.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
		const status = error instanceof SessionChanged ? 401 : typeof error === 'object' && error !== null && 'status' in error && error.status === 413 ? 413 : 503;
		res.status(status).json({ error: status === 413 ? 'Sync data exceeds the upload limit.' : 'Sync unavailable. Your local changes are kept.' });
	});
	return router;
}
