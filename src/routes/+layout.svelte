<script lang="ts">
	import { onMount } from 'svelte';
	import { registerSW } from 'virtual:pwa-register';
	import { applyTheme, applyItemSpacing } from '$lib/settings.svelte';
	import { watchBrowserStorage } from '$lib/browserStorage.svelte';
	import { installDataRefresh } from '$lib/dataRefresh';
	import { getDocumentUsername, idbSynced, reconnectYjs, refreshSyncPreference, saveLocalData, syncNow } from '$lib/yjsStore.svelte';
	import '../app.css';

	let { children } = $props();

	onMount(() => {
		const stopDataRefresh = installDataRefresh(window, () => idbSynced.done && getDocumentUsername() !== null, syncNow);
		registerSW({ immediate: true });
		applyTheme();
		applyItemSpacing();
		// @ts-expect-error injected by Vite
		window.APP_VERSIONS = { svelte: __SVELTE_VERSION__, yjs: __YJS_VERSION__ };
		const stopStorage = watchBrowserStorage();
		const visibility = () => {
			if (document.visibilityState === 'visible') reconnectYjs();
			else void saveLocalData();
		};
		const storage = (event: StorageEvent) => {
			if (event.key?.startsWith('pnl_sync:')) refreshSyncPreference();
		};
		window.addEventListener('online', reconnectYjs);
		window.addEventListener('storage', storage);
		document.addEventListener('visibilitychange', visibility);
		return () => {
			stopDataRefresh();
			stopStorage();
			window.removeEventListener('online', reconnectYjs);
			window.removeEventListener('storage', storage);
			document.removeEventListener('visibilitychange', visibility);
		};
	});
</script>

<svelte:head>
	<meta name="mobile-web-app-capable" content="yes" />
	<meta name="apple-mobile-web-app-status-bar-style" content="default" />
	<meta name="apple-mobile-web-app-title" content="Lists" />
	<title>Lists &amp; Prices</title>
</svelte:head>

{@render children()}

