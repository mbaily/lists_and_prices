<script lang="ts">
	import { onMount } from 'svelte';
	import { appUrl } from '$lib/urls';

	let status = $state<{ pending: boolean; lastSyncAt: number | null; needsLogin: boolean; error: string | null } | null>(null);
	let available = $state(false);
	onMount(() => {
		const controller = new AbortController();
		let loading = false;
		async function refresh() {
			if (loading) return;
			loading = true;
			try {
				const response = await fetch(appUrl('/api/local/status'), { cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) });
				if (!response.ok) throw new Error();
				const value = await response.json();
				if (value.target !== 'laptop' || typeof value.pending !== 'boolean') throw new Error();
				status = value; available = true;
			} catch { available = false; }
			finally { loading = false; }
		}
		void refresh();
		const timer = setInterval(() => { void refresh(); }, 5000);
		return () => { controller.abort(); clearInterval(timer); };
	});
</script>

<div class="upstream-status" role="status" aria-live="polite">
	<p>This browser syncs with the laptop. The laptop separately syncs with your upstream server.</p>
	{#if !available}
		<p>Upstream status is unavailable until this browser can reach the laptop.</p>
	{:else if status}
		<p>Last completed upstream sync: {status.lastSyncAt ? new Date(status.lastSyncAt).toLocaleString() : 'Not yet confirmed'}</p>
		<p>{status.pending ? 'Laptop changes are waiting for upstream confirmation.' : 'Laptop data was confirmed by the upstream server at the last sync.'}</p>
		{#if status.needsLogin}<p>Sign in to the upstream server again by restarting the laptop client with --login. Local access remains available.</p>
		{:else if status.error}<p>{status.error}</p>{/if}
	{/if}
</div>

<style>
	.upstream-status { border-top: 1px solid var(--border); margin-top: 0.8rem; padding-top: 0.3rem; }
	p { font-size: 0.85rem; line-height: 1.5; margin: 0.5rem 0; }
</style>
