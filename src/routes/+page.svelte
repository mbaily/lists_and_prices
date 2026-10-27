<script lang="ts">
	import { onMount } from 'svelte';
	import { yjsUrl } from '$lib/urls';
	import { auth, checkSession, logout } from '$lib/auth.svelte';
	import { initYjs, destroyYjs, idbSynced, localSaveState } from '$lib/yjsStore.svelte';
	import { reconcileSessionDocument } from '$lib/sessionDocument';
	import { reloadSettings } from '$lib/settings.svelte';
	import LoginScreen from '$lib/components/LoginScreen.svelte';
	import HomeScreen from '$lib/components/HomeScreen.svelte';

	let ready = $state(false);

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
{#if ready && (!auth.username || idbSynced.done || localSaveState.status === 'error')}
	{#if !auth.username}
		<LoginScreen
			onLogin={(username: string) => {
				reloadSettings(); // auth.username is set before this callback, load their settings
				initYjs(username, yjsUrl());
			}}
		/>
	{:else}
		{#key auth.username}
			<HomeScreen onLogout={handleLogout} />
		{/key}
	{/if}
{/if}
