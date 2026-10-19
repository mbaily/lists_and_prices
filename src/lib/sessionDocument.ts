import { auth } from './auth.svelte';
import { initYjs, destroyYjs, reconnectYjs, getDocumentUsername } from './yjsStore.svelte';
import { reloadSettings } from './settings.svelte';

/** Reconcile an optimistically loaded document with the verified session. */
export function reconcileSessionDocument(_loadedUsername: string | null, ok: boolean, wsUrl: string): boolean {
	if (!ok || !auth.username) {
		destroyYjs();
		return false;
	}
	// Sign-in may already have initialized a document while verification waited.
	if (auth.username !== getDocumentUsername()) {
		reloadSettings();
		initYjs(auth.username, wsUrl);
	}
	if (auth.needsLogin) reconnectYjs();
	return true;
}
