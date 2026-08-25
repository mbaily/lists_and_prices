<script lang="ts">
	import { docState, commitState } from '$lib/yjsStore.svelte';
	import {
		readFolders,
		readLists,
		updateFolder,
		updateList,
		saveFavouritesOrder,
		isFolderEffectivelyArchived,
		isListEffectivelyArchived,
		type Folder,
		type ListMeta
	} from '$lib/data';

	let {
		onBack,
		onNavigateFolder,
		onNavigateList
	}: {
		onBack: () => void;
		onNavigateFolder?: (folderId: string) => void;
		onNavigateList?: (listId: string) => void;
	} = $props();

	interface FavEntry {
		id: string;
		type: 'folder' | 'list';
	}

	// Reactive stores of all folders and lists to resolve names, paths, colors, and favourite state
	let allFolders = $derived.by(() => {
		void docState.version;
		try {
			return readFolders();
		} catch {
			return [];
		}
	});

	let allLists = $derived.by(() => {
		void docState.version;
		try {
			return readLists();
		} catch {
			return [];
		}
	});

	// Capture initial favourites on component initialization.
	// As required: "Here you can also unmark items as favourites. (They remain on the screen until you move away from the favourites rearrangement page)."
	// Storing `entries` in component state ensures unmarked items stay on screen until leaving this screen.
	function getInitialFavourites(): FavEntry[] {
		const rawFolders = readFolders().filter((f) => f.favourite && !isFolderEffectivelyArchived(f.id, readFolders()));
		const rawLists = readLists().filter((l) => l.favourite && !isListEffectivelyArchived(l, readFolders()));
		const combined = [
			...rawFolders.map((f) => ({ id: f.id, type: 'folder' as const, order: f.favouriteOrder ?? f.order ?? 0 })),
			...rawLists.map((l) => ({ id: l.id, type: 'list' as const, order: l.favouriteOrder ?? l.order ?? 0 }))
		].sort((a, b) => (a.order !== b.order ? a.order - b.order : a.type === 'folder' && b.type === 'list' ? -1 : a.type === 'list' && b.type === 'folder' ? 1 : 0));

		return combined.map(({ id, type }) => ({ id, type }));
	}

	let entries = $state<FavEntry[]>(getInitialFavourites());

	// Filter out items that have been deleted entirely from Yjs
	let validEntries = $derived(
		entries.filter((entry) =>
			entry.type === 'folder' ? allFolders.some((f) => f.id === entry.id) : allLists.some((l) => l.id === entry.id)
		)
	);

	function folderPath(folder: Folder): string {
		const parts: string[] = [];
		const visited = new Set<string>();
		let fid: string | null = folder.parentId;
		while (fid !== null) {
			if (visited.has(fid)) break;
			visited.add(fid);
			const f = allFolders.find((x) => x.id === fid);
			if (!f) break;
			parts.unshift(f.name);
			fid = f.parentId;
		}
		parts.push(folder.name);
		return parts.join(' › ');
	}

	function listPath(list: ListMeta): string {
		const parts: string[] = [];
		const visited = new Set<string>();
		let fid: string | null = list.folderId;
		while (fid !== null) {
			if (visited.has(fid)) break;
			visited.add(fid);
			const f = allFolders.find((x) => x.id === fid);
			if (!f) break;
			parts.unshift(f.name);
			fid = f.parentId;
		}
		parts.push(list.name);
		return parts.join(' › ');
	}

	function getItemData(entry: FavEntry) {
		if (entry.type === 'folder') {
			const folder = allFolders.find((f) => f.id === entry.id);
			return {
				name: folder?.name ?? '…',
				path: folder ? folderPath(folder) : '…',
				color: folder?.color ?? '#6366f1',
				favourite: folder?.favourite ?? false,
				icon: '📁',
				typeLabel: 'Folder',
				raw: folder
			};
		} else {
			const list = allLists.find((l) => l.id === entry.id);
			return {
				name: list?.name ?? '…',
				path: list ? listPath(list) : '…',
				color: list?.color ?? '#6366f1',
				favourite: list?.favourite ?? false,
				icon: '📝',
				typeLabel: 'List',
				raw: list
			};
		}
	}

	function toggleFavourite(entry: FavEntry) {
		if (commitState.isHistorical) return;
		if (entry.type === 'folder') {
			const f = allFolders.find((x) => x.id === entry.id);
			if (f) {
				updateFolder(f.id, { favourite: !f.favourite });
			}
		} else {
			const l = allLists.find((x) => x.id === entry.id);
			if (l) {
				updateList(l.id, { favourite: !l.favourite });
			}
		}
	}

	function moveItem(index: number, direction: 'up' | 'down') {
		if (commitState.isHistorical) return;
		const targetIndex = direction === 'up' ? index - 1 : index + 1;
		if (targetIndex < 0 || targetIndex >= validEntries.length) return;
		const next = [...validEntries];
		const [moved] = next.splice(index, 1);
		next.splice(targetIndex, 0, moved);
		entries = next;
		saveFavouritesOrder(entries);
	}

	// ── Touch & pointer drag reorder ─────────────────────────────────────────────
	let touchDragFrom = $state<number | null>(null);
	let touchDragOver = $state<number | null>(null);

	function startDrag(e: PointerEvent, index: number) {
		if (commitState.isHistorical) return;
		e.stopPropagation();
		touchDragFrom = index;
		touchDragOver = index;
	}

	$effect(() => {
		if (touchDragFrom === null) return;
		function onMove(e: PointerEvent) {
			e.preventDefault();
			const el = document.elementFromPoint(e.clientX, e.clientY);
			const row = el?.closest('[data-drag-fav-index]') as HTMLElement | null;
			if (row?.dataset.dragFavIndex !== undefined) {
				touchDragOver = parseInt(row.dataset.dragFavIndex, 10);
			}
		}
		function onEnd() {
			if (!commitState.isHistorical && touchDragFrom !== null && touchDragOver !== null && touchDragFrom !== touchDragOver) {
				const from = touchDragFrom;
				const to = touchDragOver;
				const next = [...validEntries];
				const [moved] = next.splice(from, 1);
				next.splice(to, 0, moved);
				entries = next;
				saveFavouritesOrder(entries);
			}
			touchDragFrom = null;
			touchDragOver = null;
		}
		document.addEventListener('pointermove', onMove, { passive: false });
		document.addEventListener('pointerup', onEnd, { once: true });
		document.addEventListener('pointercancel', onEnd, { once: true });
		return () => {
			document.removeEventListener('pointermove', onMove);
			document.removeEventListener('pointerup', onEnd);
			document.removeEventListener('pointercancel', onEnd);
		};
	});

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			onBack();
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="screen">
	<header>
		{#if commitState.isHistorical}
			<div class="historical-banner">
				<span class="historical-label">Viewing Historical Commit (Read Only)</span>
			</div>
		{/if}
		<div class="header-main">
			<button class="back-btn" onclick={onBack} aria-label="Back">← Back</button>
			<div class="title-wrap">
				<span class="title">Rearrange Favourites</span>
				<span class="subtitle">{commitState.isHistorical ? 'Read-only mode' : 'Drag to change order • Tap ★ to add/remove'}</span>
			</div>
		</div>
	</header>

	<div class="content">
		{#if validEntries.length === 0}
			<div class="empty-state">
				<span class="empty-icon">⭐</span>
				<p>No favourites yet.</p>
				<p class="empty-hint">Star folders or lists on the main screen to add them to your favourites bar.</p>
			</div>
		{:else}
			<div class="fav-list">
				{#each validEntries as entry, i (entry.type + ':' + entry.id)}
					{@const data = getItemData(entry)}
					<div
						class="fav-row"
						class:unmarked={!data.favourite}
						class:drag-source={touchDragFrom === i}
						class:drag-above={touchDragOver === i && touchDragFrom !== null && touchDragFrom > i}
						class:drag-below={touchDragOver === i && touchDragFrom !== null && touchDragFrom < i}
						data-drag-fav-index={i}
						style="--row-color: {data.color}"
					>
						{#if !commitState.isHistorical}
							<button
								class="drag-handle"
								aria-label="Drag to reorder"
								onpointerdown={(e) => startDrag(e, i)}
							>☰</button>

							<div class="step-buttons">
								<button
									class="step-btn"
									disabled={i === 0}
									onclick={() => moveItem(i, 'up')}
									aria-label="Move up"
									title="Move up"
								>▲</button>
								<button
									class="step-btn"
									disabled={i === validEntries.length - 1}
									onclick={() => moveItem(i, 'down')}
									aria-label="Move down"
									title="Move down"
								>▼</button>
							</div>
						{/if}

						<span class="fav-icon" title={data.typeLabel}>{data.icon}</span>

						<button
							class="fav-name-btn"
							title={data.path}
							onclick={() => {
								if (entry.type === 'folder' && onNavigateFolder) {
									onNavigateFolder(entry.id);
								} else if (entry.type === 'list' && onNavigateList) {
									onNavigateList(entry.id);
								}
							}}
						>
							<span class="fav-path-text">{data.path}</span>
						</button>

						{#if !data.favourite}
							<span class="unmarked-pill">Unmarked</span>
						{/if}

						<button
							class="star-btn"
							class:active={data.favourite}
							onclick={() => toggleFavourite(entry)}
							aria-label={data.favourite ? 'Remove from favourites' : 'Add to favourites'}
							title={data.favourite ? 'Remove from favourites' : 'Add to favourites'}
						>
							{data.favourite ? '★' : '☆'}
						</button>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>

<style>
	.screen {
		display: flex;
		flex-direction: column;
		height: 100dvh;
		background: var(--bg);
		color: var(--text);
	}
	header {
		display: flex;
		flex-direction: column;
		border-bottom: 1px solid var(--border);
		background: var(--bg2);
		flex-shrink: 0;
	}
	.header-main {
		display: flex;
		align-items: center;
		padding: 0.65rem 1rem;
		gap: 0.75rem;
	}
	.historical-banner {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0.35rem 1rem;
		background: #dc2626;
		color: #fff;
		font-size: 0.82rem;
		font-weight: 600;
	}
	.back-btn {
		background: none;
		border: 1px solid var(--border);
		border-radius: 6px;
		color: var(--text);
		padding: 0.35rem 0.75rem;
		cursor: pointer;
		font-size: 0.9rem;
		white-space: nowrap;
		flex-shrink: 0;
	}
	.back-btn:hover {
		background: var(--bg3);
	}
	.title-wrap {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		overflow: hidden;
	}
	.title {
		font-size: 1.05rem;
		font-weight: 700;
		color: var(--text);
		line-height: 1.2;
	}
	.subtitle {
		font-size: 0.75rem;
		color: var(--text2);
		line-height: 1.2;
	}
	.content {
		flex: 1;
		overflow-y: auto;
		padding: 0;
		max-width: 650px;
		width: 100%;
		margin: 0 auto;
		box-sizing: border-box;
	}
	.empty-state {
		text-align: center;
		padding: 3rem 1.5rem;
		color: var(--text2);
	}
	.empty-icon {
		font-size: 2.5rem;
		display: block;
		margin-bottom: 0.5rem;
	}
	.empty-state p {
		margin: 0.25rem 0;
		font-size: 1.05rem;
		font-weight: 600;
		color: var(--text);
	}
	.empty-hint {
		font-size: 0.85rem !important;
		font-weight: 400 !important;
		color: var(--text2) !important;
		max-width: 320px;
		margin: 0.5rem auto 0 !important;
		line-height: 1.4;
	}
	.fav-list {
		display: flex;
		flex-direction: column;
		gap: 0;
	}
	.fav-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.35rem 0.75rem 0.35rem 1.1rem;
		background: transparent;
		border: none;
		border-bottom: 1px solid var(--border);
		touch-action: pan-y;
		position: relative;
		transition: background 0.15s ease, opacity 0.15s ease;
		user-select: none;
	}
	.fav-row::before {
		content: '';
		position: absolute;
		left: 0;
		top: 0;
		bottom: 0;
		width: 4px;
		background: var(--row-color, transparent);
	}
	.fav-row:hover {
		background: var(--bg2);
	}
	.fav-row.unmarked {
		opacity: 0.5;
	}
	.fav-row.unmarked .fav-path-text {
		text-decoration: line-through;
	}
	.fav-row.drag-source {
		opacity: 0.35;
	}
	.fav-row.drag-above {
		background: var(--bg3);
		box-shadow: inset 0 2px 0 var(--accent);
	}
	.fav-row.drag-below {
		background: var(--bg3);
		box-shadow: inset 0 -2px 0 var(--accent);
	}
	.drag-handle {
		background: none;
		border: none;
		color: var(--text2);
		font-size: 1.1rem;
		cursor: grab;
		padding: 0.15rem 0.2rem;
		line-height: 1;
		flex-shrink: 0;
		touch-action: none;
	}
	.drag-handle:active {
		cursor: grabbing;
		color: var(--accent);
	}
	.step-buttons {
		display: flex;
		flex-direction: column;
		gap: 1px;
		flex-shrink: 0;
	}
	.step-btn {
		background: none;
		border: none;
		color: var(--text2);
		font-size: 0.52rem;
		cursor: pointer;
		padding: 0.1rem 0.2rem;
		line-height: 1;
		border-radius: 2px;
	}
	.step-btn:hover:not(:disabled) {
		background: var(--bg3);
		color: var(--text);
	}
	.step-btn:disabled {
		opacity: 0.2;
		cursor: default;
	}
	.fav-icon {
		font-size: 0.95rem;
		flex-shrink: 0;
		line-height: 1;
	}
	.fav-name-btn {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		background: none;
		border: none;
		padding: 0;
		color: var(--text);
		font-size: 0.92rem;
		font-weight: 500;
		text-align: left;
		cursor: pointer;
		overflow: hidden;
	}
	.fav-path-text {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.fav-name-btn:hover .fav-path-text {
		text-decoration: underline;
	}
	.unmarked-pill {
		font-size: 0.68rem;
		padding: 0.05rem 0.4rem;
		border-radius: 999px;
		background: #ef4444;
		color: #fff;
		font-weight: 600;
		flex-shrink: 0;
	}
	.star-btn {
		background: none;
		border: none;
		font-size: 1.25rem;
		cursor: pointer;
		padding: 0.15rem 0.25rem;
		line-height: 1;
		color: var(--text2);
		flex-shrink: 0;
		transition: color 0.15s ease, transform 0.1s ease;
	}
	.star-btn.active {
		color: #f59e0b;
	}
	.star-btn:hover {
		transform: scale(1.15);
	}
</style>
