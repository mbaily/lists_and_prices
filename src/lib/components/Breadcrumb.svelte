<script module lang="ts">
	export interface BreadcrumbItem {
		label: string;
		onNavigate?: () => void;
		home?: boolean;
	}
</script>

<script lang="ts">
	import { onMount } from 'svelte';

	let {
		items,
		searchLabel = null,
		onRestoreSearch
	}: {
		items: BreadcrumbItem[];
		searchLabel?: string | null;
		onRestoreSearch?: () => void;
	} = $props();

	let trail = $state<HTMLOListElement | null>(null);
	let expanded = $state(false);
	const path = $derived(JSON.stringify(items.map(item => item.label)));
	const collapsed = $derived(!expanded && items.length > 3);

	$effect(() => {
		// Bring a changed path into view without snapping back while the user scrolls.
		void path;
		expanded = false;
		if (trail) trail.scrollLeft = trail.scrollWidth;
	});

	onMount(() => {
		if (!trail) return;
		const observer = new ResizeObserver(() => {
			if (trail && !expanded) trail.scrollLeft = trail.scrollWidth;
		});
		observer.observe(trail);
		return () => observer.disconnect();
	});
</script>

{#snippet separator()}
	<svg class="separator" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
		<path d="m6 4 4 4-4 4" />
	</svg>
{/snippet}

{#snippet label(item: BreadcrumbItem)}
	{#if item.home}
		<!-- Keep intrinsic dimensions so the icon cannot expand before CSS loads. -->
		<svg class="home-icon" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
			<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z" />
		</svg>
		<span class="visually-hidden">{item.label}</span>
	{:else}
		<span class="label">{item.label}</span>
	{/if}
{/snippet}

<nav class="breadcrumb" aria-label="Breadcrumb">
	<ol bind:this={trail}>
		{#each items as item, index}
			{#if items.length > 3 && index === 1}
				<li>
					{@render separator()}
					<button type="button" class="crumb expand" onclick={() => { expanded = !expanded; if (trail) trail.scrollLeft = 0; }} aria-expanded={expanded} aria-label={expanded ? 'Collapse parent folders' : 'Show all parent folders'} title={expanded ? 'Collapse parent folders' : 'Show all parent folders'}>…</button>
				</li>
			{/if}
			{#if !collapsed || index === 0 || index >= items.length - 2}
			<li class:home-item={index === 0 && item.home} class:parent={collapsed && index === items.length - 2}>
				{#if index > 0}
					{@render separator()}
				{/if}
				{#if item.onNavigate}
					<button type="button" class="crumb" class:home={item.home} onclick={item.onNavigate} aria-label={item.label} title={item.label}>
						{@render label(item)}
					</button>
				{:else}
					<span class="crumb" class:home={item.home} class:current={index === items.length - 1} aria-current={index === items.length - 1 ? 'page' : undefined} title={item.label}>
						{@render label(item)}
					</span>
				{/if}
			</li>
			{/if}
		{/each}
	</ol>
	{#if searchLabel && onRestoreSearch}
		<button type="button" class="search-return" onclick={onRestoreSearch} aria-label={`Back to search results: ${searchLabel}`} title={`Back to search results: ${searchLabel}`}>
			<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
				<circle cx="8.5" cy="8.5" r="5" /><path d="m12.5 12.5 4 4" />
			</svg>
			<span class="label">“{searchLabel}”</span>
		</button>
	{/if}
</nav>

<style>
	.breadcrumb {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
		max-width: min(65vw, 42rem);
		flex: 0 1 auto;
		font-size: 0.92rem;
	}
	ol {
		display: flex;
		align-items: center;
		min-width: 0;
		margin: 0;
		padding: 3px;
		list-style: none;
		overflow-x: auto;
		scrollbar-width: none;
	}
	ol::-webkit-scrollbar { display: none; }
	li { display: flex; align-items: center; flex-shrink: 0; }
	.home-item {
		position: sticky;
		inset-inline-start: -3px;
		padding-inline: 3px 0;
		z-index: 1;
		background: var(--bg2);
		box-shadow: 4px 0 6px var(--bg2);
	}
	.crumb, .search-return {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 36px;
		padding: 0.35rem 0.55rem;
		border: 1px solid transparent;
		border-radius: 8px;
		background: transparent;
		color: var(--text2);
		font: inherit;
		line-height: 1.25;
		text-decoration: none;
		white-space: nowrap;
	}
	button { cursor: pointer; }
	button.crumb { color: var(--accent); }
	.crumb:not(.current):not(.home) { padding-inline: 0.2rem; }
	.label {
		min-width: 0;
		max-width: clamp(5rem, 18vw, 12rem);
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.current {
		border-color: color-mix(in srgb, var(--accent) 18%, var(--border));
		background: color-mix(in srgb, var(--accent) 7%, var(--bg));
		color: var(--text);
		font-weight: 600;
	}
	.current .label { max-width: clamp(8rem, 28vw, 22rem); }
	.home { min-width: 28px; padding-inline: 0.2rem; }
	.expand { min-width: 24px; font-weight: 600; }
	.home-icon { width: 19px; height: 19px; }
	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
	}
	.separator { width: 14px; height: 14px; margin-inline: 0.1rem; color: var(--text2); opacity: 0.65; }
	.search-return {
		gap: 0.35rem;
		min-width: 36px;
		max-width: 10rem;
		flex-shrink: 1;
		border-color: var(--border);
		color: var(--accent);
		font-size: 0.82rem;
	}
	.search-return svg { width: 16px; height: 16px; flex-shrink: 0; }
	@media (hover: hover) {
		button:hover { background: var(--bg3); color: var(--text); }
	}
	button:active { background: var(--bg3); }
	button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
	@media (max-width: 600px) {
		.parent { display: none; }
		.search-return .label { display: none; }
		.breadcrumb:has(.search-return) .current .label { max-width: 5rem; }
	}
	@media (pointer: coarse) {
		.crumb, .search-return { min-height: 44px; }
		.home { min-width: 32px; }
	}
</style>
