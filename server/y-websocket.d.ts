// y-websocket 1.x does not ship declarations for its server utility entry.
// This describes the socket surface actually used by bin/utils.js.
declare module 'y-websocket/bin/utils' {
	import type { EventEmitter } from 'node:events';
	import type { IncomingMessage } from 'node:http';

	interface SyncConnection extends EventEmitter {
		binaryType: string;
		readonly readyState: number;
		send(data: Uint8Array, callback?: (error?: Error) => void): void;
		ping(): void;
		close(): void;
	}

	export function setupWSConnection(
		connection: SyncConnection,
		request: IncomingMessage,
		options?: { docName?: string; gc?: boolean }
	): void;
}