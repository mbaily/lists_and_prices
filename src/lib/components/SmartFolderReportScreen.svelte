<script lang="ts">
	import { docState } from '$lib/yjsStore.svelte';
	import { settings } from '$lib/settings.svelte';
	import {
		readFolders,
		readLists,
		readAllItems,
		isFolderEffectivelyArchived,
		isListEffectivelyArchived
	} from '$lib/data';
	import { getSmartFolders } from '$lib/smartFolders.svelte';

	let { reportName, onBack }: { reportName: string; onBack: () => void } = $props();

	type ItemEntry = { name: string; date: string };
	type ListBlock = { listName: string; items: ItemEntry[] };
	type FolderBlock = { folderName: string; lists: ListBlock[] };

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
				const items = allItems
					.filter((i) => i.listId === list.id && !i.checked && !i.heading && !i.note)
					.sort((a, b) => {
						const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
						const db = b.createdAt ? new Date(b.createdAt).getTime() : 0;
						return db - da;
					});
				if (items.length > 0) {
					blocks.push({
						listName: list.name,
						items: items.map((i) => ({
							name: i.name,
							date: i.createdAt
								? new Date(i.createdAt).toLocaleDateString('en-GB', {
										day: '2-digit',
										month: '2-digit',
										year: '2-digit'
									})
								: ''
						}))
					});
				}
			}
			if (blocks.length > 0) result.push({ folderName: folder.name, lists: blocks });
		}
		return result;
	});

	let copyStatus = $state<'idle' | 'copied'>('idle');

	async function copyAsText() {
		const lines: string[] = [`SMART FOLDER: ${reportName}`, ''];
		if (folderBlocks.length === 0) {
			lines.push('(No uncompleted todos found)');
		} else {
			for (const fb of folderBlocks) {
				lines.push(fb.folderName);
				for (const lb of fb.lists) {
					lines.push(`  ${lb.listName}`);
					for (const item of lb.items) {
						lines.push(`    ${item.name}${item.date ? `  (${item.date})` : ''}`);
					}
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
					<div class="rf-folder-name">{fb.folderName}</div>
					{#each fb.lists as lb}
						<div class="rf-list-block">
							<div class="rf-list-name">{lb.listName}</div>
							{#each lb.items as item}
								<div class="rf-item">
									{item.name}
									{#if item.date}<span class="rf-date">({item.date})</span>{/if}
								</div>
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
		margin-left: 2ch;
		color: #fff;
		word-break: break-word;
	}
	.rf-date {
		color: #888;
		font-size: 0.85em;
	}
	.rf-empty {
		color: #888;
	}
</style>
