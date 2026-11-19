<script lang="ts">
	import { favouriteKey, favouritePath, type FavouriteEntry, type Folder } from '$lib/data';
	import { settings, updateSettings } from '$lib/settings.svelte';

	let {
		entries,
		folders,
		favouriteFolderId = $bindable(null),
		activeListId = null,
		onRearrange,
		onOpenFolder,
		onOpenList
	}: {
		entries: FavouriteEntry[];
		folders: Folder[];
		favouriteFolderId?: string | null;
		activeListId?: string | null;
		onRearrange?: () => void;
		onOpenFolder?: (id: string) => void;
		onOpenList: (id: string) => void;
	} = $props();

	const expanded = $derived(!settings.favouritesCollapsed);
	const favouriteFolders = $derived(entries.filter(entry => entry.type === 'favourites-folder').map(entry => entry.item));
	const currentFolder = $derived(favouriteFolders.find(folder => folder.id === favouriteFolderId));
	const children = $derived(entries.filter(entry => entry.parentId === (currentFolder?.id ?? null)));
</script>

{#if entries.length > 0}
	<button
		class="fav-control fav-label"
		onclick={() => updateSettings({ favouritesCollapsed: !settings.favouritesCollapsed })}
		aria-label={settings.favouritesCollapsed ? 'Expand favourites' : 'Collapse favourites'}
		title={settings.favouritesCollapsed ? 'Expand favourites' : 'Collapse favourites'}
	>★</button>
{/if}
{#if onRearrange}
	<button class="fav-control" onclick={onRearrange} aria-label="Rearrange favourites" title="Rearrange favourites">
		{entries.length === 0 ? '⇅ Rearrange favourites' : '⇅'}
	</button>
{/if}
{#if currentFolder}
	{@const path = favouritePath(currentFolder.name, currentFolder.parentId, favouriteFolders)}
	{@const label = expanded ? path : currentFolder.name}
	<button
		class="fav-chip fav-back"
		class:expanded
		aria-label={'Go up from ' + label}
		title={'Go up from ' + path}
		onclick={() => favouriteFolderId = currentFolder.parentId}
	>← {label}</button>
{/if}
{#each children as entry (favouriteKey({ type: entry.type, id: entry.item.id }))}
	{@const item = entry.item}
	{#if entry.type === 'favourites-folder'}
		{@const path = favouritePath(item.name, entry.parentId, favouriteFolders)}
		{@const label = expanded ? path : item.name}
		<button
			class="fav-chip fav-folder"
			class:expanded
			class:compact={!expanded}
			aria-label={'Open Favourites folder ' + label}
			title={'Favourites folder: ' + path}
			onclick={() => favouriteFolderId = item.id}
		>{label} ›</button>
	{:else}
		{@const path = favouritePath(entry.item.name, entry.type === 'folder' ? entry.item.parentId : entry.item.folderId, folders)}
		<button
			class="fav-chip"
			class:expanded
			class:compact={!expanded}
			class:active={entry.type === 'list' && entry.item.id === activeListId}
			style:--chip-color={entry.item.color}
			title={path}
			aria-current={entry.type === 'list' && entry.item.id === activeListId ? 'page' : undefined}
			onclick={() => {
				if (entry.type === 'folder') onOpenFolder?.(entry.item.id);
				else if (entry.item.id !== activeListId) onOpenList(entry.item.id);
			}}
		>{entry.type === 'folder' ? '📁 ' : ''}{expanded ? path : entry.item.name}</button>
	{/if}
{/each}
{#if currentFolder && children.length === 0}
	<span class="empty">This Favourites folder is empty</span>
{/if}

<style>
	.fav-control {
		background: none;
		border: none;
		color: var(--text2);
		font-size: 0.95rem;
		flex-shrink: 0;
		cursor: pointer;
		padding: 0.1rem 0.2rem;
		line-height: 1;
	}
	.fav-control:hover { color: var(--accent); }
	.fav-label { color: #f59e0b; font-size: 1rem; }
	.fav-chip {
		--chip-color: var(--accent);
		background: none;
		border: 1px solid var(--chip-color);
		border-radius: 999px;
		padding: 0.2rem 0.65rem;
		font-size: 0.82rem;
		color: var(--chip-color);
		cursor: pointer;
		min-width: 0;
		max-width: 100%;
	}
	.fav-chip.expanded {
		border-radius: 1rem;
		text-align: start;
		white-space: normal;
		overflow-wrap: anywhere;
	}
	.fav-chip:not(.expanded) {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: min(200px, 100%);
	}
	.fav-chip:hover { background: color-mix(in srgb, var(--chip-color) 12%, transparent); }
	.fav-chip.active {
		background: var(--chip-color);
		color: #fff;
	}
	.fav-chip.compact {
		max-width: min(90px, 100%);
		padding: 0.15rem 0.5rem;
		font-size: 0.78rem;
	}
	.fav-folder { background: color-mix(in srgb, var(--accent) 9%, transparent); }
	.fav-back { --chip-color: var(--text2); }
	.empty { color: var(--text2); font-size: 0.82rem; }
</style>
