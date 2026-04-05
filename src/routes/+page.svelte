<script lang="ts">
	import { onMount } from 'svelte';
	import { auth, checkSession, logout } from '$lib/auth.svelte';
	import { initYjs, destroyYjs } from '$lib/yjsStore.svelte';
	import LoginScreen from '$lib/components/LoginScreen.svelte';
	import HomeScreen from '$lib/components/HomeScreen.svelte';

	let ready = $state(false);

	onMount(async () => {
		const ok = await checkSession();
		if (ok && auth.username) {
			const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
			initYjs(auth.username, `${wsProto}//${location.host}/yjs`);
		}
		ready = true;
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
