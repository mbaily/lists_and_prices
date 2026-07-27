<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { auth, checkSession, logout } from '$lib/auth.svelte';
	import { initYjs, destroyYjs, reconnectYjs } from '$lib/yjsStore.svelte';
	import { reloadSettings } from '$lib/settings.svelte';
	import LoginScreen from '$lib/components/LoginScreen.svelte';
	import HomeScreen from '$lib/components/HomeScreen.svelte';

	let ready = $state(false);

	function getWsUrl(): string {
		const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
		return `${wsProto}//${location.host}/yjs`;
	}

	onMount(() => {
		// Optimistically load the app from local storage immediately so there's no delay
		if (auth.username) {
			reloadSettings();
			initYjs(auth.username, getWsUrl());
			ready = true;
		}

		checkSession().then((ok) => {
			if (!ready) {
				// We didn't optimistically load, so handle the login based on checkSession
				if (ok && auth.username) {
					reloadSettings();
					initYjs(auth.username, getWsUrl());
				}
				ready = true;
			} else if (!ok) {
				// We optimistically loaded, but the session is actually invalid
				destroyYjs();
			}
		});

		// When the device comes back online (e.g. iPhone rejoins Wi-Fi after being
		// offline), force the WebSocket provider to reconnect.
		function handleOnline() {
			if (auth.username) {
				reconnectYjs();
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
