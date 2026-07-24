<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { auth, checkSession, logout } from '$lib/auth.svelte';
	import { initYjs, destroyYjs } from '$lib/yjsStore.svelte';
	import { reloadSettings } from '$lib/settings.svelte';
	import LoginScreen from '$lib/components/LoginScreen.svelte';
	import HomeScreen from '$lib/components/HomeScreen.svelte';

	let ready = $state(false);

	function getWsUrl(): string {
		const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
		return `${wsProto}//${location.host}/yjs`;
	}

	onMount(async () => {
		const ok = await checkSession();
		if (ok && auth.username) {
			reloadSettings(); // apply this user's theme/currency/handedness
			initYjs(auth.username, getWsUrl());
		}
		ready = true;

		// When the device comes back online (e.g. iPhone rejoins Wi-Fi after being
		// offline), re-initialise YJS so the WebSocket provider reconnects and syncs
		// any changes made while offline.
		function handleOnline() {
			if (auth.username) {
				// destroyYjs tears down the stale WS; initYjs creates a fresh one.
				// y-indexeddb will merge the offline edits automatically.
				initYjs(auth.username, getWsUrl());
			}
		}

		window.addEventListener('online', handleOnline);

		// Expose cleanup via onDestroy
		return () => window.removeEventListener('online', handleOnline);
	});

	async function handleLogout() {
		destroyYjs(); // tear down Yjs before clearing auth to avoid stale updates
		await logout(); // clears auth.username → triggers re-render to LoginScreen
	}
</script>

{#if !ready}
	<div class="splash">Loading…</div>
{:else if !auth.username}
	<LoginScreen
		onLogin={(username: string) => {
			reloadSettings(); // auth.username is set before this callback, load their settings
			const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
			initYjs(username, `${wsProto}//${location.host}/yjs`);
		}}
	/>
{:else}
	<HomeScreen onLogout={handleLogout} />
{/if}

<style>
	.splash {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 100dvh;
		font-size: 1.1rem;
		color: var(--text2);
	}
</style>
