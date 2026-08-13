<script lang="ts">
	import { docState } from '$lib/yjsStore.svelte';
	import { settings } from '$lib/settings.svelte';
	import {
		readFolders,
		readLists,
		readAllItems,
		isFolderEffectivelyArchived,
		isListEffectivelyArchived,
		isItemDone,
		type Item,
		type Folder
	} from '$lib/data';
	import { getSmartFolders } from '$lib/smartFolders.svelte';
	import { splitWithTags } from '$lib/tags';

	let { reportName, onBack }: { reportName: string; onBack: () => void } = $props();

	type ItemEntry = { name: string; date: string; isNote: boolean; children: ItemEntry[] };
	type ListBlock = { listName: string; listId: string; items: ItemEntry[] };
	type FolderBlock = { folderName: string; folderId: string; lists: ListBlock[] };

	function formatDate(createdAt: string | null): string {
		return createdAt
			? new Date(createdAt).toLocaleDateString('en-GB', {
					day: '2-digit',
					month: '2-digit',
					year: '2-digit'
				})
			: '';
	}

	function buildItemTree(allListItems: Item[], parentId: string | null, folder: Folder | null): ItemEntry[] {
		return allListItems
			.filter(
				(i) =>
					(i.parentId ?? null) === parentId &&
					!i.heading &&
					(!isItemDone(i, folder) || i.note)
			)
			.sort((a, b) => a.order - b.order)
			.map((i) => ({
				name: i.name,
				date: formatDate(i.createdAt),
				isNote: i.note,
				children: buildItemTree(allListItems, i.id, folder)
			}));
	}

	const folderBlocks = $derived.by((): FolderBlock[] => {
		void docState.version;
		const allFolders = readFolders();
		const allLists = readLists();
		const allItems = readAllItems();
		const folderIds = getSmartFolders()[reportName] ?? [];

		const reportFolders = allFolders
			.filter((f) => folderIds.includes(f.id) && !isFolderEffectivelyArchived(f.id, allFolders))
			.sort((a, b) => a.order - b.order);

		const result: FolderBlock[] = [];
		for (const folder of reportFolders) {
			const folderLists = allLists
				.filter((l) => l.folderId === folder.id && !isListEffectivelyArchived(l, allFolders) && !l.done)
				.sort((a, b) => a.order - b.order);

			const blocks: ListBlock[] = [];
			for (const list of folderLists) {
				const listItems = allItems.filter((i) => i.listId === list.id);
				const topItems = listItems
					.filter(
						(i) => !isItemDone(i, folder) && !i.heading && !i.note && (i.parentId ?? null) === null
					)
					.sort((a, b) => a.order - b.order)
					.map((i) => ({
						name: i.name,
						date: formatDate(i.createdAt),
						isNote: false,
						children: buildItemTree(listItems, i.id, folder)
					}));
				if (topItems.length > 0) {
					blocks.push({ listName: list.name, listId: list.id, items: topItems });
				}
			}
			if (blocks.length > 0) result.push({ folderName: folder.name, folderId: folder.id, lists: blocks });
		}
		return result;
	});

	// Lookup maps for resolving [[ref]] display names
	const allItemsById = $derived.by((): Map<string, Item> => {
		void docState.version;
		return new Map(readAllItems().map((i) => [i.id, i]));
	});
	const allListsById = $derived.by(() => {
		void docState.version;
		return new Map(readLists().map((l) => [l.id, l]));
	});
	const allFoldersById = $derived.by(() => {
		void docState.version;
		return new Map(readFolders().map((f) => [f.id, f]));
	});

	function resolveRefName(type: string, id: string): string {
		if (type === 'list-ref') return allListsById.get(id)?.name ?? '…';
		if (type === 'folder-ref') return allFoldersById.get(id)?.name ?? '…';
		return allItemsById.get(id)?.name ?? '…';
	}

	let copyStatus = $state<'idle' | 'copied'>('idle');
	let copyTimeout: ReturnType<typeof setTimeout> | null = null;

	import { onDestroy } from 'svelte';
	onDestroy(() => {
		if (copyTimeout) clearTimeout(copyTimeout);
	});

	function navigate(url: string) {
		const a = document.createElement('a');
		a.href = url;
		a.target = '_blank';
		a.rel = 'noopener noreferrer';
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
	}

	function navigateToList(listId: string) { navigate(`/#l/${listId}`); }
	function navigateToFolder(folderId: string) {
		// Build the full ancestor path so the breadcrumb is correct for nested folders
		const allFolders = readFolders();
		const ancestors: string[] = [];
		let fid: string | null = folderId;
		const visited = new Set<string>();
		while (fid !== null) {
			if (visited.has(fid)) break;
			visited.add(fid);
			ancestors.unshift(fid);
			const f = allFolders.find((x) => x.id === fid);
			fid = f?.parentId ?? null;
		}
		navigate(`/#f/${ancestors.join('/')}`);
	}

	function addItemLines(lines: string[], items: ItemEntry[], indent: string) {
		for (const item of items) {
			lines.push(`${indent}${item.name}${item.date ? `  (${item.date})` : ''}`);
			if (item.children.length > 0) addItemLines(lines, item.children, indent + '  ');
		}
	}

	async function copyAsText() {
		const lines: string[] = [`SMART FOLDER: ${reportName}`, ''];
		if (folderBlocks.length === 0) {
			lines.push('(No uncompleted todos found)');
		} else {
			for (const fb of folderBlocks) {
				lines.push(fb.folderName);
				for (const lb of fb.lists) {
					lines.push(`  ${lb.listName}`);
					addItemLines(lines, lb.items, '    ');
				}
				lines.push('');
			}
		}
		try {
			await navigator.clipboard.writeText(lines.join('\n'));
			copyStatus = 'copied';
			copyTimeout = setTimeout(() => (copyStatus = 'idle'), 2000);
		} catch {
			/* silently fail */
		}
	}
</script>

<div class="rf-screen" style="--rf-font-size: {settings.reportFontSize}px">
	<header class="rf-header">
		<button class="rf-back" onclick={onBack} aria-label="Back">←</button>
		<span class="rf-title">📋 {reportName}</span>
		<button
			class="rf-copy"
			class:copied={copyStatus === 'copied'}
			onclick={copyAsText}
			title="Copy as text"
		>
			{copyStatus === 'copied' ? '✓' : '⎘'}
		</button>
	</header>

	<div class="rf-body">
		{#if folderBlocks.length === 0}
			<p class="rf-empty">(No uncompleted todos found)</p>
		{:else}
			{#each folderBlocks as fb}
				<div class="rf-folder-block">
					<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
					<div class="rf-folder-name rf-clickable" onclick={() => navigateToFolder(fb.folderId)}>{fb.folderName}</div>
					{#each fb.lists as lb}
						<div class="rf-list-block">
						<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
						<div class="rf-list-name rf-clickable" onclick={() => navigateToList(lb.listId)}>{lb.listName}</div>
						{#snippet renderItem(item: ItemEntry, depth: number)}
							<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
							<div class="rf-item rf-clickable" style="margin-left: {depth * 2}ch" onclick={() => navigateToList(lb.listId)}>
									{#if item.isNote}<span class="rf-note-mark">↳ </span>{/if}{#each splitWithTags(item.name) as part}{#if part.type === 'url'}<a class="rf-url" href={part.value} target="_blank" rel="noopener noreferrer" onclick={(e) => e.stopPropagation()}>{part.value}</a>{:else if part.type === 'tag'}<span class="rf-tag-pill" onclick={(e) => e.stopPropagation()}>{part.value}</span>{:else if part.type === 'item-ref' || part.type === 'list-ref' || part.type === 'folder-ref'}<span role="button" class="rf-ref-pill" onclick={(e) => { e.stopPropagation(); navigateToList(lb.listId); }}>{resolveRefName(part.type, part.value)}</span>{:else}{part.value}{/if}{/each}{#if item.date}<span class="rf-date"> ({item.date})</span>{/if}
								</div>
								{#each item.children as child}
									{@render renderItem(child, depth + 1)}
								{/each}
							{/snippet}
							{#each lb.items as item}
								{@render renderItem(item, 0)}
							{/each}
						</div>
					{/each}
				</div>
			{/each}
		{/if}
	</div>
</div>

<style>
	.rf-screen {
		display: flex;
		flex-direction: column;
		height: 100dvh;
		background: #000;
		color: #fff;
		font-family: ui-monospace, 'Cascadia Code', 'Fira Mono', monospace;
		font-size: var(--rf-font-size, 14px);
	}
	.rf-header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem 1rem;
		border-bottom: 1px solid #333;
		flex-shrink: 0;
	}
	.rf-back {
		background: none;
		border: none;
		color: #cba6f7;
		font-size: 1.3rem;
		cursor: pointer;
		padding: 0;
		line-height: 1;
	}
	.rf-title {
		flex: 1;
		font-weight: 700;
		color: #cba6f7;
		font-size: 1em;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.rf-copy {
		background: #cba6f7;
		color: #000;
		border: none;
		border-radius: 8px;
		padding: 0.35rem 0.8rem;
		font-size: 0.85em;
		font-weight: 700;
		font-family: inherit;
		cursor: pointer;
		opacity: 0.9;
		transition: background 0.15s;
	}
	.rf-copy.copied { background: #a6e3a1; }

	.rf-body {
		flex: 1;
		overflow-y: auto;
		padding: 1.5rem 2rem 4rem;
		line-height: 1.6;
	}
	.rf-folder-block {
		margin-bottom: 1.5rem;
	}
	.rf-folder-name {
		font-weight: 700;
		color: #89b4fa;
		padding-bottom: 0.15rem;
		border-bottom: 1px solid #333;
		margin-bottom: 0.4rem;
	}
	.rf-list-block {
		margin-left: 2ch;
		margin-top: 0.6rem;
	}
	.rf-list-name {
		color: #a6e3a1;
		font-style: italic;
		margin-bottom: 0.15rem;
	}
	.rf-item {
		margin-left: 0;
		color: #fff;
		word-break: break-word;
	}
	.rf-clickable {
		cursor: pointer;
	}
	.rf-note-mark {
		color: #888;
	}
	.rf-date {
		color: #888;
		font-size: 0.85em;
	}
	.rf-empty {
		color: #888;
	}
	.rf-ref-pill {
		background: #313244;
		color: #cba6f7;
		border-radius: 4px;
		padding: 0 0.3em;
		font-size: 0.9em;
		cursor: pointer;
		text-decoration: underline dotted;
	}
	.rf-ref-pill:hover {
		background: #45475a;
	}
	.rf-url {
		color: #89b4fa;
		word-break: break-all;
	}
	.rf-tag-pill {
		color: #f38ba8;
	}
</style>
