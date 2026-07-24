import { useSyncExternalStore, useMemo } from 'react';
import * as Y from 'yjs';
import { useTui } from './context.js';
import { getLists, getItems } from './store.js';

function subscribe(yDoc: Y.Doc | null, callback: () => void) {
	if (!yDoc) return () => {};
	yDoc.on('update', callback);
	return () => yDoc.off('update', callback);
}

// A generic hook that triggers a re-render whenever the yDoc updates.
export function useYjsUpdate() {
	const { yDoc } = useTui();
	
	// We need a changing value to return so useSyncExternalStore triggers update
	// We'll return a simple counter.
	let version = 0;
	
	const getSnapshot = () => version;
	
	const sub = useMemo(() => {
		return (cb: () => void) => {
			if (!yDoc) return () => {};
			const handler = () => {
				version++;
				cb();
			};
			yDoc.on('update', handler);
			return () => yDoc.off('update', handler);
		};
	}, [yDoc]);

	useSyncExternalStore(sub, getSnapshot, getSnapshot);
}

export function useFolders() {
	const { yDoc } = useTui();
	useYjsUpdate();
	if (!yDoc) return [];
	return yDoc.getArray<Y.Map<any>>('folders').toArray();
}

export function useLists() {
	const { yDoc } = useTui();
	useYjsUpdate();
	if (!yDoc) return [];
	return getLists(yDoc).toArray();
}

export function useItems(listId?: string) {
	const { yDoc } = useTui();
	useYjsUpdate();
	if (!yDoc) return [];
	const allItems = getItems(yDoc).toArray();
	if (listId) {
		return allItems.filter((item: any) => item.get('listId') === listId);
	}
	return allItems;
}
