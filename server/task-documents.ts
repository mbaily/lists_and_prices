/// <reference path="./y-websocket.d.ts" />
import { createRequire } from 'node:module';
import type * as Yjs from 'yjs';
import { docs, getYDoc, getPersistence, setPersistence } from 'y-websocket/bin/utils';

// y-websocket's server uses CJS Yjs. Use that same instance for server updates.
const Y = createRequire(import.meta.url)('yjs') as typeof Yjs;

export interface TaskDocuments {
	use<T>(username: string, operation: (doc: Yjs.Doc) => T, write?: boolean): Promise<T>;
}

/** Share live WS documents, await cold loads, and acknowledge persisted writes. */
export function createTaskDocuments(): TaskDocuments {
	const persistence = getPersistence();
	const ready = new WeakMap<Yjs.Doc, Promise<void>>();
	if (persistence) {
		setPersistence({
			...persistence,
			bindState(name, doc) {
				const loaded = Promise.resolve().then(() => persistence.bindState(name, doc));
				ready.set(doc, loaded);
				// WS setup doesn't await bindState. The API still receives load failures.
				loaded.catch(() => {});
				return loaded;
			}
		});
	}
	return {
		async use(username, operation, write = false) {
			if (!persistence?.provider) throw new Error('Task persistence is unavailable');
			const name = `yjs/pnl-${username}`;
			const doc = getYDoc(name, false);
			// Prevent the last browser disconnect from destroying an active API doc.
			const lease = { readyState: 1, send() {} };
			doc.conns.set(lease, new Set());
			try {
				await ready.get(doc);
				const result = operation(doc);
				if (write) await persistence.provider.storeUpdate(name, Y.encodeStateAsUpdate(doc));
				return result;
			} finally {
				doc.conns.delete(lease);
				if (!doc.conns.size && docs.get(name) === doc) {
					docs.delete(name);
					doc.destroy();
				}
			}
		}
	};
}
