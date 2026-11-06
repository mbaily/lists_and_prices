<script lang="ts">
	import { base } from '$app/paths';
	import { billSections, billLine, type BillSection } from '$lib/billsInclude';
	import { simpleTodoApiUrl } from '$lib/simpleTodo';
	import type { IncludeView } from '$lib/includeView';
	let { sections, displaySections = sections }: { sections: BillSection[]; displaySections?: BillSection[] } = $props();
	let data = $state<Record<string, unknown> | null>(null);
	let error = $state('');
	let loading = $state(true);
	let hasLoaded = false;
	let lastChecksum = '';
	let lastSectionsKey = '';
	let controller: AbortController;
	export function sectionView(section: BillSection): IncludeView<string> {
		if (loading) return { status: 'loading' };
		if (error) return { status: 'error', message: error };
		const rows: unknown = data?.[section];
		if (!Array.isArray(rows)) return { status: 'unavailable' };
		if (!rows.every((row: unknown) => row && typeof row === 'object' && !Array.isArray(row))) {
			return { status: 'error', message: 'Invalid bills response.' };
		}
		return {
			status: 'ready',
			entries: rows.map((row: unknown) => billLine(row as Record<string, unknown>, section))
		};
	}
	async function fetchBills(selected: BillSection[], force = false) {
		const currentKey = [...selected].sort().join(',');
		if (!force && hasLoaded && currentKey === lastSectionsKey) {
			return;
		}
		lastSectionsKey = currentKey;
		controller?.abort();
		controller = new AbortController();
		const request = controller;
		if (!hasLoaded) {
			loading = true;
		}
		error = '';
		try {
			const url = simpleTodoApiUrl('api/bills?show_inactive=1', base);
			const credentials = typeof location !== 'undefined' && url.origin !== location.origin ? 'include' : 'same-origin';
			const response = await fetch(url, { credentials, cache: 'no-store', signal: request.signal });
			if (response.status === 401 || response.status === 403) throw new Error('Sign in to Simple Todo to view bills.');
			if (!response.ok) throw new Error('Bills service is unavailable.');
			const rawText = await response.text();
			if (request.signal.aborted) return;
			if (hasLoaded && rawText === lastChecksum) {
				return;
			}
			lastChecksum = rawText;
			const json: unknown = JSON.parse(rawText);
			if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('Invalid bills response.');
			data = json as Record<string, unknown>;
			hasLoaded = true;
		} catch (e) {
			if (request.signal.aborted) return;
			if (!hasLoaded) {
				data = null;
				error = e instanceof Error && e.message.startsWith('Sign in') ? e.message : 'Bills service is unavailable.';
			}
		} finally { if (!request.signal.aborted) loading = false; }
	}
	export function refresh() {
		return fetchBills(sections, true);
	}
	$effect(() => {
		const selected = [...sections];
		void fetchBills(selected, false);
		return () => controller?.abort();
	});
</script>
{#if displaySections.length}
<div class="bills-includes">
	{#if loading}<p>Loading bills…</p>
	{:else if error}<p>{error} <button onclick={refresh}>Retry</button></p>
	{:else if data}
		{#each displaySections as section}
			<section aria-label={billSections[section]}>
				{#if !Array.isArray(data[section])}<p>Section unavailable.</p>
				{:else if (data[section] as unknown[]).length === 0}<p>No entries.</p>
				{:else}<ul>{#each (data[section] as unknown[]) as row}{#if row && typeof row === 'object' && !Array.isArray(row)}<li>{billLine(row as Record<string, unknown>, section)}</li>{/if}{/each}</ul>{/if}
			</section>
		{/each}
	{/if}
</div>
{/if}
<style>
	.bills-includes { padding: 0 .75rem 0 0; color: var(--text2); font-size: .9rem; }
	p, ul { margin: 0; }
	ul { padding-left: 0; }
	button { color: inherit; cursor: pointer; }
</style>
