// y-websocket 1.x does not ship declarations for its server utility entry.
// This describes the socket surface actually used by bin/utils.js.
declare module 'y-websocket/bin/utils' {
	import type { EventEmitter } from 'node:events';
	import type { IncomingMessage } from 'node:http';
	import type { Doc } from 'yjs';

	export interface SharedDoc extends Doc {
		conns: Map<{ readonly readyState: number; send(data: Uint8Array, callback?: (error?: Error) => void): void }, Set<number>>;
	}
	export interface Persistence {
		bindState(name: string, doc: SharedDoc): void | Promise<void>;
		writeState(name: string, doc: SharedDoc): Promise<void>;
		provider: { storeUpdate(name: string, update: Uint8Array): Promise<unknown> };
	}
	export const docs: Map<string, SharedDoc>;
	export function getYDoc(name: string, gc?: boolean): SharedDoc;
	export function getPersistence(): Persistence | null;
	export function setPersistence(persistence: Persistence | null): void;

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
