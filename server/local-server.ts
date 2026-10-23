import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import type { Doc } from 'yjs';
import type { SessionSocket } from './auth-websocket.ts';
import { attachYjsServer } from './auth-websocket.ts';
import { SessionStore } from './auth.ts';
import { createAuthRouter, requireAuth } from './auth-http.ts';
import { createOfflineSyncRouter } from './offline-sync.ts';
import { readPublicBasePath } from './deployment-config.ts';
import type { LocalStorage } from './local-storage.ts';

const require = createRequire(import.meta.url);
const Y = require('yjs') as typeof import('yjs');
const sync = require('y-protocols/sync') as typeof import('y-protocols/sync');
const awarenessProtocol = require('y-protocols/awareness') as typeof import('y-protocols/awareness');
const encoding = require('lib0/encoding') as typeof import('lib0/encoding');
const decoding = require('lib0/decoding') as typeof import('lib0/decoding');

/** The local host has its own Doc, rather than y-websocket's global server room
 * registry. Load it before accepting any browser or upstream connections. */
export function createLocalHost(options: {
	storage: LocalStorage; username: string; buildDirectory?: string;
	cert?: string; key?: string; status: () => object; onStorageError?: () => void;
}) {
	const { storage, username } = options;
	if (options.buildDirectory && readPublicBasePath(options.buildDirectory) !== '') {
		throw new Error('The local frontend must be built at /. Rebuild with APP_BASE_PATH unset.');
	}
	const doc = new Y.Doc({ gc: false });
	Y.applyUpdate(doc, storage.mergedUpdate());
	const sockets = new Map<SessionSocket, Set<number>>();
	let storageFailed = false;
	// Register persistence before network observers, so an update is durable
	// before another browser receives it or the HTTP API acknowledges it.
	doc.on('update', (update: Uint8Array) => {
		try {
			if (storageFailed) throw new Error('Local storage is unavailable.');
			storage.append(update);
		} catch {
			storageFailed = true;
			for (const socket of sockets.keys()) socket.close();
			options.onStorageError?.();
			throw new Error('Local storage failed; synchronization stopped.');
		}
	});
	const checkStorage = () => { if (storageFailed) throw new Error('Local storage is unavailable.'); };
	let secret = storage.get('sessionSecret');
	if (!secret) { secret = randomBytes(32).toString('hex'); storage.set('sessionSecret', secret); }
	const sessions = new SessionStore(storage.db, {
		secret, readPasswordHash: user => user === username ? storage.get('passwordHash') : undefined
	});
	const app = express();
	app.use('/api/sync', (_req, res, next) => { res.set('X-Lists-Sync-Target', 'laptop'); next(); });
	app.use('/api/sync', createOfflineSyncRouter(sessions, {
		async use<T>(user: string, operation: (document: Doc) => T) {
			if (user !== username) throw new Error('Account mismatch.');
			checkStorage();
			const result = operation(doc);
			checkStorage();
			return result;
		}
	}));
	app.get('/api/local/status', requireAuth(sessions), (_req, res) => {
		res.set('Cache-Control', 'no-store').json(options.status());
	});
	app.use('/api', createAuthRouter(sessions, Boolean(options.cert)));
	app.use('/api', (_req, res) => { res.status(404).json({ error: 'Not found' }); });
	if (options.buildDirectory) {
		app.use(express.static(options.buildDirectory, { redirect: false }));
		app.get('/{*path}', (req, res) => {
			if (/\.[a-zA-Z0-9]+$/.test(req.path)) return res.sendStatus(404);
			res.sendFile(path.join(options.buildDirectory!, 'index.html'));
		});
	}
	const server = options.cert && options.key
		? https.createServer({ cert: readFileSync(options.cert), key: readFileSync(options.key) }, app)
		: http.createServer(app);
	const awareness = new awarenessProtocol.Awareness(doc);
	awareness.setLocalState(null);
	const broadcast = (bytes: Uint8Array) => {
		if (storageFailed) return;
		for (const socket of sockets.keys()) socket.send(bytes, error => { if (error) socket.close(); });
	};
	const sendAwareness = (ids: number[]) => {
		const encoder = encoding.createEncoder();
		encoding.writeVarUint(encoder, 1);
		encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(awareness, ids));
		return encoding.toUint8Array(encoder);
	};
	awareness.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: SessionSocket | null) => {
		const controlled = origin && sockets.get(origin);
		if (controlled) { for (const id of added) controlled.add(id); for (const id of removed) controlled.delete(id); }
		broadcast(sendAwareness([...added, ...updated, ...removed]));
	});
	doc.on('update', (update: Uint8Array) => {
		const encoder = encoding.createEncoder();
		encoding.writeVarUint(encoder, 0); sync.writeUpdate(encoder, update);
		broadcast(encoding.toUint8Array(encoder));
	});
	const wss = attachYjsServer(server, sessions, socket => {
		checkStorage();
		sockets.set(socket, new Set());
		socket.binaryType = 'arraybuffer';
		const send = (bytes: Uint8Array) => socket.send(bytes, error => { if (error) socket.close(); });
		socket.on('message', (message: ArrayBuffer) => {
			try {
				checkStorage();
				const decoder = decoding.createDecoder(new Uint8Array(message));
				const type = decoding.readVarUint(decoder);
				if (type === 0) {
					const encoder = encoding.createEncoder(); encoding.writeVarUint(encoder, 0);
					sync.readSyncMessage(decoder, encoder, doc, socket, error => { throw error; });
					if (encoding.length(encoder) > 1) send(encoding.toUint8Array(encoder));
				} else if (type === 1) {
					awarenessProtocol.applyAwarenessUpdate(awareness, decoding.readVarUint8Array(decoder), socket);
				} else if (type === 3) send(sendAwareness([...awareness.getStates().keys()]));
			} catch { socket.close(); }
		});
		let alive = true;
		const heartbeat = setInterval(() => { if (!alive) socket.close(); else { alive = false; socket.ping(); } }, 30_000);
		heartbeat.unref();
		socket.on('pong', () => { alive = true; });
		socket.once('close', () => {
			clearInterval(heartbeat);
			const controlled = sockets.get(socket); sockets.delete(socket);
			if (controlled) awarenessProtocol.removeAwarenessStates(awareness, [...controlled], null);
		});
		const encoder = encoding.createEncoder(); encoding.writeVarUint(encoder, 0); sync.writeSyncStep1(encoder, doc);
		send(encoding.toUint8Array(encoder));
		if (awareness.getStates().size) send(sendAwareness([...awareness.getStates().keys()]));
	});
	return {
		doc, server,
		async close() {
			for (const socket of sockets.keys()) socket.close();
			await new Promise<void>(resolve => wss.close(() => resolve()));
			if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
			awareness.destroy(); doc.destroy();
		}
	};
}
