<script lang="ts">
	import { onMount } from 'svelte';
	import { yjsUrl } from '$lib/urls';
	import { auth, checkSession, logout } from '$lib/auth.svelte';
	import { initYjs, destroyYjs, getDocumentUsername, reconnectYjs, syncNow, idbSynced, localSaveState } from '$lib/yjsStore.svelte';
	import { reconcileSessionDocument } from '$lib/sessionDocument';
	import { reloadSettings } from '$lib/settings.svelte';
	import LoginScreen from '$lib/components/LoginScreen.svelte';
	import HomeScreen from '$lib/components/HomeScreen.svelte';

	let ready = $state(false);
	let continueOffline = $state(false);
	const showLogin = $derived(!auth.username || (auth.needsLogin && !continueOffline));

	$effect(() => {
		if (!auth.needsLogin) continueOffline = false;
	});

	onMount(() => {
		const loadedUsername = auth.username;
		// Start restoring local data immediately, without waiting for the session check.
		if (auth.username) {
			reloadSettings();
			initYjs(auth.username, yjsUrl());
			ready = true;
		}

		checkSession().then((ok) => {
			reconcileSessionDocument(loadedUsername, ok, yjsUrl());
			ready = true;
		});

	});

	function handleLogin(username: string) {
		continueOffline = false;
		if (getDocumentUsername() === username) {
			// Reauthentication resumes the live document, including unsynced edits.
			reconnectYjs();
			void syncNow();
		} else {
			reloadSettings();
			initYjs(username, yjsUrl());
		}
	}

	async function handleLogout() {
		if (await logout()) {
			destroyYjs();
		} else {
			alert('Could not sign out. Your local data is still available. Check your connection and try again.');
		}
	}
</script>

<!-- Render the first complete local view, including pins, once IndexedDB is restored.
     Storage errors must still leave the app's settings and sync information accessible. -->
{#if ready && (showLogin || idbSynced.done || localSaveState.status === 'error')}
	{#if showLogin}
		<LoginScreen
			onLogin={handleLogin}
			onContinueOffline={auth.username ? () => { continueOffline = true; } : undefined}
		/>
	{:else}
		{#key auth.username}
			<HomeScreen onLogout={handleLogout} />
		{/key}
	{/if}
{:else}
	<div class="startup-message" role="status">{ready ? 'Loading data from this device…' : 'Starting the app…'}</div>
{/if}

<style>
	.startup-message {
		position: fixed;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text2);
	}
</style>
