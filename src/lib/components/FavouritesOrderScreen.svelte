<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { docState, commitState } from '$lib/yjsStore.svelte';
	import {
		readFolders,
		readLists,
		readFavouriteFolders,
		buildFavouriteEntries,
		createFavouriteFolder,
		renameFavouriteFolder,
		deleteFavouriteFolder,
		canMoveFavouriteFolder,
		moveFavourite,
		toggleFavourite,
		saveFavouritesOrder,
		favouriteKey,
		favouritePath,
		type FavouriteEntry
	} from '$lib/data';
	import RowMenu from './RowMenu.svelte';

	let {
		onBack,
		onNavigateFolder,
		onNavigateList,
		favouriteFolderId = $bindable(null)
	}: {
		onBack: () => void;
		onNavigateFolder?: (folderId: string) => void;
		onNavigateList?: (listId: string) => void;
		favouriteFolderId?: string | null;
	} = $props();

	type EntryRef = { id: string; type: FavouriteEntry['type'] };
	type Edit = { kind: 'create'; parentId: string | null }
		| { kind: 'rename' | 'delete' | 'move'; ref: EntryRef };

	const data = $derived.by(() => {
		void docState.version;
		return { folders: readFolders(), lists: readLists(), groups: readFavouriteFolders() };
	});

	// Keep locally unstarred entries available for re-starring until this screen closes.
	let retained = $state(new Set<string>());
	const entries = $derived(buildFavouriteEntries(data.folders, data.lists, data.groups, retained));
	const currentFolder = $derived(data.groups.find(group => group.id === favouriteFolderId));
	const currentId = $derived(currentFolder?.id ?? null);
	const currentPath = $derived(currentFolder ? favouritePath(currentFolder.name, currentFolder.parentId, data.groups) : 'Top level');
	const validEntries = $derived(entries.filter(entry => entry.parentId === currentId));

	let edit = $state<Edit | null>(null);
	let name = $state('');
	let moveTo = $state<string | null | undefined>();
	let editForm: HTMLFormElement | undefined = $state();
	let nameInput: HTMLInputElement | undefined = $state();
	let moveSelect: HTMLSelectElement | undefined = $state();
	const editRef = $derived(edit && edit.kind !== 'create' ? edit.ref : null);
	const editEntry = $derived(editRef ? entries.find(entry => entry.type === editRef.type && entry.item.id === editRef.id) : undefined);
	const moveTargets = $derived(editEntry && edit?.kind === 'move'
		? data.groups
			.filter(group => group.id !== editEntry.parentId &&
				(editEntry.type !== 'favourites-folder' || canMoveFavouriteFolder(data.groups, editEntry.item.id, group.id)))
			.map(group => ({ id: group.id, path: favouritePath(group.name, group.parentId, data.groups) }))
			.sort((a, b) => a.path.localeCompare(b.path))
		: []);

	function entryRef(entry: FavouriteEntry): EntryRef {
		return { type: entry.type, id: entry.item.id };
	}

	function editFolder(kind: Edit['kind'], entry?: FavouriteEntry) {
		if (commitState.isHistorical) return;
		if (kind === 'create') edit = { kind, parentId: currentId };
		else if (entry) edit = { kind, ref: entryRef(entry) };
		name = kind === 'rename' ? (entry?.item.name ?? '') : '';
		moveTo = undefined;
		void tick().then(() => {
			editForm?.scrollIntoView({ block: 'nearest' });
			(nameInput ?? moveSelect ?? editForm?.querySelector<HTMLButtonElement>('button[type="button"]'))?.focus();
		});
	}

	function submitEdit(event: SubmitEvent) {
		event.preventDefault();
		if (!edit || commitState.isHistorical) return;
		if (edit.kind === 'create') {
			createFavouriteFolder(name, edit.parentId);
		} else if (editEntry) {
			if (edit.kind === 'rename') renameFavouriteFolder(edit.ref.id, name);
			else if (edit.kind === 'delete') deleteFavouriteFolder(edit.ref.id);
			else if (moveTo !== undefined) moveFavourite(edit.ref, moveTo);
		}
		edit = null;
	}

	function navigate(entry: FavouriteEntry) {
		edit = null;
		if (entry.type === 'favourites-folder') favouriteFolderId = entry.item.id;
		else if (entry.type === 'folder') onNavigateFolder?.(entry.item.id);
		else onNavigateList?.(entry.item.id);
	}

	function toggleShortcut(entry: FavouriteEntry) {
		if (entry.type === 'favourites-folder' || commitState.isHistorical) return;
		if (entry.item.favourite) retained = new Set([...retained, favouriteKey(entryRef(entry))]);
		toggleFavourite(entry.type, entry.item.id, true);
	}

	function moveItem(index: number, targetIndex: number) {
		if (commitState.isHistorical || index === targetIndex || !validEntries[index] || !validEntries[targetIndex]) return;
		const next = validEntries.map(entryRef);
		const [moved] = next.splice(index, 1);
		next.splice(targetIndex, 0, moved);
		saveFavouritesOrder(currentId, next);
	}

	let touchDragFrom = $state<number | null>(null);
	let touchDragOver = $state<number | null>(null);

	$effect.pre(() => {
		void commitState.isHistorical;
		void commitState.commitId;
		untrack(() => {
			touchDragFrom = null;
			touchDragOver = null;
			retained = new Set();
			edit = null;
		});
	});

	function startDrag(event: PointerEvent, index: number) {
		if (commitState.isHistorical || event.button !== 0) return;
		event.stopPropagation();
		touchDragFrom = index;
		touchDragOver = index;
	}

	$effect(() => {
		if (touchDragFrom === null) return;
		const sourceId = untrack(() => currentId);
		const sourceEntries = untrack(() => validEntries.map(entry => favouriteKey(entryRef(entry))));
		function onMove(event: PointerEvent) {
			event.preventDefault();
			const row = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-drag-fav-index]');
			if (row?.dataset.dragFavIndex !== undefined) touchDragOver = Number(row.dataset.dragFavIndex);
		}
		function onEnd() {
			const unchanged = sourceId === currentId && sourceEntries.length === validEntries.length &&
				sourceEntries.every((key, i) => key === favouriteKey(entryRef(validEntries[i])));
			if (unchanged && touchDragFrom !== null && touchDragOver !== null) moveItem(touchDragFrom, touchDragOver);
			onCancel();
		}
		function onCancel() {
			touchDragFrom = null;
			touchDragOver = null;
		}
		document.addEventListener('pointermove', onMove, { passive: false });
		document.addEventListener('pointerup', onEnd, { once: true });
		document.addEventListener('pointercancel', onCancel, { once: true });
		return () => {
			document.removeEventListener('pointermove', onMove);
			document.removeEventListener('pointerup', onEnd);
			document.removeEventListener('pointercancel', onCancel);
		};
	});

	function goUp() {
		edit = null;
		if (currentFolder) favouriteFolderId = currentFolder.parentId;
		else onBack();
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key !== 'Escape' || event.defaultPrevented) return;
		if (edit) edit = null;
		else goUp();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="screen">
	<header>
		{#if commitState.isHistorical}
			<div class="historical-banner">Viewing Historical Commit (Read Only)</div>
		{/if}
		<div class="header-main">
			<button class="back-btn" onclick={onBack}>← Back</button>
			<div class="title-wrap">
				<span class="title">Rearrange Favourites</span>
				<span class="subtitle" title={currentPath}>{currentPath}</span>
			</div>
			{#if !commitState.isHistorical}
				<button class="back-btn new-folder" onclick={() => editFolder('create')}>+ New folder</button>
			{/if}
		</div>
	</header>

	<div class="content">
		{#if currentFolder}
			<div class="level-controls">
				<button class="back-btn" onclick={goUp}>↑ Up one level</button>
			</div>
		{/if}
		{#if edit && !commitState.isHistorical}
			<form class="folder-form" bind:this={editForm} onsubmit={submitEdit}>
				{#if edit.kind === 'create' || (edit.kind === 'rename' && editEntry)}
					<label>
						{edit.kind === 'create' ? 'New Favourites folder' : 'Rename Favourites folder'}
						<input bind:this={nameInput} bind:value={name} placeholder="Folder name" required />
					</label>
					<div class="form-actions">
						<button class="back-btn" type="submit" disabled={!name.trim()}>{edit.kind === 'create' ? 'Create' : 'Save'}</button>
						<button class="back-btn" type="button" onclick={() => edit = null}>Cancel</button>
					</div>
				{:else if edit.kind === 'move' && editEntry}
					<label>
						Move {editEntry.item.name} to
						<select bind:this={moveSelect} bind:value={moveTo} required>
							<option value={undefined} disabled>Choose a Favourites folder</option>
							{#if editEntry.parentId !== null}<option value={null}>Top level</option>{/if}
							{#each moveTargets as target (target.id)}
								<option value={target.id}>{target.path}</option>
							{/each}
						</select>
					</label>
					<div class="form-actions">
						<button class="back-btn" type="submit" disabled={moveTo === undefined}>Move</button>
						<button class="back-btn" type="button" onclick={() => edit = null}>Cancel</button>
					</div>
				{:else if edit.kind === 'delete' && editEntry}
					<p>Delete “{editEntry.item.name}”? Its contents will move up one level.</p>
					<div class="form-actions">
						<button class="back-btn delete" type="submit">Delete folder</button>
						<button class="back-btn" type="button" onclick={() => edit = null}>Cancel</button>
					</div>
				{:else}
					<p>This favourite is no longer available.</p>
					<button class="back-btn" type="button" onclick={() => edit = null}>Close</button>
				{/if}
			</form>
		{/if}
		{#if validEntries.length === 0}
			<div class="empty-state">
				<p>{currentFolder ? 'This Favourites folder is empty.' : 'No favourites yet.'}</p>
				{#if !currentFolder}
					<p class="empty-hint">Star a list or an app folder to add a shortcut.</p>
				{/if}
			</div>
		{:else}
			<div class="fav-list">
				{#each validEntries as entry, i (favouriteKey(entryRef(entry)))}
					{@const isGroup = entry.type === 'favourites-folder'}
					{@const marked = entry.type === 'favourites-folder' || entry.item.favourite}
					{@const path = entry.type === 'favourites-folder' ? entry.item.name : favouritePath(entry.item.name, entry.type === 'folder' ? entry.item.parentId : entry.item.folderId, data.folders)}
					<div
						class="fav-row"
						class:unmarked={!marked}
						class:drag-source={touchDragFrom === i}
						class:drag-above={touchDragOver === i && touchDragFrom !== null && touchDragFrom > i}
						class:drag-below={touchDragOver === i && touchDragFrom !== null && touchDragFrom < i}
						data-drag-fav-index={i}
						style:--row-color={entry.type === 'favourites-folder' ? 'var(--accent)' : entry.item.color}
					>
						{#if !commitState.isHistorical}
							<button class="drag-handle" aria-label="Drag to reorder" onpointerdown={(event) => startDrag(event, i)}>☰</button>
							<div class="step-buttons">
								<button class="step-btn" disabled={i === 0} onclick={() => moveItem(i, i - 1)} aria-label="Move up" title="Move up">▲</button>
								<button class="step-btn" disabled={i === validEntries.length - 1} onclick={() => moveItem(i, i + 1)} aria-label="Move down" title="Move down">▼</button>
							</div>
						{/if}

						<span class="fav-icon" aria-hidden="true">{entry.type === 'list' ? '📝' : isGroup ? '⭐' : '📁'}</span>
						<button
							class="fav-name-btn"
							title={path}
							aria-label={isGroup ? 'Open Favourites folder ' + entry.item.name : undefined}
							onclick={() => navigate(entry)}
						>
							<span class="fav-path-text">{path}{isGroup ? ' ›' : ''}</span>
						</button>

						{#if !marked}
							<span class="unmarked-pill">Unmarked</span>
						{/if}
						{#if !isGroup}
							<button
								class="star-btn"
								class:active={marked}
								disabled={commitState.isHistorical}
								onclick={() => toggleShortcut(entry)}
								aria-label={marked ? 'Remove from favourites' : 'Add to favourites'}
								title={marked ? 'Remove from favourites' : 'Add to favourites'}
							>{marked ? '★' : '☆'}</button>
						{/if}
						{#if !commitState.isHistorical && marked}
							{@const canMove = currentId !== null || data.groups.some(group => !isGroup || canMoveFavouriteFolder(data.groups, entry.item.id, group.id))}
							{#if canMove || isGroup}
								<RowMenu items={[
									...(canMove ? [{ label: 'Move to…', action: () => editFolder('move', entry) }] : []),
									...(isGroup ? [
										{ label: 'Rename', action: () => editFolder('rename', entry) },
										{ label: 'Delete folder', danger: true, action: () => editFolder('delete', entry) }
									] : [])
								]} />
							{/if}
						{/if}
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
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
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
	.new-folder { margin-inline-start: auto; }
	.level-controls { padding: 0.55rem 1rem; }
	.folder-form {
		display: grid;
		gap: 0.75rem;
		padding: 0.85rem 1rem;
		border-bottom: 1px solid var(--border);
		background: var(--bg2);
	}
	.folder-form p { margin: 0; }
	.folder-form label {
		display: grid;
		gap: 0.35rem;
		font-size: 0.9rem;
		font-weight: 600;
	}
	.folder-form input, .folder-form select {
		min-width: 0;
		padding: 0.4rem 0.55rem;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--bg);
		color: var(--text);
		font: inherit;
	}
	.form-actions { display: flex; flex-wrap: wrap; gap: 0.5rem; }
	.form-actions .back-btn:disabled { opacity: 0.5; cursor: default; }
	.delete { color: #dc2626; }
	.empty-state {
		text-align: center;
		padding: 3rem 1.5rem;
		color: var(--text2);
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
	.star-btn:disabled { cursor: default; opacity: 0.6; }
	.star-btn:hover:not(:disabled) {
		transform: scale(1.15);
	}
</style>
