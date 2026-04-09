<script lang="ts">
	import { tick } from 'svelte';
	import {
		readFolders,
		readLists,
		readAllItems,
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
		archiveFolder,
		unarchiveFolder,
		archiveList,
		unarchiveList,
		readSheets,
		deleteSheet,
		updateSheet,
		type Folder,
		type ListMeta,
		type SheetMeta,
		type Item
	} from '$lib/data';
	import { syncState, docState } from '$lib/yjsStore.svelte';
	import { settings } from '$lib/settings.svelte';
	import { smartFolders, assignToReport, removeFromReport } from '$lib/smartFolders.svelte';
	import ListScreen from './ListScreen.svelte';
	import SpreadsheetScreen from './SpreadsheetScreen.svelte';
	import ColorPicker from './ColorPicker.svelte';
	import SettingsScreen from './SettingsScreen.svelte';
	import SyncBadge from './SyncBadge.svelte';
	import ConfirmDialog from './ConfirmDialog.svelte';
	import RowMenu from './RowMenu.svelte';
	import InfoDialog from './InfoDialog.svelte';

	let { onLogout }: { onLogout: () => void } = $props();

	// ── URL hash navigation ──────────────────────────────────────────────────────
	// Format: #f/id1/id2  (folder path, skipping the implicit null root)
	//         #l/listId   (open list)
	//         #           (root / home)
	function buildHash(crumbs: (string | null)[], listId: string | null): string {
		if (listId) return `#l/${listId}`;
		// crumbs[0] is always null (root) — skip it
		const ids = crumbs.slice(1).filter((id): id is string => id !== null);
		return ids.length ? `#f/${ids.join('/')}` : '#';
	}

	function parseHash(): { breadcrumb: (string | null)[], openListId: string | null } {
		if (typeof window === 'undefined') return { breadcrumb: [null], openListId: null };
		const hash = window.location.hash.slice(1); // strip '#'
		if (hash.startsWith('l/')) {
			return { breadcrumb: [null], openListId: hash.slice(2) || null };
		}
		if (hash.startsWith('f/')) {
			const parts = hash.slice(2).split('/').filter(Boolean);
			return { breadcrumb: [null, ...parts], openListId: null };
		}
		return { breadcrumb: [null], openListId: null };
	}

	const _init = parseHash();

	// ── Navigation state ────────────────────────────────────────────────────────
	// breadcrumb is an array of folder ids. null means root.
	let breadcrumb = $state<(string | null)[]>(_init.breadcrumb);
	let currentFolderId = $derived(breadcrumb[breadcrumb.length - 1]);

	// ── View state ──────────────────────────────────────────────────────────────
	let openListId = $state<string | null>(_init.openListId);
	let showSettings = $state(false);

	// ── Search ────────────────────────────────────────────────────────────────────
	let showSearch = $state(false);
	let searchQuery = $state('');
	let searchInputEl: HTMLInputElement | null = null;
	let savedSearch = $state<string | null>(null); // persists after navigating to a result

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
	let allItems = $derived.by(() => {
		if (!showSearch) return [] as Item[];
		void docState.version;
		try { return readAllItems(); } catch { return [] as Item[]; }
	});
	let allPinnedItems = $derived.by(() => {
		void docState.version;
		try {
			const activeLists = new Set(allLists.filter((l) => !isListEffectivelyArchived(l, allFolders)).map((l) => l.id));
			return readAllItems().filter((i) => i.pinned && activeLists.has(i.listId));
		} catch { return [] as Item[]; }
	});

	// ── Search results ────────────────────────────────────────────────────────────
	type SearchResult =
		| { kind: 'folder'; data: Folder; path: string }
		| { kind: 'list'; data: ListMeta; path: string }
		| { kind: 'item'; data: Item; listData: ListMeta };
	let searchResults = $derived.by((): SearchResult[] => {
		const q = searchQuery.trim().toLowerCase();
		if (!q) return [];
		const results: SearchResult[] = [];
		for (const folder of allFolders) {
			if (folder.name.toLowerCase().includes(q))
				results.push({ kind: 'folder', data: folder, path: folderPath(folder) });
		}
		for (const list of allLists) {
			if (list.name.toLowerCase().includes(q))
				results.push({ kind: 'list', data: list, path: listPath(list) });
		}
		for (const item of allItems) {
			if (item.name.toLowerCase().includes(q)) {
				const list = allLists.find(l => l.id === item.listId);
				if (list) results.push({ kind: 'item', data: item, listData: list });
			}
		}
		// Sort by createdAt descending (newest first); nulls go last
		results.sort((a, b) => {
			const aDate = a.kind === 'item' ? a.data.createdAt : a.data.createdAt;
			const bDate = b.kind === 'item' ? b.data.createdAt : b.data.createdAt;
			if (!aDate && !bDate) return 0;
			if (!aDate) return 1;
			if (!bDate) return -1;
			return bDate.localeCompare(aDate);
		});
		return results;
	});

	// Special virtual folder id for the Archived view
	const ARCHIVE_ID = '__archive__';

	// True whenever ARCHIVE_ID is anywhere in the breadcrumb (including as currentFolderId)
	let isInArchiveView = $derived(breadcrumb.includes(ARCHIVE_ID));

	// Set of non-archived folder IDs that are ancestors of archived content.
	// These are shown in the archive view as "path-through" folders so the user
	// can navigate down to the archived lists/folders inside them.
	let pathThroughFolderIds = $derived.by(() => {
		const result = new Set<string>();
		// Walk up from each archived list's folder chain
		for (const list of allLists) {
			if (!list.archived) continue;
			let fid: string | null = list.folderId;
			while (fid !== null) {
				if (result.has(fid)) break;
				const folder = allFolders.find((f) => f.id === fid);
				if (!folder) break;
				if (folder.archived) break; // stop at archived folders — they show as their own item
				result.add(fid);
				fid = folder.parentId;
			}
		}
		// Walk up from each archived folder's parent chain
		for (const folder of allFolders) {
			if (!folder.archived) continue;
			let fid: string | null = folder.parentId;
			while (fid !== null) {
				if (result.has(fid)) break;
				const parent = allFolders.find((f) => f.id === fid);
				if (!parent) break;
				if (parent.archived) break;
				result.add(fid);
				fid = parent.parentId;
			}
		}
		return result;
	});

	// True when the current folder is itself (or inherits) archived status.
	// False when it's a path-through non-archived folder shown in the archive view.
	let isCurrentFolderEffectivelyArchived = $derived(
		currentFolderId !== null &&
		currentFolderId !== ARCHIVE_ID &&
		isFolderEffectivelyArchived(currentFolderId, allFolders)
	);

	let childFolders = $derived(
		currentFolderId === ARCHIVE_ID
			// Archive root: tops of archived subtrees (archived folder whose parent is not archived),
			// plus root-level path-through folders that lead to archived content.
			? allFolders
					.filter((f) =>
						(f.archived && (f.parentId === null || !isFolderEffectivelyArchived(f.parentId, allFolders)))
						|| (f.parentId === null && pathThroughFolderIds.has(f.id))
					)
					.sort((a, b) => a.order - b.order)
			: isInArchiveView
			? (isCurrentFolderEffectivelyArchived
				// Inside an explicitly archived folder: show all children
				? allFolders
						.filter((f) => f.parentId === currentFolderId)
						.sort((a, b) => a.order - b.order)
				// Inside a path-through folder: only archived children + path-through children
				: allFolders
						.filter((f) => f.parentId === currentFolderId &&
							(isFolderEffectivelyArchived(f.id, allFolders) || pathThroughFolderIds.has(f.id)))
						.sort((a, b) => a.order - b.order)
			)
			// Normal view: exclude effectively-archived
			: allFolders
					.filter((f) => f.parentId === currentFolderId && !isFolderEffectivelyArchived(f.id, allFolders))
					.sort((a, b) => a.order - b.order)
	);
	let childLists = $derived(
		currentFolderId === ARCHIVE_ID
			// Archive root: only orphaned archived lists (whose folder has been deleted)
			? allLists
					.filter((l) => l.archived && !allFolders.some((f) => f.id === l.folderId))
					.sort((a, b) => a.order - b.order)
			: isInArchiveView
			? (isCurrentFolderEffectivelyArchived
				// Inside an explicitly archived folder: show all lists
				? allLists
						.filter((l) => l.folderId === currentFolderId)
						.sort((a, b) => a.order - b.order)
				// Inside a path-through folder: show only archived lists
				: allLists
						.filter((l) => l.folderId === currentFolderId && l.archived)
						.sort((a, b) => a.order - b.order)
			)
			// Normal view: exclude effectively-archived
			: allLists
					.filter((l) => l.folderId === currentFolderId && !isListEffectivelyArchived(l, allFolders))
					.sort((a, b) => a.order - b.order)
	);
	let hasArchived = $derived(
		allFolders.some((f) => f.archived) || allLists.some((l) => l.archived)
	);
	let currentFolderColor = $derived(
		allFolders.find((f) => f.id === currentFolderId)?.color ?? '#6366f1'
	);

	// ── Spreadsheets ─────────────────────────────────────────────────────────────
	let allSheets = $derived.by(() => {
		void docState.version;
		try { return readSheets(); } catch { return []; }
	});
	let childSheets = $derived(
		!isInArchiveView && currentFolderId !== ARCHIVE_ID
			? allSheets.filter((s) => s.folderId === (currentFolderId ?? null)).sort((a, b) => a.order - b.order)
			: []
	);
	let openSheetId = $state<string | null>(null);

	// ── Favourites ───────────────────────────────────────────────────────────────────────
	let favouriteLists = $derived(allLists.filter((l) => l.favourite && !isListEffectivelyArchived(l, allFolders)));
	let favouriteFolders = $derived(allFolders.filter((f) => f.favourite && !isFolderEffectivelyArchived(f.id, allFolders)));

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

	/** Returns the ordered list of ancestor IDs (root-first) for a folder. */
	function ancestorIds(folder: Folder): string[] {
		const ids: string[] = [];
		const visited = new Set<string>();
		let fid: string | null = folder.parentId;
		while (fid !== null) {
			if (visited.has(fid)) break;
			visited.add(fid);
			ids.unshift(fid);
			const f = allFolders.find((x) => x.id === fid);
			if (!f) break;
			fid = f.parentId;
		}
		return ids;
	}

	// ── Guard: trim breadcrumb if a folder in it was deleted (e.g. by a peer) ───
	$effect(() => {
		// allFolders is a reactive dependency; re-run whenever folders change.
		const ids = new Set(allFolders.map((f) => f.id));
		// Only trim stale navigation state after Yjs has loaded data from IndexedDB.
		// Before the first update (version === 0) allFolders/allLists are empty and
		// the IDs from the URL hash would be incorrectly treated as deleted.
		if (docState.version > 0) {
			// Find the deepest breadcrumb entry that still exists (null = root, ARCHIVE_ID = virtual — always valid)
			// In archive view, also trim entries that are no longer archived or path-through.
			const lastValid = breadcrumb.findLastIndex((id) => {
				if (id === null || id === ARCHIVE_ID) return true;
				if (!ids.has(id)) return false;
				// If in archive view, a real folder must still be archived or a path-through
				if (breadcrumb.includes(ARCHIVE_ID)) {
					return isFolderEffectivelyArchived(id, allFolders) || pathThroughFolderIds.has(id);
				}
				return true;
			});
			if (lastValid < breadcrumb.length - 1) {
				breadcrumb = breadcrumb.slice(0, lastValid + 1);
			}
			// Close list screen if the open list has been deleted by a peer
			if (openListId !== null && !allLists.some((l) => l.id === openListId)) {
				openListId = null;
			}
			// Close spreadsheet if deleted by a peer
			if (openSheetId !== null && !allSheets.some((s) => s.id === openSheetId)) {
				openSheetId = null;
			}
		}
		// Clear rename state if the target was deleted by a peer
		if (renamingId !== null) {
			const allIds = new Set([
				...allFolders.map((f) => f.id),
				...allLists.map((l) => l.id)
			]);
			if (!allIds.has(renamingId)) renamingId = null;
		}
		// Clear info dialog if the target was deleted by a peer
		if (infoTarget !== null) {
			const exists = infoTarget.kind === 'folder'
				? allFolders.some((f) => f.id === infoTarget!.data.id)
				: infoTarget.kind === 'list'
				? allLists.some((l) => l.id === infoTarget!.data.id)
				: allSheets.some((s) => s.id === infoTarget!.data.id);
			if (!exists) infoTarget = null;
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
		createFolder(newFolderName.trim(), currentFolderId, newFolderColor, settings.addListPosition);
		newFolderName = '';
		newFolderColor = '#6366f1';
		showNewFolder = false;
	}

	// ── Create list ──────────────────────────────────────────────────────────────
	let newListName = $state('');
	let newListType = $state<'plain' | 'priced'>('plain');
	let newListColor = $state('#6366f1');
	let showNewList = $state(false);

	function openNewList() {
		newListColor = currentFolderColor;
		newListType = 'plain';
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
		createList(name, currentFolderId!, newListType, newListColor, settings.addListPosition);
		newListName = '';
		newListType = 'plain';
		newListColor = '#6366f1';
		showNewList = false;
	}

	// ── Delete confirmation ──────────────────────────────────────────────────────
	let confirmMsg = $state('');
	let confirmAction = $state<(() => void) | null>(null);

	function askDelete(msg: string, action: () => void) {
		confirmMsg = msg;
		confirmAction = () => action();
	}

	// ── Info dialog ────────────────────────────────────────────────────────────
	type InfoTarget = { kind: 'folder'; data: Folder } | { kind: 'list'; data: ListMeta } | { kind: 'sheet'; data: SheetMeta };
	let infoTarget = $state<InfoTarget | null>(null);

	function fmtDate(iso: string | null | undefined): string {
		if (!iso) return 'Unknown';
		return new Date(iso).toLocaleString(undefined, {
			day: 'numeric', month: 'short', year: 'numeric',
			hour: '2-digit', minute: '2-digit'
		});
	}

	// ── Rename ───────────────────────────────────────────────────────────────────
	let renamingId = $state<string | null>(null);
	let renameValue = $state('');
	let renameTarget = $state<'folder' | 'list' | 'sheet'>('folder');

	function startRename(id: string, current: string, target: 'folder' | 'list' | 'sheet') {
		renamingId = id;
		renameValue = current;
		renameTarget = target;
	}

	function submitRename() {
		if (renamingId && renameValue.trim()) {
			if (renameTarget === 'folder') updateFolder(renamingId, { name: renameValue.trim() });
			else if (renameTarget === 'list') updateList(renamingId, { name: renameValue.trim() });
			else if (renameTarget === 'sheet') updateSheet(renamingId, { name: renameValue.trim() });
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
			if (targetFolderId !== null && isFolderEffectivelyArchived(targetFolderId, allFolders)) {
				alert('Cannot move a folder into an archived folder.');
				return;
			}
			updateFolder(taggedFolderId, { parentId: targetFolderId });
		} else if (taggedListId) {
			if (targetFolderId === null) return; // lists must live in a folder
			if (isFolderEffectivelyArchived(targetFolderId, allFolders)) {
				alert('Cannot move a list into an archived folder.');
				return;
			}
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
					if (currentFolderId !== ARCHIVE_ID) reorderFolders(currentFolderId, touchDragFrom, touchDragOver, childFolders.map((f) => f.id));
				} else {
					// Lists always have a real folderId (archive root shows no lists)
					if (currentFolderId && currentFolderId !== ARCHIVE_ID) reorderLists(currentFolderId, touchDragFrom, touchDragOver, childLists.map((l) => l.id));
				}
			}
			touchDragKind = null;
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

	// ── First-launch guard ───────────────────────────────────────────────────────
	let showFirstLaunch = $derived(allFolders.length === 0 && !showNewFolder);

	// ── Search actions ────────────────────────────────────────────────────────────
	function toggleSearch() {
		if (!showSearch) {
			// Opening fresh search — clear saved crumb so user starts clean
			savedSearch = null;
			showSearch = true;
			tick().then(() => searchInputEl?.focus());
		} else {
			showSearch = false;
			searchQuery = '';
		}
	}

	function restoreSearch() {
		if (!savedSearch) return;
		searchQuery = savedSearch;
		savedSearch = null;
		showSearch = true;
		tick().then(() => searchInputEl?.focus());
	}

	function openSearchResult(result: SearchResult) {
		const query = searchQuery.trim();
		showSearch = false;
		searchQuery = '';
		savedSearch = query || null;
		if (result.kind === 'folder') {
			const visited = new Set<string>();
			const ids: string[] = [];
			let cur: string | null = result.data.id;
			while (cur !== null) {
				if (visited.has(cur)) break;
				visited.add(cur);
				ids.unshift(cur);
				const f = allFolders.find(x => x.id === cur);
				cur = f?.parentId ?? null;
			}
			breadcrumb = [null, ...ids];
		} else if (result.kind === 'list') {
			openListId = result.data.id;
		} else {
			openListId = result.listData.id;
		}
	}

	$effect(() => {
		void currentFolderId; // track navigation
		renamingId = null;
		infoTarget = null;
		// Close create forms so they don't linger in the wrong folder context
		showNewFolder = false;
		showNewList = false;
		newFolderName = '';
		newFolderColor = '#6366f1';
		newListName = '';
		newListType = 'plain';
		newListColor = '#6366f1';
		// Do NOT clear the tag — the user navigates specifically to find the move target
	});

	// ── Smart folders (reports) ──────────────────────────────────────────────────
	let sfDialogFolder = $state<Folder | null>(null);
	let sfNewName = $state('');
	let showReportsMenu = $state(false);

	function sfReportNames(): string[] {
		return Object.keys(smartFolders).sort();
	}

	function generateReport(reportName: string) {
		showReportsMenu = false;
		const folderIds: string[] = smartFolders[reportName] ?? [];
		const now = new Date();
		const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
		const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
		const lines: string[] = [
			`SMART FOLDER: ${reportName}`,
			`Generated: ${dateStr} ${timeStr}`,
			''
		];

		const reportFolders = allFolders
			.filter((f) => folderIds.includes(f.id) && !isFolderEffectivelyArchived(f.id, allFolders));
		const allItemsNow = readAllItems();
		let hasAny = false;

		for (const folder of reportFolders) {
			const folderLists = allLists
				.filter((l) => l.folderId === folder.id && !isListEffectivelyArchived(l, allFolders))
				.sort((a, b) => a.order - b.order);

			type TodoEntry = { name: string; listName: string; createdAt: string | null };
			const todos: TodoEntry[] = [];

			for (const list of folderLists) {
				const items = allItemsNow.filter((i) =>
					i.listId === list.id && !i.checked && !i.heading && !i.note
				);
				for (const item of items) {
					todos.push({ name: item.name, listName: list.name, createdAt: item.createdAt });
				}
			}

			// Sort by creation date descending within the folder
			todos.sort((a, b) => {
				const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
				const db = b.createdAt ? new Date(b.createdAt).getTime() : 0;
				return db - da;
			});

			if (todos.length === 0) continue;
			hasAny = true;
			lines.push(`=== ${folder.name} ===`);
			for (const todo of todos) {
				const d = todo.createdAt
					? new Date(todo.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' })
					: '';
				lines.push(`  [${todo.listName}] ${todo.name}${d ? `  (${d})` : ''}`);
			}
			lines.push('');
		}

		if (!hasAny) lines.push('(No uncompleted todos found)');

		const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `${reportName.replace(/[^a-z0-9]+/gi, '_')}_${now.toISOString().slice(0, 10)}.txt`;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		setTimeout(() => URL.revokeObjectURL(url), 10000);
	}

	$effect(() => {
		if (!showReportsMenu) return;
		function dismiss(e: PointerEvent) {
			if (!(e.target as HTMLElement)?.closest('.reports-wrap')) showReportsMenu = false;
		}
		document.addEventListener('pointerdown', dismiss, { capture: true });
		return () => document.removeEventListener('pointerdown', dismiss, { capture: true });
	});

	// ── URL hash sync ────────────────────────────────────────────────────────────
	// Use pushState so the browser back button works between navigations.
	let _lastHash = typeof window !== 'undefined' ? window.location.hash : '';
	$effect(() => {
		const hash = buildHash(breadcrumb, openListId);
		if (hash !== _lastHash) {
			history.pushState(null, '', hash || '#');
			_lastHash = hash;
		}
	});

	// Restore state when the user presses the browser back/forward button.
	$effect(() => {
		if (typeof window === 'undefined') return;
		function onPopState() {
			const { breadcrumb: crumbs, openListId: listId } = parseHash();
			breadcrumb = crumbs;
			openListId = listId;
			_lastHash = window.location.hash;
		}
		window.addEventListener('popstate', onPopState);
		return () => window.removeEventListener('popstate', onPopState);
	});
</script>

{#if openSheetId}
	<SpreadsheetScreen sheetId={openSheetId} onBack={() => openSheetId = null} />
{:else if openListId}
	<ListScreen listId={openListId} onHome={() => { openListId = null; breadcrumb = [null]; }} onOpenList={(id) => (openListId = id)} savedSearch={savedSearch} onRestoreSearch={() => { openListId = null; breadcrumb = [null]; restoreSearch(); }} onNavigateTo={(folderId) => {
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
			<div class="header-left">
				<div class="breadcrumb">
					<!-- Home icon always first -->
					{#if breadcrumb.length > 1 || (savedSearch && !showSearch)}
						<button class="crumb home-crumb" onclick={() => (breadcrumb = [null])}>🏠</button>
						<span class="sep">/</span>
					{:else}
						<span class="crumb current home-crumb">🏠</span>
					{/if}
					<!-- Search crumb immediately after home -->
					{#if savedSearch && !showSearch}
						<button class="crumb search-crumb" onclick={restoreSearch} title="Back to search results">🔍 "{savedSearch}"</button>
						{#if breadcrumb.length > 1}<span class="sep">/</span>{/if}
					{/if}
					<!-- Remaining folder crumbs (skip the null home entry) -->
					{#each breadcrumb.slice(1) as crumbId, i}
						{#if i < breadcrumb.length - 2}
							<button class="crumb" onclick={() => (breadcrumb = breadcrumb.slice(0, i + 2))}>
								{folderName(crumbId)}
							</button>
							<span class="sep">/</span>
						{:else}
							<span class="crumb current">{folderName(crumbId)}</span>
						{/if}
					{/each}
				</div>
				<button class="icon-btn search-btn" class:search-active={showSearch} onclick={toggleSearch} aria-label={showSearch ? 'Close search' : 'Search'}>
					🔍
				</button>
			</div>

			<!-- No breadcrumb menu items currently -->
			<!-- {#if !isInArchiveView && currentFolderId !== ARCHIVE_ID} -->

			<div class="header-actions">
				{#if currentFolderId === null && hasArchived}
					<button class="icon-btn" onclick={() => (breadcrumb = [...breadcrumb, ARCHIVE_ID])} aria-label="Archived">
						📦
					</button>
				{/if}
				{#if sfReportNames().length > 0}
					<div class="reports-wrap">
						<button class="icon-btn" onclick={() => showReportsMenu = !showReportsMenu} aria-label="Smart Folder Reports">📋</button>
						{#if showReportsMenu}
							<div class="reports-menu">
								<div class="reports-header">Smart Folders</div>
								{#each sfReportNames() as rname}
									<button class="reports-item" onclick={() => generateReport(rname)}>{rname}</button>
								{/each}
							</div>
						{/if}
					</div>
				{/if}
				<SyncBadge status={syncState.status} />
				<button class="icon-btn" onclick={() => (showSettings = true)} aria-label="Settings">
					⚙
				</button>
			</div>
		</header>

		{#if showSearch}
			<div class="search-bar">
				<input
					bind:this={searchInputEl}
					bind:value={searchQuery}
					type="search"
					class="search-input"
					placeholder="Search folders, lists, items…"
					autocomplete="off"
					autocorrect="off"
					spellcheck={false}
				/>
				{#if searchQuery}
					<button class="search-clear" onclick={() => searchQuery = ''} aria-label="Clear search">✕</button>
				{/if}
			</div>
		{/if}

		<!-- Pinned items bar -->
		{#if allPinnedItems.length > 0}
			<div class="pin-bar">
				<span class="pin-label">📍</span>
				{#each allPinnedItems as pItem}
					{@const pItemList = allLists.find((l) => l.id === pItem.listId)}
					<button
						class="pin-chip"
						class:pin-chip-checked={!pItem.heading && !pItem.note && pItem.checked}
						onclick={() => { openListId = pItem.listId; renamingId = null; }}
						title={`${pItem.name} — ${pItemList?.name ?? '…'}`}
					>{pItem.name}<span class="pin-chip-list"> ({pItemList?.name ?? '…'})</span></button>
				{/each}
			</div>
		{/if}

		<!-- Favourites bar -->
		{#if favouriteLists.length > 0 || favouriteFolders.length > 0}
			<div class="fav-bar">
				<span class="fav-label">★</span>
				{#each favouriteFolders as fav}
					<button
						class="fav-chip"
						style="--chip-color:{fav.color}"
						onclick={() => { breadcrumb = [null, ...ancestorIds(fav), fav.id]; openListId = null; renamingId = null; }}
					>📁 {folderPath(fav)}</button>
				{/each}
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
		{#if showSearch && searchQuery.trim()}
			<!-- Search results -->
			{#if searchResults.length === 0}
				<div class="search-empty">No results for "{searchQuery.trim()}"</div>
			{:else}
				{#each searchResults as result}
					<button class="search-result-row" onclick={() => openSearchResult(result)}>
						{#if result.kind === 'folder'}
							<span class="result-icon">📁</span>
							<span class="result-info">
								<span class="result-name">{result.data.name}</span>
								<span class="result-path">{result.path}</span>
							</span>
							<span class="result-kind-badge">Folder</span>
						{:else if result.kind === 'list'}
							<span class="result-icon">{result.data.type === 'priced' ? '💰' : '📋'}</span>
							<span class="result-info">
								<span class="result-name">{result.data.name}</span>
								<span class="result-path">{result.path}</span>
							</span>
							<span class="result-kind-badge">List</span>
						{:else}
							<span class="result-icon">📄</span>
							<span class="result-info">
								<span class="result-name">{result.data.name}</span>
								<span class="result-path">{result.listData.name}</span>
							</span>
							<span class="result-kind-badge">Item</span>
						{/if}
					</button>
				{/each}
			{/if}
		{:else}
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
			{@const isPathThrough = isInArchiveView && pathThroughFolderIds.has(folder.id) && !folder.archived}
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
				{#if !isPathThrough}
					<button class="check-circle" onclick={() => updateFolder(folder.id, { done: !folder.done })} aria-label={folder.done ? 'Unmark complete' : 'Mark complete'}>
						{folder.done ? '☑' : '☐'}
					</button>
				{/if}
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
						📁 {folder.name}{#if isPathThrough} <span class="path-through-hint">›</span>{/if}
					</button>
				{/if}
				{#if !isPathThrough}
					<button
						class="fav-btn"
						class:active={folder.favourite}
						onclick={() => updateFolder(folder.id, { favourite: !folder.favourite })}
						aria-label={folder.favourite ? 'Unfavourite' : 'Favourite'}
					>★</button>
					<button class="drag-handle" aria-label="Drag to reorder" onpointerdown={(e) => startDrag(e, 'folder', i)}>☰</button>
					<RowMenu items={[
						{ label: 'ℹ️ Info', action: () => infoTarget = { kind: 'folder', data: folder } },
						{ label: '✏ Rename', action: () => startRename(folder.id, folder.name, 'folder') },
						{ label: '📋 Smart Folder', action: () => { sfDialogFolder = folder; sfNewName = ''; } },
						{ label: folder.archived ? '📤 Unarchive' : '📥 Archive', action: () => folder.archived ? unarchiveFolder(folder.id) : archiveFolder(folder.id) },
						...(hasTag && taggedFolderId !== folder.id
							? [{ label: '📂 Move Tagged Here', action: () => moveTaggedTo(folder.id) }]
							: []),
						...(hasTag
							? [{ label: '✕ Clear Tag', action: clearTag }]
							: [{ label: '🏷 Tag (to move)', action: () => tagFolder(folder.id) }]),
						{ label: '🗑 Delete', danger: true, action: () => askDelete(`Delete folder "${folder.name}" and all its contents?`, () => deleteFolder(folder.id)) }
					]} />
				{/if}
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
					{ label: 'ℹ️ Info', action: () => infoTarget = { kind: 'list', data: list } },
					{ label: '✏ Rename', action: () => startRename(list.id, list.name, 'list') },
					{ label: list.archived ? '📤 Unarchive' : '📥 Archive', action: () => list.archived ? unarchiveList(list.id) : archiveList(list.id) },
					...(hasTag
						? [{ label: '✕ Clear Tag', action: clearTag }]
						: [{ label: '🏷 Tag (to move)', action: () => tagList(list.id) }]),
					{ label: '🗑 Delete', danger: true, action: () => askDelete(`Delete list "${list.name}"?`, () => deleteList(list.id)) }
				]} />
			</div>
		{/each}

		<!-- Spreadsheets -->
		{#each childSheets as sheet}
			<div class="row sheet-row">
				<span class="sheet-icon">📊</span>
				<button class="row-name" onclick={() => openSheetId = sheet.id}>{sheet.name}</button>
				<RowMenu items={[
					{ label: 'ℹ️ Info', action: () => infoTarget = { kind: 'sheet', data: sheet } },
					{ label: '✏ Rename', action: () => startRename(sheet.id, sheet.name, 'sheet') },
					{ label: '🗑 Delete', danger: true, action: () => askDelete(`Delete spreadsheet "${sheet.name}"? All data will be lost.`, () => deleteSheet(sheet.id)) }
				]} />
			</div>
		{/each}

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
						<button onclick={() => { showNewFolder = false; newFolderName = ''; newFolderColor = '#6366f1'; }}>Cancel</button>
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
						<button onclick={() => { showNewList = false; newListName = ''; newListType = 'plain'; newListColor = '#6366f1'; }}>Cancel</button>
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

		<!-- Smart folder assign dialog -->
		{#if sfDialogFolder !== null}
			{@const fid = sfDialogFolder.id}
			<div class="sf-backdrop" role="dialog" aria-modal="true"
				onclick={(e) => { if (e.target === e.currentTarget) sfDialogFolder = null; }}>
				<div class="sf-dialog">
					<div class="sf-title">📋 Smart Folders</div>
					<div class="sf-folder-name">📁 {sfDialogFolder.name}</div>
					{#if sfReportNames().length > 0}
						<div class="sf-section">Assign to report:</div>
						<div class="sf-list">
							{#each sfReportNames() as rname}
								{@const assigned = (smartFolders[rname] ?? []).includes(fid)}
								<button
									class="sf-opt"
									class:sf-opt-active={assigned}
									onclick={() => assigned ? removeFromReport(fid, rname) : assignToReport(fid, rname)}
								>{assigned ? '☑' : '☐'} {rname}</button>
							{/each}
						</div>
					{/if}
					<div class="sf-section">New report name:</div>
					<div class="sf-new-row">
						<input
							class="sf-input"
							bind:value={sfNewName}
							placeholder="Report name…"
							onkeydown={(e) => { if (e.key === 'Enter' && sfNewName.trim()) { assignToReport(fid, sfNewName.trim()); sfNewName = ''; } }}
						/>
						<button
							class="sf-add-btn"
							onclick={() => { if (sfNewName.trim()) { assignToReport(fid, sfNewName.trim()); sfNewName = ''; } }}
							disabled={!sfNewName.trim()}
						>Add</button>
					</div>
					<button class="sf-close" onclick={() => sfDialogFolder = null}>Done</button>
				</div>
			</div>
		{/if}

		<!-- Info dialog -->
		{#if infoTarget}
			{@const d = infoTarget.data}
			<InfoDialog
				title={d.name}
				rows={infoTarget.kind === 'folder'
					? [
						{ label: 'Type', value: 'Folder' },
						{ label: 'Created', value: fmtDate(d.createdAt) },
						{ label: 'Modified', value: fmtDate(d.updatedAt) }
					]
					: infoTarget.kind === 'sheet'
					? [
						{ label: 'Type', value: 'Spreadsheet' },
						{ label: 'Created', value: fmtDate(d.createdAt) },
						{ label: 'Modified', value: fmtDate(d.updatedAt) }
					]
					: [
						{ label: 'Type', value: (d as ListMeta).type === 'priced' ? 'Priced list' : 'Plain list' },
						{ label: 'Created', value: fmtDate(d.createdAt) },
						{ label: 'Modified', value: fmtDate(d.updatedAt) }
					]}
				onClose={() => infoTarget = null}
			/>
		{/if}
		{/if}<!-- end search else -->
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
		font-size: 1rem;
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
	.home-crumb { font-size: 1.25rem; }
	.sep { color: var(--text2); }

	/* Sheet row */
	.sheet-row { gap: 0.5rem; }
	.sheet-icon { font-size: 1.1rem; flex-shrink: 0; }
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
	.row.done .row-name { text-decoration: line-through; color: var(--text2); opacity: 0.55; }
	.row.done .check-circle { opacity: 0.55; }
	.row.done .fav-btn { opacity: 0.55; }
	.row.done .drag-handle { opacity: 0.55; }
	.row.archived .row-name { font-style: italic; opacity: 0.6; }
	.row.archived .check-circle { opacity: 0.6; }
	.row.archived .fav-btn { opacity: 0.6; }
	.row.archived .drag-handle { opacity: 0.6; }
	.path-through-hint { color: var(--accent); font-size: 0.85em; opacity: 0.7; }
	/* ── Pinned items bar ────────────────────────────────────────────────────── */
	.pin-bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
		padding: 0.4rem 1rem;
		background: var(--bg2);
		border-bottom: 1px solid var(--border);
	}
	.pin-label { font-size: 1rem; flex-shrink: 0; }
	.pin-chip {
		background: none;
		border: 1px solid var(--accent);
		border-radius: 999px;
		padding: 0.2rem 0.65rem;
		font-size: 0.82rem;
		color: var(--accent);
		cursor: pointer;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 220px;
	}
	.pin-chip:hover { background: color-mix(in srgb, var(--accent) 10%, transparent); }
	.pin-chip.pin-chip-checked {
		text-decoration: line-through;
		opacity: 0.6;
	}
	.pin-chip-list {
		font-size: 0.75em;
		opacity: 0.75;
	}
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
	/* ── Search ───────────────────────────────────────────────────────────────── */
	.icon-btn.search-active { color: var(--accent); }
	.search-btn { flex-shrink: 0; }
	.search-crumb {
		color: var(--accent);
		opacity: 0.75;
		font-size: 0.88rem;
		white-space: nowrap;
		max-width: 140px;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.header-left {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		min-width: 0;
		flex: 1;
	}
	.search-bar {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 1rem;
		background: var(--bg2);
		border-bottom: 1px solid var(--border);
	}
	.search-input {
		flex: 1;
		border: 1px solid var(--border);
		border-radius: 10px;
		padding: 0.5rem 0.75rem;
		font-size: 1rem;
		background: var(--bg);
		color: var(--text);
		outline: none;
	}
	.search-input:focus { border-color: var(--accent); }
	.search-clear {
		background: none;
		border: none;
		font-size: 1.1rem;
		cursor: pointer;
		color: var(--text2);
		padding: 0.25rem;
		min-width: 32px;
		min-height: 44px;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.search-empty {
		text-align: center;
		padding: 2rem 1rem;
		color: var(--text2);
		font-size: 0.95rem;
	}
	.search-result-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.65rem 1rem;
		border: none;
		border-bottom: 1px solid var(--border);
		background: none;
		text-align: left;
		cursor: pointer;
		min-height: 52px;
	}
	.search-result-row:active { background: var(--bg2); }
	.result-icon { font-size: 1.1rem; flex-shrink: 0; }
	.result-info {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.result-name {
		font-size: 1rem;
		color: var(--text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.result-path {
		font-size: 0.78rem;
		color: var(--text2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.result-kind-badge {
		font-size: 0.7rem;
		color: var(--accent);
		border: 1px solid var(--accent);
		border-radius: 99px;
		padding: 0.1rem 0.4rem;
		flex-shrink: 0;
		white-space: nowrap;
	}
	/* ── Reports dropdown ────────────────────────────────────────────────────── */
	.reports-wrap {
		position: relative;
	}
	.reports-menu {
		position: fixed;
		top: 52px;
		right: 52px;
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 12px;
		box-shadow: 0 4px 24px rgba(0,0,0,0.18);
		min-width: 180px;
		z-index: 90;
		overflow: hidden;
	}
	.reports-header {
		padding: 0.55rem 1rem 0.35rem;
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--text2);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		border-bottom: 1px solid var(--border);
	}
	.reports-item {
		display: block;
		width: 100%;
		background: none;
		border: none;
		text-align: left;
		padding: 0.8rem 1rem;
		font-size: 0.95rem;
		color: var(--text);
		cursor: pointer;
		border-bottom: 1px solid var(--border);
	}
	.reports-item:last-child { border-bottom: none; }
	.reports-item:hover { background: var(--bg2); }
	/* ── Smart folder assign dialog ──────────────────────────────────────────── */
	.sf-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0,0,0,0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 100;
		padding: 1rem;
	}
	.sf-dialog {
		background: var(--bg);
		border-radius: 16px;
		padding: 1.25rem;
		max-width: 320px;
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.sf-title {
		font-size: 1rem;
		font-weight: 700;
		margin-bottom: 0.1rem;
	}
	.sf-folder-name {
		font-size: 0.9rem;
		color: var(--text2);
		margin-bottom: 0.25rem;
	}
	.sf-section {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--text2);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin-top: 0.25rem;
	}
	.sf-list {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}
	.sf-opt {
		background: none;
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 0.55rem 0.75rem;
		text-align: left;
		font-size: 0.9rem;
		color: var(--text);
		cursor: pointer;
	}
	.sf-opt.sf-opt-active {
		border-color: var(--accent);
		color: var(--accent);
		background: color-mix(in srgb, var(--accent) 8%, transparent);
	}
	.sf-new-row {
		display: flex;
		gap: 0.4rem;
	}
	.sf-input {
		flex: 1;
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 0.5rem 0.65rem;
		font-size: 0.9rem;
		background: var(--bg2);
		color: var(--text);
	}
	.sf-add-btn {
		background: var(--accent);
		color: #fff;
		border: none;
		border-radius: 8px;
		padding: 0.5rem 0.85rem;
		font-size: 0.9rem;
		font-weight: 600;
		cursor: pointer;
	}
	.sf-add-btn:disabled { opacity: 0.4; cursor: default; }
	.sf-close {
		background: var(--bg3);
		border: none;
		border-radius: 10px;
		padding: 0.7rem;
		font-size: 0.95rem;
		font-weight: 600;
		cursor: pointer;
		color: var(--text);
		margin-top: 0.25rem;
	}
</style>
