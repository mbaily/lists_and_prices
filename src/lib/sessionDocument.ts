import { auth } from './auth.svelte';
import { initYjs, destroyYjs } from './yjsStore.svelte';
import { reloadSettings } from './settings.svelte';

/** Reconcile an optimistically loaded document with the verified session. */
export function reconcileSessionDocument(loadedUsername: string | null, ok: boolean, wsUrl: string): boolean {
	if (!ok || !auth.username) {
		destroyYjs();
		return false;
	}
	if (auth.username !== loadedUsername) {
		reloadSettings();
		initYjs(auth.username, wsUrl);
	}
	return true;
}
