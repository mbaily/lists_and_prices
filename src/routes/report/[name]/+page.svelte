<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/stores';
	import { auth, checkSession } from '$lib/auth.svelte';
	import { initYjs, destroyYjs } from '$lib/yjsStore.svelte';
	import { reloadSettings } from '$lib/settings.svelte';
	import SmartFolderReportScreen from '$lib/components/SmartFolderReportScreen.svelte';

	const reportName = $derived(decodeURIComponent($page.params.name));

	let ready = $state(false);
	let authed = $state(false);

	onMount(async () => {
		const ok = await checkSession();
		if (ok && auth.username) {
			reloadSettings();
			const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
			initYjs(auth.username, `${wsProto}//${location.host}/yjs`);
			authed = true;
		}
		ready = true;
	});

	onDestroy(() => {
		// Only destroy if this tab owns the Yjs instance (not shared with main tab)
		// Each tab has its own module scope so this is safe.
		destroyYjs();
	});
</script>

<svelte:head>
	<title>📋 {reportName}</title>
	<meta name="viewport" content="width=device-width, initial-scale=1" />
</svelte:head>

{#if !ready}
	<div class="splash">Loading…</div>
{:else if !authed}
	<div class="splash">Not signed in — please open the app and sign in first.</div>
{:else}
	<SmartFolderReportScreen {reportName} onBack={() => window.close()} />
{/if}

<style>
	.splash {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 100dvh;
		font-size: 1rem;
		color: #888;
		background: #000;
		font-family: ui-monospace, 'Cascadia Code', 'Fira Mono', monospace;
	}
</style>
