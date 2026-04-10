<script lang="ts">
	import { docState } from '$lib/yjsStore.svelte';
	import { settings } from '$lib/settings.svelte';
	import {
		readFolders,
		readLists,
		readAllItems,
		isFolderEffectivelyArchived,
		isListEffectivelyArchived,
		type Item
	} from '$lib/data';
	import { getSmartFolders } from '$lib/smartFolders.svelte';

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

	function buildItemTree(allListItems: Item[], parentId: string | null): ItemEntry[] {
		return allListItems
			.filter(
				(i) =>
					(i.parentId ?? null) === parentId &&
					!i.heading &&
					(!i.checked || i.note)
			)
			.sort((a, b) => a.order - b.order)
			.map((i) => ({
				name: i.name,
				date: formatDate(i.createdAt),
				isNote: i.note,
				children: buildItemTree(allListItems, i.id)
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
			.sort((a, b) => {
				const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
				const db = b.createdAt ? new Date(b.createdAt).getTime() : 0;
				return db - da;
			});

		const result: FolderBlock[] = [];
		for (const folder of reportFolders) {
			const folderLists = allLists
				.filter((l) => l.folderId === folder.id && !isListEffectivelyArchived(l, allFolders))
				.sort((a, b) => {
					const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
					const db = b.createdAt ? new Date(b.createdAt).getTime() : 0;
					return db - da;
				});

			const blocks: ListBlock[] = [];
			for (const list of folderLists) {
				const listItems = allItems.filter((i) => i.listId === list.id);
				const topItems = listItems
					.filter(
						(i) => !i.checked && !i.heading && !i.note && (i.parentId ?? null) === null
					)
					.sort((a, b) => {
						const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
						const db = b.createdAt ? new Date(b.createdAt).getTime() : 0;
						return db - da;
					})
					.map((i) => ({
						name: i.name,
						date: formatDate(i.createdAt),
						isNote: false,
						children: buildItemTree(listItems, i.id)
					}));
				if (topItems.length > 0) {
					blocks.push({ listName: list.name, listId: list.id, items: topItems });
				}
			}
			if (blocks.length > 0) result.push({ folderName: folder.name, folderId: folder.id, lists: blocks });
		}
		return result;
	});

	let copyStatus = $state<'idle' | 'copied'>('idle');

	function navigate(url: string) {
		window.open(url, '_blank');
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
			setTimeout(() => (copyStatus = 'idle'), 2000);
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
									{#if item.isNote}<span class="rf-note-mark">↳ </span>{/if}{item.name}{#if item.date}<span class="rf-date"> ({item.date})</span>{/if}
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
</style>
