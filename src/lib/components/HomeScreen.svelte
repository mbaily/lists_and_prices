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
		isFolderEffectivelyArchived,
		isListEffectivelyArchived,
		type Folder,
		type ListMeta
	} from '$lib/data';
	import { syncState, docState } from '$lib/yjsStore.svelte';
	import ListScreen from './ListScreen.svelte';
	import ColorPicker from './ColorPicker.svelte';
	import SettingsScreen from './SettingsScreen.svelte';
	import SyncBadge from './SyncBadge.svelte';
	import ConfirmDialog from './ConfirmDialog.svelte';
	import RowMenu from './RowMenu.svelte';

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

	// Special virtual folder id for the Archived view
	const ARCHIVE_ID = '__archive__';

	// True whenever ARCHIVE_ID is anywhere in the breadcrumb (including as currentFolderId)
	let isInArchiveView = $derived(breadcrumb.includes(ARCHIVE_ID));

	let childFolders = $derived(
		currentFolderId === ARCHIVE_ID
			// Archive root: only root-level (parentId === null) effectively-archived folders
			? allFolders
					.filter((f) => f.parentId === null && isFolderEffectivelyArchived(f.id, allFolders))
					.sort((a, b) => a.order - b.order)
			: isInArchiveView
			// Inside an archived folder: show all children (they inherit archived status from parent)
			? allFolders
					.filter((f) => f.parentId === currentFolderId)
					.sort((a, b) => a.order - b.order)
			// Normal view: exclude effectively-archived
			: allFolders
					.filter((f) => f.parentId === currentFolderId && !isFolderEffectivelyArchived(f.id, allFolders))
					.sort((a, b) => a.order - b.order)
	);
	let childLists = $derived(
		currentFolderId === ARCHIVE_ID
			// Archive root: no lists here (lists live inside folders)
			? []
			: isInArchiveView
			// Inside an archived folder: show all lists (they inherit archived status from parent)
			? allLists
					.filter((l) => l.folderId === currentFolderId)
					.sort((a, b) => a.order - b.order)
			// Normal view: exclude effectively-archived
			: allLists
					.filter((l) => l.folderId === currentFolderId && !isListEffectivelyArchived(l, allFolders))
					.sort((a, b) => a.order - b.order)
	);
	let hasArchived = $derived(
		// Only true when the archive root view would actually have content:
		// root-level folders that are directly archived, or any effectively-archived list.
		allFolders.some((f) => f.parentId === null && f.archived) ||
		allLists.some((l) => isListEffectivelyArchived(l, allFolders))
	);
	let currentFolderColor = $derived(
		allFolders.find((f) => f.id === currentFolderId)?.color ?? '#6366f1'
	);

	// ── Favourites ───────────────────────────────────────────────────────────────
	let favouriteLists = $derived(allLists.filter((l) => l.favourite && !isListEffectivelyArchived(l, allFolders)));

	function listPath(list: ListMeta): string {
		const parts: string[] = [];
		const visited = new Set<string>();
		let fid: string | null = list.folderId;
		while (fid !== null) {
			if (visited.has(fid)) break; // guard against cyclic parentId
			visited.add(fid);
			const f = allFolders.find((x) => x.id === fid);
			if (!f) break;
			parts.unshift(f.name);
			fid = f.parentId;
		}
		parts.push(list.name);
		return parts.join(' › ');
	}

	// ── Guard: trim breadcrumb if a folder in it was deleted (e.g. by a peer) ───
	$effect(() => {
		// allFolders is a reactive dependency; re-run whenever folders change.
		const ids = new Set(allFolders.map((f) => f.id));
		// Find the deepest breadcrumb entry that still exists (null = root, ARCHIVE_ID = virtual — always valid)
		const lastValid = breadcrumb.findLastIndex((id) => id === null || id === ARCHIVE_ID || ids.has(id));
		if (lastValid < breadcrumb.length - 1) {
			breadcrumb = breadcrumb.slice(0, lastValid + 1);
		}
		// Close list screen if the open list has been deleted by a peer
		if (openListId !== null && !allLists.some((l) => l.id === openListId)) {
			openListId = null;
		}
		// Clear rename state if the target was deleted by a peer
		if (renamingId !== null) {
			const allIds = new Set([
				...allFolders.map((f) => f.id),
				...allLists.map((l) => l.id)
			]);
			if (!allIds.has(renamingId)) renamingId = null;
		}
		// Clear stale tag if the tagged item was deleted by a peer
		if (taggedFolderId !== null && !allFolders.some((f) => f.id === taggedFolderId)) taggedFolderId = null;
		if (taggedListId !== null && !allLists.some((l) => l.id === taggedListId)) taggedListId = null;
	});

	// ── Breadcrumb label ────────────────────────────────────────────────────────
	function folderName(id: string | null): string {
		if (id === null) return 'Home';		if (id === ARCHIVE_ID) return 'Archived';		return allFolders.find((f) => f.id === id)?.name ?? '…';
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

	// ── Move (tag-then-drop model) ───────────────────────────────────────────
	// "Tag" marks an item for moving. Any folder row then shows "Move Tagged Here".
	let taggedListId = $state<string | null>(null);
	let taggedFolderId = $state<string | null>(null);
	let hasTag = $derived(taggedListId !== null || taggedFolderId !== null);

	function tagFolder(id: string) { taggedFolderId = id; taggedListId = null; }
	function tagList(id: string) { taggedListId = id; taggedFolderId = null; }
	function clearTag() { taggedFolderId = null; taggedListId = null; }

	function moveTaggedTo(targetFolderId: string | null) {
		if (taggedFolderId) {
			if (targetFolderId !== null && isDescendant(taggedFolderId, targetFolderId)) {
				alert('Cannot move a folder into one of its own sub-folders.');
				return;
			}
			updateFolder(taggedFolderId, { parentId: targetFolderId });
		} else if (taggedListId) {
			if (targetFolderId === null) return; // lists must live in a folder
			updateList(taggedListId, { folderId: targetFolderId });
		}
		clearTag();
	}

	// ── Touch drag reorder ────────────────────────────────────────────────────────
	// HTML5 drag doesn't work on iOS — use touch events instead.
	// 'folder' or 'list' drag, tracked independently.
	type DragKind = 'folder' | 'list';
	let touchDragKind = $state<DragKind | null>(null);
	let touchDragFrom = $state<number | null>(null);
	let touchDragOver = $state<number | null>(null);

	function startDrag(e: PointerEvent, kind: DragKind, index: number) {
		e.stopPropagation();
		// Close any open tag so drag and move can't conflict
		clearTag();
		touchDragKind = kind;
		touchDragFrom = index;
		touchDragOver = index;
	}

	$effect(() => {
		if (touchDragFrom === null) return;
		const kind = touchDragKind;
		function onMove(e: PointerEvent) {
			e.preventDefault();
			const el = document.elementFromPoint(e.clientX, e.clientY);
			const row = el?.closest('[data-drag-kind]') as HTMLElement | null;
			if (row?.dataset.dragKind === kind && row.dataset.dragIndex !== undefined) {
				touchDragOver = parseInt(row.dataset.dragIndex, 10);
			}
		}
		function onEnd() {
			if (touchDragFrom !== null && touchDragOver !== null && touchDragFrom !== touchDragOver) {
				if (kind === 'folder') {
					// Don't reorder inside the virtual archive root
					if (currentFolderId !== ARCHIVE_ID) reorderFolders(currentFolderId, touchDragFrom, touchDragOver);
				} else {
					// Lists always have a real folderId (archive root shows no lists)
					if (currentFolderId && currentFolderId !== ARCHIVE_ID) reorderLists(currentFolderId, touchDragFrom, touchDragOver);
				}
			}
			touchDragKind = null;
			touchDragFrom = null;
			touchDragOver = null;
		}
		document.addEventListener('pointermove', onMove, { passive: false });
		document.addEventListener('pointerup', onEnd, { once: true });
		return () => {
			document.removeEventListener('pointermove', onMove);
			document.removeEventListener('pointerup', onEnd);
		};
	});

	// ── First-launch guard ───────────────────────────────────────────────────────
	let showFirstLaunch = $derived(allFolders.length === 0 && !showNewFolder);
	// ── Archive helpers ───────────────────────────────────────────────────────
	function archiveFolder(id: string) { updateFolder(id, { archived: true }); }
	function unarchiveFolder(id: string) { updateFolder(id, { archived: false }); }
	function archiveList(id: string) { updateList(id, { archived: true }); }
	function unarchiveList(id: string) { updateList(id, { archived: false }); }
	$effect(() => {
		void currentFolderId; // track navigation
		renamingId = null;
		// Do NOT clear the tag — the user navigates specifically to find the move target
	});
</script>

{#if openListId}
	<ListScreen listId={openListId} onHome={() => { openListId = null; breadcrumb = [null]; }} onOpenList={(id) => (openListId = id)} onNavigateTo={(folderId) => {
		openListId = null;
		// Reconstruct the full ancestor path to folderId so the breadcrumb is correct
		// regardless of which folder the user was in when they opened the list.
		const trail: (string | null)[] = [null];
		const visited = new Set<string>();
		let fid: string | null = folderId;
		const ancestors: string[] = [];
		while (fid !== null) {
			if (visited.has(fid)) break;
			visited.add(fid);
			ancestors.unshift(fid);
			const f = allFolders.find((x) => x.id === fid);
			fid = f?.parentId ?? null;
		}
		breadcrumb = [...trail, ...ancestors];
	}} />
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
						{crumbId === null ? '🏠' : folderName(crumbId)}
					</button>
					<span class="sep">/</span>
				{:else}
					<span class="crumb current">{crumbId === null ? '🏠' : folderName(crumbId)}</span>
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

		<!-- Favourites bar -->
		{#if favouriteLists.length > 0}
			<div class="fav-bar">
				<span class="fav-label">★</span>
				{#each favouriteLists as fav}
					<button
						class="fav-chip"
						style="--chip-color:{fav.color}"
						onclick={() => { openListId = fav.id; renamingId = null; }}
					>{listPath(fav)}</button>
				{/each}
			</div>
		{/if}

		<!-- Tag indicator strip (outside .content so it stays visible while scrolling) -->
		{#if hasTag}
			<div class="tag-strip">
				<span>🏷 {taggedFolderId ? '📁 ' + (allFolders.find(f => f.id === taggedFolderId)?.name ?? '…') : '📋 ' + (allLists.find(l => l.id === taggedListId)?.name ?? '…')} tagged — navigate to destination and tap ⋮ → Move Tagged Here</span>
				{#if taggedFolderId}
					<button class="tag-root-btn" onclick={() => moveTaggedTo(null)} title="Move to root">🏠</button>
				{/if}
				<button onclick={clearTag}>✕</button>
			</div>
		{/if}

		<!-- Up button -->
		<div class="content">
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

		<!-- Archived virtual folder entry (shown at root when there's anything archived) -->
		{#if currentFolderId === null && hasArchived}
			<div class="row folder-row">
				<span class="check-circle" style="color:#94a3b8">📦</span>
				<button class="row-name" onclick={() => (breadcrumb = [...breadcrumb, ARCHIVE_ID])}
				>Archived</button>
			</div>
		{/if}

		<!-- Folders -->
		{#each childFolders as folder, i}
			<div
				class="row folder-row"
				class:done={folder.done}
				class:archived={folder.archived}
				class:drag-source={touchDragKind === 'folder' && touchDragFrom === i}
				class:drag-above={touchDragKind === 'folder' && touchDragOver === i && touchDragFrom !== null && touchDragFrom > i}
				class:drag-below={touchDragKind === 'folder' && touchDragOver === i && touchDragFrom !== null && touchDragFrom < i}
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
				<button class="drag-handle" aria-label="Drag to reorder" onpointerdown={(e) => startDrag(e, 'folder', i)}>☰</button>
				<RowMenu items={[
					{ label: '✏ Rename', action: () => startRename(folder.id, folder.name, 'folder') },
					{ label: folder.archived ? '📤 Unarchive' : '📥 Archive', action: () => folder.archived ? unarchiveFolder(folder.id) : archiveFolder(folder.id) },
					...(hasTag && taggedFolderId !== folder.id
						? [{ label: '📂 Move Tagged Here', action: () => moveTaggedTo(folder.id) }]
						: []),
					...(hasTag
						? [{ label: '✕ Clear Tag', action: clearTag }]
						: [{ label: '🏷 Tag (to move)', action: () => tagFolder(folder.id) }]),
					{ label: '🗑 Delete', danger: true, action: () => askDelete(`Delete folder "${folder.name}" and all its contents?`, () => deleteFolder(folder.id)) }
				]} />
			</div>
		{/each}

		<!-- Lists -->
		{#each childLists as list, i}
			<div
				class="row list-row"
				class:done={list.done}
				class:archived={list.archived}
				class:drag-source={touchDragKind === 'list' && touchDragFrom === i}
				class:drag-above={touchDragKind === 'list' && touchDragOver === i && touchDragFrom !== null && touchDragFrom > i}
				class:drag-below={touchDragKind === 'list' && touchDragOver === i && touchDragFrom !== null && touchDragFrom < i}
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
					<button class="row-name" onclick={() => { openListId = list.id; renamingId = null; }}>
						{list.type === 'priced' ? '💰' : '📋'} {list.name}
					</button>
				{/if}
				<button
					class="fav-btn"
					class:active={list.favourite}
					onclick={() => updateList(list.id, { favourite: !list.favourite })}
					aria-label={list.favourite ? 'Unfavourite' : 'Favourite'}
				>★</button>
				<button class="drag-handle" aria-label="Drag to reorder" onpointerdown={(e) => startDrag(e, 'list', i)}>☰</button>
				<RowMenu items={[
					{ label: '✏ Rename', action: () => startRename(list.id, list.name, 'list') },
					{ label: list.archived ? '📤 Unarchive' : '📥 Archive', action: () => list.archived ? unarchiveList(list.id) : archiveList(list.id) },
					...(hasTag
						? [{ label: '✕ Clear Tag', action: clearTag }]
						: [{ label: '🏷 Tag (to move)', action: () => tagList(list.id) }]),
					{ label: '🗑 Delete', danger: true, action: () => askDelete(`Delete list "${list.name}"?`, () => deleteList(list.id)) }
				]} />
			</div>
		{/each}

		<!-- Tag indicator strip moved above .content -->

		<!-- Action bar -->
		<div class="action-bar">
			{#if !isInArchiveView}
				<button onclick={() => (showNewFolder = true)}>+ Folder</button>
				{#if currentFolderId}
					<button onclick={() => openNewList()}>+ List</button>
				{/if}
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
						<button onclick={() => { showNewFolder = false; newFolderName = ''; }}>Cancel</button>
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
						<button onclick={() => { showNewList = false; newListName = ''; }}>Cancel</button>
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
		</div><!-- end .content -->
	</div>
{/if}

<style>
	.screen {
		height: 100dvh;
		background: var(--bg);
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
	.content {
		flex: 1;
		overflow-x: hidden;
		overflow-y: auto;
		-webkit-overflow-scrolling: touch;
		padding-bottom: 1rem;
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
	.row.drag-above { background: var(--bg3); box-shadow: inset 0 2px 0 var(--accent); }
	.row.drag-below { background: var(--bg3); box-shadow: inset 0 -2px 0 var(--accent); }
	.row.done { opacity: 0.55; }
	.row.done .row-name { text-decoration: line-through; color: var(--text2); }
	.row.archived { opacity: 0.6; }
	.row.archived .row-name { font-style: italic; }
	/* ── Favourites bar ────────────────────────────────────────────────────────── */
	.fav-bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
		padding: 0.4rem 1rem;
		background: var(--bg2);
		border-bottom: 1px solid var(--border);
	}
	.fav-label {
		color: #f59e0b;
		font-size: 1rem;
		flex-shrink: 0;
	}
	.fav-chip {
		background: none;
		border: 1px solid var(--chip-color, var(--accent));
		border-radius: 999px;
		padding: 0.2rem 0.65rem;
		font-size: 0.82rem;
		color: var(--chip-color, var(--accent));
		cursor: pointer;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 200px;
	}
	.fav-chip:hover { background: color-mix(in srgb, var(--chip-color) 12%, transparent); }
	.fav-btn {
		background: none;
		border: none;
		font-size: 1.1rem;
		cursor: pointer;
		padding: 0;
		color: var(--text2);
		min-width: 28px;
		min-height: 44px;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.fav-btn.active { color: #f59e0b; }
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
		font-size: 1.1rem;
		user-select: none;
		-webkit-user-select: none;
		touch-action: none;
		min-width: 44px;
		min-height: 44px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: none;
		border: none;
		padding: 0;
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
	.tag-strip {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 1rem;
		background: color-mix(in srgb, var(--accent) 12%, var(--bg2));
		border-bottom: 1px solid var(--border);
		font-size: 0.82rem;
		color: var(--text2);
	}
	.tag-strip span { flex: 1; }
	.tag-strip button {
		background: none;
		border: none;
		font-size: 1rem;
		color: var(--text2);
		cursor: pointer;
		padding: 0.25rem;
		min-width: 32px;
		min-height: 32px;
	}
</style>
