import { EventEmitter } from 'node:events';
import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Server as HttpsServer } from 'node:https';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import { SessionStore, isValidUsername, readSessionCookie, type Session } from './auth.ts';

export const SESSION_RECHECK_MS = 30_000;
const MAX_TIMER_MS = 2_147_483_647;

export function authorizedDocName(url: string | undefined, username: string): string | null {
	if (!url || !isValidUsername(username) || /[\u0000-\u0020\u007f#\\]/.test(url)) return null;
	const docName = `yjs/pnl-${username}`;
	// Compare the raw path, not a URL-normalized/decoded alias. Queries are not room identity.
	// y-websocket's historical default is req.url.slice(1).split('?')[0], including "yjs/".
	return url.split('?', 1)[0] === `/${docName}` ? docName : null;
}

export function authorizeYjsUpgrade(sessions: SessionStore, req: Pick<IncomingMessage, 'url' | 'headers'>) {
	const session = sessions.verify(readSessionCookie(req.headers.cookie));
	if (!session) return { ok: false, status: 401 } as const;
	const docName = authorizedDocName(req.url, session.username);
	if (!docName) return { ok: false, status: 403 } as const;
	return { ok: true, session, docName } as const;
}

/** The small part of ws used by y-websocket, also implementable by an in-memory test socket. */
export interface WebSocketLike extends EventEmitter {
	binaryType: string;
	readonly readyState: number;
	send(data: Uint8Array, callback?: (error?: Error) => void): void;
	ping(): void;
	terminate(): void;
}

/**
 * Gate both inbound frames and outbound broadcasts before they reach Yjs/the network.
 * A prependListener guard is insufficient: later listeners still receive a rejected frame.
 */
export class SessionSocket extends EventEmitter {
	private ended = false;
	private expiryTimer: ReturnType<typeof setTimeout> | undefined;
	private readonly recheckTimer: ReturnType<typeof setInterval>;
	private readonly unsubscribe: () => void;

	constructor(private readonly socket: WebSocketLike, private readonly sessions: SessionStore, private readonly session: Session) {
		super();
		this.unsubscribe = sessions.onRevoked((idHash) => {
			if (idHash === session.idHash) this.close();
		});
		// Also detect CLI/other-process revocations and out-of-band .htpasswd edits on idle sockets.
		this.recheckTimer = setInterval(() => { this.isAuthorized(); }, SESSION_RECHECK_MS);
		this.recheckTimer.unref();
		this.scheduleExpiry();
		socket.on('message', (...args: unknown[]) => {
			if (this.isAuthorized()) this.emit('message', ...args);
		});
		socket.on('pong', () => { if (!this.ended) this.emit('pong'); });
		socket.once('close', () => this.close());
		socket.once('error', () => this.close());
	}

	get readyState(): number { return this.ended ? 3 : this.socket.readyState; }
	get binaryType(): string { return this.socket.binaryType; }
	set binaryType(value: string) { this.socket.binaryType = value; }

	isAuthorized(): boolean {
		if (this.ended) return false;
		try {
			const current = this.sessions.validateId(this.session.idHash);
			if (current && current.username === this.session.username && current.expiresAt === this.session.expiresAt) return true;
		} catch {
			// Database/credential failures must never leave a socket authorised.
		}
		this.close();
		return false;
	}

	private scheduleExpiry(): void {
		// The default 30-day TTL exceeds Node's maximum timeout; split long waits safely.
		const delay = Math.max(1, Math.min(MAX_TIMER_MS, this.session.expiresAt - this.sessions.now()));
		this.expiryTimer = setTimeout(() => {
			if (this.isAuthorized()) this.scheduleExpiry();
		}, delay);
		this.expiryTimer.unref();
	}

	send(data: Uint8Array, callback?: (error?: Error) => void): void {
		if (this.isAuthorized()) this.socket.send(data, callback);
		else callback?.(new Error('Invalid session'));
	}

	ping(): void {
		if (this.isAuthorized()) this.socket.ping();
	}

	close(): void {
		if (this.ended) return;
		this.ended = true;
		clearTimeout(this.expiryTimer);
		clearInterval(this.recheckTimer);
		this.unsubscribe();
		try {
			// Detach from Yjs immediately, rather than waiting for a peer's close handshake.
			this.emit('close');
		} finally {
			this.socket.terminate();
		}
	}
}

type SetupConnection = (socket: SessionSocket, req: IncomingMessage, options: { docName: string; gc: false }) => void;

/** Attach to a supplied server, without listening or accessing any real application files. */
export function attachYjsServer(server: HttpServer | HttpsServer, sessions: SessionStore, setupConnection: SetupConnection) {
	const wss = new WebSocketServer({ noServer: true });
	const upgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
		const reject = (status: number, reason: string) => {
			socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`, () => socket.destroy());
		};
		let auth: ReturnType<typeof authorizeYjsUpgrade>;
		try {
			auth = authorizeYjsUpgrade(sessions, req);
		} catch {
			reject(503, 'Service Unavailable');
			return;
		}
		if (!auth.ok) {
			reject(auth.status, auth.status === 401 ? 'Unauthorised' : 'Forbidden');
			return;
		}
		wss.handleUpgrade(req, socket, head, (ws: WebSocketLike) => {
			const connection = new SessionSocket(ws, sessions, auth.session);
			// Recheck after the handshake, before setup can send any document contents.
			if (!connection.isAuthorized()) return;
			try {
				setupConnection(connection, req, { docName: auth.docName, gc: false });
				wss.emit('connection', ws, req);
			} catch {
				connection.close();
			}
		});
	};
	server.on('upgrade', upgrade);
	wss.once('close', () => server.off('upgrade', upgrade));
	return wss;
}
