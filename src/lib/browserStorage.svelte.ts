export const storageState = $state<{
	checking: boolean; persistence: 'unknown' | 'persistent' | 'best-effort' | 'unsupported';
	usage: number | null; quota: number | null; error: string | null; offlineLaunch: boolean;
}>({ checking: false, persistence: 'unknown', usage: null, quota: null, error: null, offlineLaunch: false });

let checking: Promise<void> | null = null;

export function checkBrowserStorage(requestPersistence = false): Promise<void> {
	if (checking) return checking;
	storageState.checking = true;
	storageState.error = null;
	checking = (async () => {
		const storage = typeof navigator === 'undefined' ? undefined : navigator.storage;
		if (!storage?.persisted) { storageState.persistence = 'unsupported'; return; }
		try {
			let persistent = await storage.persisted();
			if (!persistent && requestPersistence && storage.persist) persistent = await storage.persist();
			storageState.persistence = persistent ? 'persistent' : 'best-effort';
		} catch { storageState.error = 'Could not check storage protection. Try again.'; }
		try {
			const estimate = await storage.estimate?.();
			storageState.usage = estimate?.usage ?? null;
			storageState.quota = estimate?.quota ?? null;
		} catch { /* Protection status is still useful without a size estimate. */ }
	})().finally(() => { storageState.checking = false; checking = null; });
	return checking;
}

export function watchBrowserStorage(): () => void {
	const workers = navigator.serviceWorker;
	let active = true;
	const refresh = async () => {
		const worker = workers?.controller;
		let ready = false;
		try {
			if (worker && typeof caches !== 'undefined') {
				const shell = await caches.match(new URL('index.html', worker.scriptURL).href, { ignoreSearch: true });
				const assets = [...document.querySelectorAll<HTMLLinkElement>('link[rel="modulepreload"], link[rel="stylesheet"]')].map(link => link.href);
				const cached = await Promise.all(assets.map(url => caches.match(url, { ignoreSearch: true })));
				ready = Boolean(shell?.ok) && cached.every(response => response?.ok);
			}
		} catch { /* A controlling worker alone does not prove offline assets exist. */ }
		if (active && workers?.controller === worker) storageState.offlineLaunch = ready;
	};
	void refresh();
	workers?.addEventListener('controllerchange', refresh);
	const visibility = () => { if (document.visibilityState === 'visible') void refresh(); };
	document.addEventListener('visibilitychange', visibility);
	void checkBrowserStorage(true);
	return () => {
		active = false;
		workers?.removeEventListener('controllerchange', refresh);
		document.removeEventListener('visibilitychange', visibility);
	};
}
