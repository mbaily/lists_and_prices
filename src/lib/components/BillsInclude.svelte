<script lang="ts">
	import { base } from '$app/paths';
	import { onMount } from 'svelte';
	import { billSections, billLine, type BillSection } from '$lib/billsInclude';
	let { sections }: { sections: BillSection[] } = $props();
	let data = $state<Record<string, unknown> | null>(null);
	let error = $state('');
	let loading = $state(true);
	let controller: AbortController;
	async function refresh() {
		controller?.abort();
		controller = new AbortController();
		const request = controller;
		loading = true;
		error = '';
		try {
			const url = new URL('../simple_todo/api/bills?show_inactive=1', `${location.origin}${base || ''}/`);
			const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', signal: request.signal });
			if (response.status === 401 || response.status === 403) throw new Error('Sign in to Simple Todo to view bills.');
			if (!response.ok) throw new Error('Bills service is unavailable.');
			const json: unknown = await response.json();
			if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('Invalid bills response.');
			data = json as Record<string, unknown>;
		} catch (e) {
			if (request.signal.aborted) return;
			data = null;
			error = e instanceof Error && e.message.startsWith('Sign in') ? e.message : 'Bills service is unavailable.';
		} finally { if (!request.signal.aborted) loading = false; }
	}
	onMount(() => { refresh(); return () => controller?.abort(); });
</script>
<div class="bills-includes">
	{#if loading}<p>Loading bills…</p>
	{:else if error}<p>{error} <button onclick={refresh}>Retry</button></p>
	{:else if data}
		{#each sections as section}
			<section aria-label={billSections[section]}>
				<strong>{billSections[section]}</strong>
				{#if !Array.isArray(data[section])}<p>Section unavailable.</p>
				{:else if (data[section] as unknown[]).length === 0}<p>No entries.</p>
				{:else}<ul>{#each (data[section] as unknown[]) as row}{#if row && typeof row === 'object' && !Array.isArray(row)}<li>{billLine(row as Record<string, unknown>, section)}</li>{/if}{/each}</ul>{/if}
			</section>
		{/each}
		<button onclick={refresh}>Refresh bills</button>
	{/if}
</div>
<style>
	.bills-includes { padding: .4rem .75rem .7rem 2.5rem; color: var(--text2); font-size: .9rem; }
	section { margin-bottom: .5rem; }
	p, ul { margin: .25rem 0; }
	ul { padding-left: 1.2rem; }
	button { color: inherit; cursor: pointer; }
</style>
