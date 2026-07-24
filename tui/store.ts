import * as Y from 'yjs';
import pkg from 'y-websocket';
const { WebsocketProvider } = pkg;
import WebSocket from 'ws';

export let doc: Y.Doc | null = null;
export let wsProvider: WebsocketProvider | null = null;

export function initYjs(username: string, wsUrl: string, cookieStr: string, insecure: boolean, onUpdate: () => void) {
	if (doc) destroyYjs();

	doc = new Y.Doc();

	class CookieWebSocket extends WebSocket {
		constructor(url: string | URL) {
			super(url, { headers: { Cookie: cookieStr }, rejectUnauthorized: !insecure });
		}
	}

	wsProvider = new WebsocketProvider(wsUrl, `pnl-${username}`, doc, {
		connect: true,
		WebSocketPolyfill: CookieWebSocket
	});

	doc.on('update', () => {
		onUpdate();
	});

	wsProvider.on('status', ({ status }: { status: string }) => {
		console.log("WS Status:", status);
	});

	return doc;
}

export function destroyYjs() {
	wsProvider?.destroy();
	doc?.destroy();
	doc = null;
	wsProvider = null;
}

export function getFolders(d: Y.Doc): Y.Array<Y.Map<unknown>> {
	return d.getArray('folders');
}

export function getLists(d: Y.Doc): Y.Array<Y.Map<unknown>> {
	return d.getArray('lists');
}

export function getItems(d: Y.Doc): Y.Array<Y.Map<unknown>> {
	return d.getArray('items');
}
