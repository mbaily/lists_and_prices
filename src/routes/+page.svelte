<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { yjsUrl } from '$lib/urls';
	import { auth, checkSession, logout } from '$lib/auth.svelte';
	import { initYjs, destroyYjs } from '$lib/yjsStore.svelte';
	import { reconcileSessionDocument } from '$lib/sessionDocument';
	import { reloadSettings } from '$lib/settings.svelte';
	import LoginScreen from '$lib/components/LoginScreen.svelte';
	import HomeScreen from '$lib/components/HomeScreen.svelte';

	let ready = $state(false);

	onMount(() => {
		const loadedUsername = auth.username;
		// Optimistically load the app from local storage immediately so there's no delay
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

{#if !ready}
	<div class="splash">Loading…</div>
{:else if !auth.username}
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
