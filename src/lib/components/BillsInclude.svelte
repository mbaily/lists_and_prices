<script lang="ts">
	import { base } from '$app/paths';
	import { billSections, billLine, type BillSection } from '$lib/billsInclude';
	import { simpleTodoApiUrl } from '$lib/simpleTodo';
	import type { IncludeView } from '$lib/includeView';
	import { billIncludeEntries } from '$lib/includeEntries';
	import IncludeText from './IncludeText.svelte';
	import { getDoc } from '$lib/yjsStore.svelte';
	import { readIncludeCache, writeIncludeCache } from '$lib/includeCache';
	let { sections, displaySections = sections, onTagClick }: { sections: BillSection[]; displaySections?: BillSection[]; onTagClick?: (tag: string) => void } = $props();
	const cacheScope = getDoc();
	const cached = readIncludeCache<Record<string, unknown>>(cacheScope, 'bills');
	let lastValue = cached?.value ?? null;
	let data = $state<Record<string, unknown> | null>(lastValue);
	let error = $state('');
	let loading = $state(!cached);
	let refreshing = $state(false);
	let hasLoaded = !!cached;
	let lastChecksum = cached?.checksum ?? '';
	let lastSectionsKey = '';
	let controller: AbortController;
	export function nearbyEntries(section: BillSection) {
		return data ? billIncludeEntries(data, section) : [];
	}
	export function status() { return { loading, refreshing, error }; }
	export function sectionView(section: BillSection): IncludeView<string> {
		if (loading) return { status: 'loading' };
		if (error) return { status: 'error', message: error };
		const rows: unknown = data?.[section];
		if (!Array.isArray(rows)) return { status: 'unavailable' };
		const overdueRows: unknown[] = (section === 'upcoming' || section === 'due_today') && Array.isArray(data?.overdue)
			? (data.overdue as unknown[])
			: [];
		const combined = [...overdueRows, ...rows];
		if (!combined.every((row: unknown) => row && typeof row === 'object' && !Array.isArray(row))) {
			return { status: 'error', message: 'Invalid bills response.' };
		}
		return {
			status: 'ready',
			entries: combined.map((row: unknown) => billLine(row as Record<string, unknown>, section))
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
		const today = new Date();
		refreshing = true;
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
				writeIncludeCache(cacheScope, 'bills', lastValue, rawText, today);
				return;
			}
			const json: unknown = JSON.parse(rawText);
			if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('Invalid bills response.');
			data = json as Record<string, unknown>;
			lastValue = json as Record<string, unknown>;
			lastChecksum = rawText;
			writeIncludeCache(cacheScope, 'bills', json, rawText, today);
			hasLoaded = true;
		} catch (e) {
			if (request.signal.aborted) return;
			if (!hasLoaded) {
				data = null;
				error = e instanceof Error && e.message.startsWith('Sign in') ? e.message : 'Bills service is unavailable.';
			}
		} finally {
			if (!request.signal.aborted) {
				loading = false;
				refreshing = false;
			}
		}
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
			{@const overdueRows = (section === 'upcoming' || section === 'due_today') && !displaySections.includes('overdue') && Array.isArray(data?.overdue) ? (data.overdue as unknown[]) : []}
			{@const sectionRows = Array.isArray(data[section]) ? (data[section] as unknown[]) : []}
			{@const allRows = [...overdueRows, ...sectionRows]}
			<section aria-label={billSections[section]}>
				{#if !Array.isArray(data[section])}<p>Section unavailable.</p>
				{:else if allRows.length === 0}<p>No entries.</p>
				{:else}<ul>{#each allRows as row}{#if row && typeof row === 'object' && !Array.isArray(row)}<li><IncludeText text={billLine(row as Record<string, unknown>, section)} {onTagClick} /></li>{/if}{/each}</ul>{/if}
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
