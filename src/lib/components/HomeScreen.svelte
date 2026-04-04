<script lang="ts">
	import {
		readFolders,
		readLists,
		createFolder,
		createList,
		deleteFolder,
		deleteList,
		updateFolder,
		updateList,
		reorderFolders,
		reorderLists,
		isDescendant,
		type Folder,
		type ListMeta
	} from '$lib/data';
	import { syncState, docState } from '$lib/yjsStore.svelte';
	import ListScreen from './ListScreen.svelte';
	import ColorPicker from './ColorPicker.svelte';
	import SettingsScreen from './SettingsScreen.svelte';
	import SyncBadge from './SyncBadge.svelte';
	import ConfirmDialog from './ConfirmDialog.svelte';

	let { onLogout }: { onLogout: () => void } = $props();

	// ── Navigation state ────────────────────────────────────────────────────────
	// breadcrumb is an array of folder ids. null means root.
	let breadcrumb = $state<(string | null)[]>([null]);
	let currentFolderId = $derived(breadcrumb[breadcrumb.length - 1]);

	// ── View state ──────────────────────────────────────────────────────────────
	let openListId = $state<string | null>(null);
	let showSettings = $state(false);

	// ── Live data (re-read on every Yjs change) ─────────────────────────────────
	// docState.version increments on every Yjs update, making these $derived re-run.
	let allFolders = $derived.by(() => {
		void docState.version; // track version
		try { return readFolders(); } catch { return []; }
	});
	let allLists = $derived.by(() => {
		void docState.version;
		try { return readLists(); } catch { return []; }
	});

	let childFolders = $derived(
		allFolders
			.filter((f) => f.parentId === currentFolderId)
			.sort((a, b) => a.order - b.order)
	);
	let childLists = $derived(
		allLists
			.filter((l) => l.folderId === currentFolderId)
			.sort((a, b) => a.order - b.order)
	);
	let currentFolderColor = $derived(
		allFolders.find((f) => f.id === currentFolderId)?.color ?? '#6366f1'
	);

	// ── Guard: trim breadcrumb if a folder in it was deleted (e.g. by a peer) ───
	$effect(() => {
		// allFolders is a reactive dependency; re-run whenever folders change.
		const ids = new Set(allFolders.map((f) => f.id));
		// Find the deepest breadcrumb entry that still exists (null = root always valid)
		const lastValid = breadcrumb.findLastIndex((id) => id === null || ids.has(id));
		if (lastValid < breadcrumb.length - 1) {
			breadcrumb = breadcrumb.slice(0, lastValid + 1);
		}
		// Close list screen if the open list has been deleted by a peer
		if (openListId !== null && !allLists.some((l) => l.id === openListId)) {
			openListId = null;
		}
	});

	// ── Breadcrumb label ────────────────────────────────────────────────────────
	function folderName(id: string | null): string {
		if (id === null) return 'Home';
		return allFolders.find((f) => f.id === id)?.name ?? '…';
	}

	// ── Create folder ────────────────────────────────────────────────────────────
	let newFolderName = $state('');
	let newFolderColor = $state('#6366f1');
	let showNewFolder = $state(false);

	function submitNewFolder() {
		if (!newFolderName.trim()) return;
		createFolder(newFolderName.trim(), currentFolderId, newFolderColor);
		newFolderName = '';
		showNewFolder = false;
	}

	// ── Create list ──────────────────────────────────────────────────────────────
	let newListName = $state('');
	let newListType = $state<'plain' | 'priced'>('plain');
	let newListColor = $state('#6366f1');
	let showNewList = $state(false);

	function openNewList() {
		newListColor = currentFolderColor;
		showNewList = true;
	}

	function submitNewList() {
		const name =
			newListName.trim() ||
			new Date().toLocaleString('en-GB', {
				day: '2-digit',
				month: '2-digit',
				year: '2-digit',
				hour: '2-digit',
				minute: '2-digit'
			});
		if (!currentFolderId) {
			alert('Please create a folder first.');
			return;
		}
		createList(name, currentFolderId!, newListType, newListColor);
		newListName = '';
		showNewList = false;
	}

	// ── Delete confirmation ──────────────────────────────────────────────────────
	let confirmMsg = $state('');
	let confirmAction = $state<(() => void) | null>(null);

	function askDelete(msg: string, action: () => void) {
		confirmMsg = msg;
		confirmAction = () => action();
	}

	// ── Rename ───────────────────────────────────────────────────────────────────
	let renamingId = $state<string | null>(null);
	let renameValue = $state('');
	let renameTarget = $state<'folder' | 'list'>('folder');

	function startRename(id: string, current: string, target: 'folder' | 'list') {
		renamingId = id;
		renameValue = current;
		renameTarget = target;
	}

	function submitRename() {
		if (renamingId && renameValue.trim()) {
			if (renameTarget === 'folder') updateFolder(renamingId, { name: renameValue.trim() });
			else updateList(renamingId, { name: renameValue.trim() });
		}
		// Always close the rename input, even if empty (discard)
		renamingId = null;
	}

	// ── Move ─────────────────────────────────────────────────────────────────────
	let movingListId = $state<string | null>(null);
	let movingFolderId = $state<string | null>(null);

	function moveListTo(targetFolderId: string) {
		if (!movingListId) return;
		updateList(movingListId, { folderId: targetFolderId });
		movingListId = null;
	}

	function moveFolderTo(targetParentId: string | null) {
		if (!movingFolderId) return;
		if (targetParentId !== null && isDescendant(movingFolderId, targetParentId)) {
			alert('Cannot move a folder into one of its own sub-folders.');
			return;
		}
		updateFolder(movingFolderId, { parentId: targetParentId });
		movingFolderId = null;
	}

	// ── Touch drag reorder ────────────────────────────────────────────────────────
	// HTML5 drag doesn't work on iOS — use touch events instead.
	// 'folder' or 'list' drag, tracked independently.
	type DragKind = 'folder' | 'list';
	let touchDragKind = $state<DragKind | null>(null);
	let touchDragFrom = $state<number | null>(null);
	let touchDragOver = $state<number | null>(null);

	function startDrag(e: TouchEvent, kind: DragKind, index: number) {
		e.stopPropagation();
		touchDragKind = kind;
		touchDragFrom = index;
		touchDragOver = index;
	}

	$effect(() => {
		if (touchDragFrom === null) return;
		const kind = touchDragKind;
		function onMove(e: TouchEvent) {
			e.preventDefault();
			const touch = e.touches[0];
			const el = document.elementFromPoint(touch.clientX, touch.clientY);
			const row = el?.closest('[data-drag-kind]') as HTMLElement | null;
			if (row?.dataset.dragKind === kind && row.dataset.dragIndex !== undefined) {
				touchDragOver = parseInt(row.dataset.dragIndex, 10);
			}
		}
		function onEnd() {
			if (touchDragFrom !== null && touchDragOver !== null && touchDragFrom !== touchDragOver) {
				if (kind === 'folder') reorderFolders(currentFolderId, touchDragFrom, touchDragOver);
				else reorderLists(currentFolderId!, touchDragFrom, touchDragOver);
			}
			touchDragKind = null;
			touchDragFrom = null;
			touchDragOver = null;
		}
		document.addEventListener('touchmove', onMove, { passive: false });
		document.addEventListener('touchend', onEnd, { once: true });
		return () => {
			document.removeEventListener('touchmove', onMove);
			document.removeEventListener('touchend', onEnd);
		};
	});

	// ── First-launch guard ───────────────────────────────────────────────────────
	let showFirstLaunch = $derived(allFolders.length === 0 && !showNewFolder);
</script>

{#if openListId}
	<ListScreen listId={openListId} onBack={() => (openListId = null)} onHome={() => { openListId = null; breadcrumb = [null]; }} />
{:else if showSettings}
	<SettingsScreen onBack={() => (showSettings = false)} {onLogout} />
{:else}
	<div class="screen">
		<!-- Header -->
		<header>
			<div class="breadcrumb">
				{#each breadcrumb as crumbId, i}
					{#if i < breadcrumb.length - 1}
						<button class="crumb" onclick={() => (breadcrumb = breadcrumb.slice(0, i + 1))}>
							{folderName(crumbId)}
						</button>
						<span class="sep">/</span>
					{:else}
						<span class="crumb current">{folderName(crumbId)}</span>
					{/if}
				{/each}
			</div>
			<div class="header-actions">
				<SyncBadge status={syncState.status} />
				<button class="icon-btn" onclick={() => (showSettings = true)} aria-label="Settings">
					⚙
				</button>
			</div>
		</header>

		<!-- Up button -->
		{#if breadcrumb.length > 1}
			<button class="up-btn" onclick={() => (breadcrumb = breadcrumb.slice(0, -1))}>
				↑ Up
			</button>
		{/if}

		<!-- First-launch prompt -->
		{#if showFirstLaunch}
			<div class="empty-prompt">
				<p>Welcome! Create your first folder to get started.</p>
				<button onclick={() => (showNewFolder = true)}>Create Folder</button>
			</div>
		{/if}

		<!-- Folders -->
		{#each childFolders as folder, i}
			<div
				class="row folder-row"
				class:done={folder.done}
				class:drag-source={touchDragKind === 'folder' && touchDragFrom === i}
				class:drag-target={touchDragKind === 'folder' && touchDragOver === i && touchDragFrom !== i}
				data-drag-kind="folder"
				data-drag-index={i}
				style="--row-color:{folder.color}"
			>
				<button class="check-circle" onclick={() => updateFolder(folder.id, { done: !folder.done })} aria-label={folder.done ? 'Unmark complete' : 'Mark complete'}>
					{folder.done ? '☑' : '☐'}
				</button>
				{#if renamingId === folder.id}
					<input
						class="rename-input"
						bind:value={renameValue}
						onblur={submitRename}
						onkeydown={(e) => e.key === 'Enter' && submitRename()}
						autofocus
					/>
				{:else}
					<button
						class="row-name"
						onclick={() => (breadcrumb = [...breadcrumb, folder.id])}
					>
						📁 {folder.name}
					</button>
				{/if}
				<div class="row-actions">
					<button onclick={() => startRename(folder.id, folder.name, 'folder')} aria-label="Rename">✏</button>
					<button
						onclick={() =>
							askDelete(`Delete folder "${folder.name}" and all its contents?`, () =>
								deleteFolder(folder.id))}
						aria-label="Delete"
					>🗑</button>
					<button onclick={() => (movingFolderId = movingFolderId === folder.id ? null : folder.id)} aria-label="Move">
						{movingFolderId === folder.id ? '✕' : '↗'}
					</button>
					<button class="drag-handle" aria-label="Drag to reorder" ontouchstart={(e) => startDrag(e, 'folder', i)}>⠿</button>
				</div>
			</div>
		{/each}

		<!-- Lists -->
		{#each childLists as list, i}
			<div
				class="row list-row"
				class:done={list.done}
				class:drag-source={touchDragKind === 'list' && touchDragFrom === i}
				class:drag-target={touchDragKind === 'list' && touchDragOver === i && touchDragFrom !== i}
				data-drag-kind="list"
				data-drag-index={i}
				style="--row-color:{list.color}"
			>
				<button class="check-circle" onclick={() => updateList(list.id, { done: !list.done })} aria-label={list.done ? 'Unmark complete' : 'Mark complete'}>
					{list.done ? '☑' : '☐'}
				</button>
				{#if renamingId === list.id}
					<input
						class="rename-input"
						bind:value={renameValue}
						onblur={submitRename}
						onkeydown={(e) => e.key === 'Enter' && submitRename()}
						autofocus
					/>
				{:else}
					<button class="row-name" onclick={() => (openListId = list.id)}>
						{list.type === 'priced' ? '💰' : '📋'} {list.name}
					</button>
				{/if}
				<div class="row-actions">
					<button onclick={() => startRename(list.id, list.name, 'list')} aria-label="Rename">✏</button>
					<button
						onclick={() =>
							askDelete(`Delete list "${list.name}"?`, () => deleteList(list.id))}
						aria-label="Delete"
					>🗑</button>
					<button onclick={() => (movingListId = movingListId === list.id ? null : list.id)} aria-label="Move">
						{movingListId === list.id ? '✕' : '↗'}
					</button>
					<button class="drag-handle" aria-label="Drag to reorder" ontouchstart={(e) => startDrag(e, 'list', i)}>⠿</button>
				</div>
			</div>
		{/each}

		<!-- Move target UI -->
		{#if movingFolderId || movingListId}
			<div class="move-panel">
				<p>{movingFolderId ? 'Move folder to:' : 'Move list to:'}</p>
				{#if movingFolderId}
					<button onclick={() => moveFolderTo(null)}>Root</button>
				{/if}
				{#each allFolders as f}
					<button
						onclick={() =>
							movingFolderId ? moveFolderTo(f.id) : moveListTo(f.id)}
					>{f.name}</button>
				{/each}
				<button onclick={() => { movingFolderId = null; movingListId = null; }}>Cancel</button>
			</div>
		{/if}

		<!-- Action bar -->
		<div class="action-bar">
			<button onclick={() => (showNewFolder = true)}>+ Folder</button>
			{#if currentFolderId}
				<button onclick={() => openNewList()}>+ List</button>
			{/if}
		</div>

		<!-- New folder form -->
		{#if showNewFolder}
			<div class="modal-backdrop">
				<div class="modal">
					<h2>New Folder</h2>
					<input
						placeholder="Folder name"
						bind:value={newFolderName}
						onkeydown={(e) => e.key === 'Enter' && submitNewFolder()}
						autofocus
					/>
					<ColorPicker bind:value={newFolderColor} />
					<div class="modal-actions">
						<button onclick={submitNewFolder} disabled={!newFolderName.trim()}>Create</button>
						<button onclick={() => (showNewFolder = false)}>Cancel</button>
					</div>
				</div>
			</div>
		{/if}

		<!-- New list form -->
		{#if showNewList}
			<div class="modal-backdrop">
				<div class="modal">
					<h2>New List</h2>
					<input placeholder="Name (optional)" bind:value={newListName} />
					<div class="type-toggle">
						<button
							class:active={newListType === 'plain'}
							onclick={() => (newListType = 'plain')}
						>Plain</button>
						<button
							class:active={newListType === 'priced'}
							onclick={() => (newListType = 'priced')}
						>Priced</button>
					</div>
					<ColorPicker bind:value={newListColor} />
					<div class="modal-actions">
						<button onclick={submitNewList}>Create</button>
						<button onclick={() => (showNewList = false)}>Cancel</button>
					</div>
				</div>
			</div>
		{/if}

		<!-- Confirm dialog -->
		{#if confirmAction}
			<ConfirmDialog
				message={confirmMsg}
				onConfirm={() => { confirmAction?.(); confirmAction = null; }}
				onCancel={() => (confirmAction = null)}
			/>
		{/if}
	</div>
{/if}

<style>
	.screen {
		min-height: 100dvh;
		background: var(--bg);
		display: flex;
		flex-direction: column;
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.75rem 1rem;
		background: var(--bg2);
		border-bottom: 1px solid var(--border);
		gap: 0.5rem;
	}
	.breadcrumb {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		flex-wrap: wrap;
		font-size: 0.85rem;
	}
	.crumb {
		background: none;
		border: none;
		color: var(--accent);
		cursor: pointer;
		padding: 0;
		font-size: inherit;
	}
	.crumb.current {
		color: var(--text);
		font-weight: 600;
		cursor: default;
	}
	.sep { color: var(--text2); }
	.header-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.icon-btn {
		background: none;
		border: none;
		font-size: 1.3rem;
		cursor: pointer;
		padding: 0.25rem;
		color: var(--text);
	}
	.up-btn {
		margin: 0.5rem 1rem 0;
		background: var(--bg3);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 0.5rem 1rem;
		font-size: 0.9rem;
		color: var(--text);
		cursor: pointer;
		align-self: flex-start;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.65rem 1rem;
		border-bottom: 1px solid var(--border);
		min-height: 52px;
		transition: background 0.15s, opacity 0.15s;
	}
	.row.drag-source { opacity: 0.4; }
	.row.drag-target { background: var(--bg3); box-shadow: inset 0 2px 0 var(--accent); }
	.row.done { opacity: 0.55; }
	.row.done .row-name { text-decoration: line-through; color: var(--text2); }
	.check-circle {
		background: none;
		border: none;
		font-size: 1.3rem;
		cursor: pointer;
		padding: 0;
		flex-shrink: 0;
		min-width: 36px;
		min-height: 44px;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--row-color, var(--accent));
	}
	.dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: var(--row-color, var(--accent));
		flex-shrink: 0;
	}
	.row-name {
		flex: 1;
		background: none;
		border: none;
		text-align: left;
		font-size: 1rem;
		color: var(--text);
		cursor: pointer;
		padding: 0;
	}
	.row-actions {
		display: flex;
		gap: 0.25rem;
		align-items: center;
	}
	.row-actions button {
		background: none;
		border: none;
		font-size: 1rem;
		cursor: pointer;
		color: var(--text2);
		min-width: 40px;
		min-height: 44px;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0;
	}
	.drag-handle {
		cursor: grab;
		color: var(--text2);
		font-size: 1.3rem;
		user-select: none;
		-webkit-user-select: none;
		touch-action: none;
		min-width: 44px;
		min-height: 44px;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.drag-handle:active { color: var(--accent); }
	.rename-input {
		flex: 1;
		border: 1px solid var(--accent);
		border-radius: 6px;
		padding: 0.3rem 0.5rem;
		font-size: 1rem;
		background: var(--bg2);
		color: var(--text);
	}
	.action-bar {
		display: flex;
		gap: 0.75rem;
		padding: 0.75rem 1rem;
		margin-top: auto;
		border-top: 1px solid var(--border);
		background: var(--bg2);
	}
	.action-bar button {
		flex: 1;
		padding: 0.7rem;
		background: var(--accent);
		color: #fff;
		border: none;
		border-radius: 10px;
		font-size: 0.95rem;
		font-weight: 600;
		cursor: pointer;
	}
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0,0,0,0.4);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 50;
		padding: 1rem;
	}
	.modal {
		background: var(--bg);
		border-radius: 16px;
		padding: 1.5rem;
		width: 100%;
		max-width: 340px;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.modal h2 { margin: 0; font-size: 1.1rem; }
	.modal input {
		padding: 0.7rem 0.9rem;
		border: 1px solid var(--border);
		border-radius: 10px;
		font-size: 1rem;
		background: var(--bg2);
		color: var(--text);
	}
	.modal-actions {
		display: flex;
		gap: 0.5rem;
	}
	.modal-actions button {
		flex: 1;
		padding: 0.7rem;
		border: none;
		border-radius: 10px;
		font-size: 0.95rem;
		font-weight: 600;
		cursor: pointer;
	}
	.modal-actions button:first-child {
		background: var(--accent);
		color: #fff;
	}
	.modal-actions button:last-child {
		background: var(--bg3);
		color: var(--text);
	}
	.type-toggle {
		display: flex;
		border: 1px solid var(--border);
		border-radius: 10px;
		overflow: hidden;
	}
	.type-toggle button {
		flex: 1;
		padding: 0.6rem;
		border: none;
		background: var(--bg2);
		color: var(--text);
		font-size: 0.9rem;
		cursor: pointer;
	}
	.type-toggle button.active {
		background: var(--accent);
		color: #fff;
	}
	.empty-prompt {
		text-align: center;
		padding: 2rem 1rem;
		color: var(--text2);
	}
	.empty-prompt button {
		margin-top: 0.75rem;
		padding: 0.7rem 1.5rem;
		background: var(--accent);
		color: #fff;
		border: none;
		border-radius: 10px;
		font-size: 0.95rem;
		cursor: pointer;
	}
	.move-panel {
		background: var(--bg2);
		border: 1px solid var(--border);
		border-radius: 12px;
		margin: 0.5rem 1rem;
		padding: 0.75rem;
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
	}
	.move-panel p { margin: 0; font-size: 0.85rem; width: 100%; color: var(--text2); }
	.move-panel button {
		padding: 0.4rem 0.8rem;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--bg3);
		color: var(--text);
		font-size: 0.85rem;
		cursor: pointer;
	}
</style>
