<script lang="ts">
	import { docState, commitState, getUndoManager, canUndo, getUndoCount } from '$lib/yjsStore.svelte';
	import { onDestroy, tick, untrack } from 'svelte';
	import {
		readItems,
		readAllItems,
		readLists,
		readFolders,
		createItem,
		createItemsBatch,
		createItemsFromExport,
		updateItem,
		deleteItemCascade,
		deleteItemsBatch,
		setItemsChecked,
		setItemCheckboxState,
		clearItemCheckboxes,
		isItemDone,
		updateList,
		reorderSiblings,
		isListEffectivelyArchived,
		isFolderEffectivelyArchived,
		getMaxFavouriteOrder,
		type Item,
		type ExportedItem,
		type ListMeta,
		type Folder,
		type FilterView
	} from '$lib/data';
	import { settings, updateSettings } from '$lib/settings.svelte';
	import { extractTags, splitWithTags, type NameSegment } from '$lib/tags';
	import NumericKeypad from './NumericKeypad.svelte';
	import ConfirmDialog from './ConfirmDialog.svelte';
	import RowMenu from './RowMenu.svelte';
	import InfoDialog from './InfoDialog.svelte';
	import CopyLinkDialog from './CopyLinkDialog.svelte';
	import FullScreenEditor from './FullScreenEditor.svelte';

	let {
		listId,
		orderedLists = [],
		highlightItemId = null,
		onHome,
		onOpenList,
		onOpenFavouritesOrder = undefined,
		savedSearch = null,
		onRestoreSearch = undefined,
		onTagClick = undefined,
		onNavigateTo = undefined
	}: {
		listId: string;
		orderedLists?: { id: string; name: string }[];
		highlightItemId?: string | null;
		onHome: () => void;
		onOpenList: (id: string) => void;
		onOpenFavouritesOrder?: () => void;
		savedSearch?: string | null;
		onRestoreSearch?: () => void;
		onTagClick?: (tag: string) => void;
		onNavigateTo?: (folderId: string | null) => void;
	} = $props();

	let showUndoConfirm = $state(false);

	let items = $derived.by(() => {
		void docState.version;
		try { return readItems(listId); } catch { return []; }
	});
	let listMeta = $derived.by(() => {
		void docState.version;
		try { return readLists().find((l) => l.id === listId) ?? null; } catch { return null; }
	});

	let allLists = $derived.by(() => {
		void docState.version;
		try { return readLists(); } catch { return []; }
	});
	let allFolders = $derived.by(() => {
		void docState.version;
		try { return readFolders(); } catch { return []; }
	});
	let currentFolder = $derived(listMeta ? (allFolders.find((f) => f.id === listMeta.folderId) ?? null) : null);
	// Named checkboxes configured on the current list's folder — empty = legacy single checkbox.
	let folderCheckboxes = $derived(currentFolder?.checkboxes ?? []);
	function isChecked(item: Item, checkboxId: string): boolean {
		return !!item.checks[checkboxId];
	}
	function toggleItemCheckbox(item: Item, checkboxId: string) {
		setItemCheckboxState(item.id, checkboxId, !isChecked(item, checkboxId));
	}
	function chipLabel(name: string): string {
		// Array.from (not .slice) so we don't cut a surrogate pair / emoji in half.
		return Array.from(name.trim()).slice(0, 2).join('').toUpperCase();
	}
	function isDone(item: Item): boolean {
		return isItemDone(item, currentFolder);
	}
	/** Whether ANY checkbox is checked on this item — used for "is there
	 *  anything to uncheck" (bulkUncheck clears every named checkbox, not just
	 *  the done-determining last one, so its visibility must match that, not
	 *  isDone()). */
	function hasAnyChecked(item: Item): boolean {
		if (folderCheckboxes.length > 0) {
			return folderCheckboxes.some((c) => isChecked(item, c.id));
		}
		return item.checked;
	}
	/** Quick "mark done" toggle used where there's no room for individual chips
	 *  (e.g. the pinned-items bar) — toggles the last (done-determining) named
	 *  checkbox, or the legacy checked flag if the folder has none configured. */
	function toggleDone(item: Item) {
		if (folderCheckboxes.length > 0) {
			toggleItemCheckbox(item, folderCheckboxes[folderCheckboxes.length - 1].id);
		} else {
			toggleCheck(item);
		}
	}
	/** Converting an item to a heading should clear ALL done-state — including
	 *  any named-checkbox state — so it doesn't silently reappear if the item
	 *  is later turned back into a regular item. */
	function makeHeading(item: Item) {
		if (folderCheckboxes.length > 0) {
			clearItemCheckboxes([item.id], folderCheckboxes.map((c) => c.id));
		}
		updateItem(item.id, { heading: true, checked: false, price: null, qty: null });
	}
	function doneLabel(item: Item): string {
		if (folderCheckboxes.length > 0) {
			const names = folderCheckboxes.filter((c) => isChecked(item, c.id)).map((c) => c.name);
			return names.length > 0 ? `✓(${names.join(',')})` : '';
		}
		return item.checked ? '✓' : '';
	}
	let favouriteLists = $derived(allLists.filter((l) => l.favourite && !isListEffectivelyArchived(l, allFolders)));
	let favouriteFolders = $derived(allFolders.filter((f) => f.favourite && !isFolderEffectivelyArchived(f.id, allFolders)));
	let favouriteItems = $derived.by(() => {
		const folders = favouriteFolders.map((f) => ({ type: 'folder' as const, item: f, order: f.favouriteOrder ?? f.order ?? 0 }));
		const lists = favouriteLists.map((l) => ({ type: 'list' as const, item: l, order: l.favouriteOrder ?? l.order ?? 0 }));
		return [...folders, ...lists].sort((a, b) => (a.order !== b.order ? a.order - b.order : a.type === 'folder' && b.type === 'list' ? -1 : a.type === 'list' && b.type === 'folder' ? 1 : 0));
	});
	let allItemsAll = $derived.by(() => {
		void docState.version;
		try { return readAllItems(); } catch { return [] as Item[]; }
	});

	let allPinnedItems = $derived.by(() => {
		try {
			const activeLists = new Set(allLists.filter((l) => !isListEffectivelyArchived(l, allFolders)).map((l) => l.id));
			return allItemsAll.filter((i) => i.pinned && activeLists.has(i.listId));
		} catch { return []; }
	});

	$effect(() => {
		if (highlightItemId) {
			let t: ReturnType<typeof setTimeout>;
			tick().then(() => {
				const el = document.querySelector(`[data-item-id="${highlightItemId}"]`);
				if (el) {
					el.scrollIntoView({ behavior: 'smooth', block: 'center' });
					el.classList.add('highlight-animation');
					t = setTimeout(() => el.classList.remove('highlight-animation'), 2000);
				}
			});
			return () => clearTimeout(t);
		}
	});

	// ── Breadcrumb ────────────────────────────────────────────────────────────────
	// Build an ordered array of { id, name } entries from root down to current list.
	// null id = root home.
	type CrumbItem = { id: string | null; name: string };
	let breadcrumbItems = $derived.by((): CrumbItem[] => {
		if (!listMeta) return [];
		const folders: CrumbItem[] = [];
		const visited = new Set<string>();
		let fid: string | null = listMeta.folderId;
		while (fid !== null) {
			if (visited.has(fid)) break;
			visited.add(fid);
			const f = allFolders.find((x) => x.id === fid);
			if (!f) break;
			folders.unshift({ id: f.id, name: f.name });
			fid = f.parentId;
		}
		return [
			// null home crumb omitted — the 🏠 button in the header handles home navigation
			...folders,
			{ id: 'LIST', name: listMeta.name }
		];
	});

	function navigateToCrumb(crumb: CrumbItem) {
		if (crumb.id !== 'LIST') {
			onNavigateTo?.(crumb.id);
		}
	}

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

	let cursorMemory = $state<Record<string, string>>(
		(typeof sessionStorage !== 'undefined')
			? (function(){ try { return JSON.parse(sessionStorage.getItem('pnl-cursor-memory') || '{}'); } catch { return {}; } })()
			: {}
	);

	let journalMode = $derived(listMeta?.journalMode ?? false);

	function toggleJournalMode() {
		if (listMeta) {
			updateList(listId, { journalMode: !(listMeta.journalMode ?? false) });
		}
	}

	function formatJournalDate(dateStr: string) {
		const d = new Date(dateStr);
		return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	}

	$effect(() => {
		if (typeof sessionStorage !== 'undefined') {
			sessionStorage.setItem('pnl-cursor-memory', JSON.stringify(cursorMemory));
		}
	});

	let activeCursorId = $derived(cursorMemory[listId] || null);
	let activeCursorIndex = $derived(activeCursorId ? filteredTreeItems.findIndex(i => i.item.id === activeCursorId) : -1);

	function handleGlobalKeydown(e: KeyboardEvent) {
		// Do not trigger global shortcuts if the user is typing in an input
		if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || (e.target instanceof HTMLElement && e.target.isContentEditable)) return;
		if (fullScreenNoteItem !== null) return;

		// Modifier keys should not trigger a bind by themselves
		if (['Control', 'Meta', 'Alt', 'Shift', 'CapsLock'].includes(e.key)) return;

		let modifiers = [];
		if (e.ctrlKey) modifiers.push('Ctrl');
		if (e.metaKey) modifiers.push('Meta');
		if (e.altKey) modifiers.push('Alt');
		if (e.shiftKey) modifiers.push('Shift');

		let keyName = e.key;
		if (keyName === ' ') keyName = 'Space';
		else if (keyName === 'Escape') keyName = 'Esc';
		else if (keyName === 'ArrowUp') keyName = 'Up';
		else if (keyName === 'ArrowDown') keyName = 'Down';
		else if (keyName === 'ArrowLeft') keyName = 'Left';
		else if (keyName === 'ArrowRight') keyName = 'Right';

		const combo = [...modifiers, keyName].join('+');

		if (combo === settings.keybindings?.['up'] || combo === settings.keybindings?.['down']) {
			if (filteredTreeItems.length === 0) return;
			e.preventDefault();
			const dir = combo === settings.keybindings?.['up'] ? -1 : 1;
			let nextIdx = activeCursorIndex + dir;
			if (nextIdx < 0) nextIdx = filteredTreeItems.length - 1;
			if (nextIdx >= filteredTreeItems.length) nextIdx = 0;
			
			const nextId = filteredTreeItems[nextIdx].item.id;
			cursorMemory[listId] = nextId;

			// Scroll into view
			tick().then(() => {
				document.getElementById('item-' + nextId)?.scrollIntoView({ block: 'nearest' });
			});
		} else if (combo === settings.keybindings?.['open']) {
			if (activeCursorIndex >= 0 && activeCursorIndex < filteredTreeItems.length) {
				e.preventDefault();
				const item = filteredTreeItems[activeCursorIndex].item;
				startEditName(item);
			}
		}
	}

	// Sum in integer cents to avoid float accumulation (e.g. 0.1+0.2 = 0.300...04)
	const total = $derived(
		Math.round(items
			.filter((i) => !i.heading && !i.note)
			.reduce((s, i) => s + Math.round((i.price ?? 0) * (i.qty ?? 1) * 100), 0)) / 100
	);

	// ── URL + tag detection ──────────────────────────────────────────────────────
	function parseNameParts(name: string): NameSegment[] {
		return splitWithTags(name);
	}

	// ── All tags (for autocomplete) ───────────────────────────────────────────────
	const allTags = $derived.by(() => {
		const set = new Set<string>();
		for (const item of items) extractTags(item.name).forEach((t) => set.add(t));
		for (const list of allLists) extractTags(list.name).forEach((t) => set.add(t));
		for (const folder of allFolders) extractTags(folder.name).forEach((t) => set.add(t));
		return [...set].sort();
	});

	// ── Tag autocomplete ──────────────────────────────────────────────────────────
	let tagSuggestions = $state<string[]>([]);

	function updateTagSuggestions() {
		if (!universalInputEl) { tagSuggestions = []; return; }
		const pos = universalInputEl.selectionStart ?? 0;
		const before = universalValue.slice(0, pos);
		const m = before.match(/#(\w*)$/);
		if (m) {
			const prefix = m[1].toLowerCase();
			tagSuggestions = allTags.filter((t) => t.startsWith(prefix) && t !== prefix).slice(0, 6);
		} else {
			tagSuggestions = [];
		}
	}

	function applyTagSuggestion(tag: string) {
		if (!universalInputEl) return;
		const pos = universalInputEl.selectionStart ?? universalValue.length;
		const before = universalValue.slice(0, pos);
		const after = universalValue.slice(pos);
		const newBefore = before.replace(/#\w*$/, '#' + tag);
		universalValue = newBefore + after;
		tagSuggestions = [];
		tick().then(() => {
			if (universalInputEl) {
				universalInputEl.selectionStart = universalInputEl.selectionEnd = newBefore.length;
				universalInputEl.focus();
			}
		});
	}

	// ── Tree order (subtasks / subnotes) ──────────────────────────────────────────
	type TreeItem = { item: Item; level: number; tlIdx: number; rootTlIdx: number; sibIdx: number };
	function buildTreeOrder(allItems: Item[]): TreeItem[] {
		const result: TreeItem[] = [];
		const validIds = new Set(allItems.map((i) => i.id));
		const rendered = new Set<string>();
		function addSubtree(item: Item, level: number, rootTlIdx: number) {
			const children = allItems
				.filter((i) => i.parentId === item.id)
				.sort((a, b) => a.order - b.order);
			children.forEach((child, sibIdx) => {
				result.push({ item: child, level, tlIdx: -1, rootTlIdx, sibIdx });
				rendered.add(child.id);
				if (level < 2) addSubtree(child, level + 1, rootTlIdx);
			});
		}
		const topLevel = allItems.filter((i) => i.parentId === null).sort((a, b) => a.order - b.order);
		topLevel.forEach((item, idx) => {
			result.push({ item, level: 0, tlIdx: idx, rootTlIdx: idx, sibIdx: idx });
			rendered.add(item.id);
			if (!item.heading) addSubtree(item, 1, idx);
		});
		// Append orphaned items
		const orphans = allItems.filter((i) => i.parentId !== null && !validIds.has(i.parentId) && !rendered.has(i.id));
		orphans.forEach((item, idx) => {
			result.push({ item, level: 0, tlIdx: topLevel.length + idx, rootTlIdx: topLevel.length + idx, sibIdx: topLevel.length + idx });
			rendered.add(item.id);
			if (!item.heading) addSubtree(item, 1, topLevel.length + idx);
		});
		return result;
	}
	const treeItems = $derived(buildTreeOrder(items));
	const filterView = $derived<FilterView>(listMeta?.filterView ?? 'all');
	const filteredTreeItems = $derived(
		filterView === 'all'
			? treeItems
			: (() => {
				const visibleIds = new Set<string>();
				for (const { item } of treeItems) {
					if (item.heading || (item.note && item.parentId === null) || (!item.note && !item.heading && (filterView === 'checked' ? isDone(item) : !isDone(item)))) {
						visibleIds.add(item.id);
					}
				}
				for (const { item } of treeItems) {
					if (item.note && item.parentId !== null && visibleIds.has(item.parentId)) {
						visibleIds.add(item.id);
					}
				}
				return treeItems.filter(({ item }) => visibleIds.has(item.id));
			})()
	);
	let selectionMode = $state(false);
	let selectedIds = $state<Set<string>>(new Set());

	// Count of all checked items (excluding headings and notes)
	const checkedCount = $derived(items.filter((i) => !i.heading && !i.note && isDone(i)).length);
	const uncheckedCount = $derived(items.filter((i) => !i.heading && !i.note && !isDone(i)).length);
	// Count of items that "Del checked" would actually delete
	const delCheckedCount = $derived(
		selectedIds.size > 0
			? items.filter((i) => selectedIds.has(i.id) && isDone(i)).length
			: checkedCount
	);

	// ── Universal input (add + edit) ─────────────────────────────────────────
	// A single text input always at the top — iOS opens keyboard in the same
	// place every time, preventing the scroll-jump on focus.
	type InputMode = 'add' | 'edit';
	let inputMode = $state<InputMode>('add');
	let universalValue = $state('');
	// bind:this requires a plain let (not $state) to receive the real DOM node
	let universalInputEl = $state<HTMLTextAreaElement | null>(null);

	function resizeUniversal() {
		if (!universalInputEl) return;
		universalInputEl.style.height = 'auto';
		universalInputEl.style.height = universalInputEl.scrollHeight + 'px';
	}

	$effect(() => {
		void universalValue;
		tick().then(resizeUniversal);
	});
	// Subtask / subnote context when adding a child item
	let newItemParentId = $state<string | null>(null);
	let newItemIsNote = $state(listMeta?.defaultIsNote ?? false);

	$effect(() => {
		if (newItemParentId === null) {
			newItemIsNote = listMeta?.defaultIsNote ?? false;
		}
	});

	function focusInput() {
		tick().then(() => universalInputEl?.focus());
	}

	function addItem() {
		if (!universalValue.trim()) return;
		// Only apply addPosition for top-level items; subtasks/subnotes always append
		const pos = newItemParentId ? 'bottom' : settings.addItemPosition;
		createItem(listId, universalValue.trim(), null, newItemParentId, newItemIsNote, pos);
		universalValue = '';
		newItemParentId = null;
		newItemIsNote = listMeta?.defaultIsNote ?? false;
		focusInput();
	}

	// ── Clipboard import ───────────────────────────────────────────────────
	async function exportToClipboard() {
		const source = selectedIds.size > 0 ? selectedItems : treeItems.map(({ item }) => item);
		const exportData = {
			__list_app__: true,
			items: source.map((item) => {
				const ex: ExportedItem = { id: item.id, name: item.name };
				if (item.price !== null) ex.price = item.price;
				if (item.qty !== null) ex.qty = item.qty;
				if (folderCheckboxes.length > 0) {
					const names = folderCheckboxes.filter((c) => isChecked(item, c.id)).map((c) => c.name);
					if (names.length > 0) ex.checkedNames = names;
				} else if (item.checked) {
					ex.checked = true;
				}
				if (item.heading) ex.heading = true;
				if (item.note) ex.note = true;
				if (item.pinned) ex.pinned = true;
				if (item.parentId !== null) ex.parentId = item.parentId;
				return ex;
			})
		};
		const json = JSON.stringify(exportData, null, 2);
		try {
			await navigator.clipboard.writeText(json);
			copyMessage = '✓ Copied as JSON!';
			copyStatus = 'copied';
			setTimeout(() => { copyStatus = 'idle'; }, 2000);
		} catch {
			copyMessage = '✗ Clipboard access denied.';
			copyStatus = 'error';
			setTimeout(() => { copyStatus = 'idle'; }, 3000);
		}
		showHeaderMenu = false;
	}

	let isPasting = false;

	async function importFromClipboard() {
		if (isPasting) return;
		isPasting = true;
		let text: string;
		try {
			text = await navigator.clipboard.readText();
		} catch {
			alert('Could not read clipboard. Make sure you have granted clipboard permission.');
			return;
		}

		// Try JSON export format first
		const trimmed = text.trim();
		if (trimmed.startsWith('{')) {
			try {
				const data = JSON.parse(trimmed);
				if (data.__list_app__ === true && Array.isArray(data.items) && data.items.length > 0) {
					createItemsFromExport(listId, data.items as ExportedItem[]);
					return;
				}
			} catch {
				// Not valid JSON — fall through to plain-text import
			}
		}

		// Plain text: one item per line
		const lines = text
			.split(/\r?\n/)
			.map((l) => l.trim())
			.filter((l) => l.length > 0)        // strip blank / whitespace-only lines
			.filter((l) => /\p{L}/u.test(l));   // strip lines with no letter in any script
		if (lines.length === 0) {
			alert('No valid items found in clipboard.');
			return;
		}
		createItemsBatch(listId, lines, settings.addItemPosition);
	}

	// ── Edit item name via universal input ────────────────────────────────────────
	let editingId = $state<string | null>(null);

	// Which item's price is currently being edited via the keypad
	let pricingItemId = $state<string | null>(null);
	let priceBuffer = $state('');

	// Which item's quantity is currently being edited via the keypad
	let qtyItemId = $state<string | null>(null);
	let qtyBuffer = $state('');

	function startEditName(item: Item) {
		if (commitState.isHistorical) return;
		editingId = item.id;
		inputMode = 'edit';
		universalValue = item.name;
		pricingItemId = null;
		qtyItemId = null;
		newItemParentId = null;
		newItemIsNote = listMeta?.defaultIsNote ?? false;
		focusInput();
	}

	function submitEditName() {
		if (!editingId) return;
		const trimmed = universalValue.trim();
		if (trimmed) updateItem(editingId, { name: trimmed });
		universalInputEl?.blur();
		cancelEdit();
	}

	function cancelEdit() {
		editingId = null;
		inputMode = 'add';
		universalValue = '';
		newItemParentId = null;
		newItemIsNote = listMeta?.defaultIsNote ?? false;
		universalInputEl?.blur();
	}

	function startEditPrice(item: Item) {
		cancelLongPress(); // prevent long-press selection firing after price editor opens
		pricingItemId = item.id;
		qtyItemId = null;
		// Use toFixed to avoid float stringification artefacts (e.g. 1.1000000000000001)
		priceBuffer = item.price !== null
			? (item.price < 0 ? '-' : '') + Math.abs(item.price).toFixed(2).replace(/\.?0+$/, '')
			: '';
		cancelEdit();
	}

	function startEditQty(item: Item) {
		cancelLongPress();
		qtyItemId = item.id;
		pricingItemId = null;
		qtyBuffer = item.qty !== null ? String(item.qty) : '';
		cancelEdit();
	}

	function handleKeypadInput(key: string) {
		if (qtyItemId) {
			// Quantity mode — integers only, no decimal, no negative
			if (key === 'enter') {
				commitQty();
			} else if (key === 'backspace') {
				qtyBuffer = qtyBuffer.slice(0, -1);
			} else if (key === 'minus' || key === '.') {
				// Not allowed for qty
			} else {
				if (qtyBuffer.length >= 4) return; // max 4 digits
				qtyBuffer += key;
			}
			return;
		}
		if (!pricingItemId) return;
		if (key === 'enter') {
			commitPrice();
		} else if (key === 'backspace') {
			priceBuffer = priceBuffer.slice(0, -1);
		} else if (key === 'minus') {
			// Toggle sign — just prepend/strip the '-' character to preserve what was typed
			if (!priceBuffer || priceBuffer === '-') return;
			priceBuffer = priceBuffer.startsWith('-') ? priceBuffer.slice(1) : '-' + priceBuffer;
		} else if (key === '.') {
			if (!priceBuffer.includes('.')) priceBuffer += '.';
		} else {
			// Limit to 2 decimal places
			const parts = priceBuffer.split('.');
			if (parts[1] !== undefined && parts[1].length >= 2) return;
			priceBuffer += key;
		}
	}

	function commitPrice() {
		if (!pricingItemId) return;
		const val = parseFloat(priceBuffer);
		updateItem(pricingItemId, { price: isNaN(val) ? null : Math.round(val * 100) / 100 });
		pricingItemId = null;
		priceBuffer = '';
	}

	function commitQty() {
		if (!qtyItemId) return;
		const val = parseInt(qtyBuffer, 10);
		updateItem(qtyItemId, { qty: isNaN(val) || val <= 0 ? null : val });
		qtyItemId = null;
		qtyBuffer = '';
	}

	// ── Physical keyboard input for the numeric keypad ────────────────────────────
	// When the price/qty keypad is open, route physical keyboard events through
	// handleKeypadInput so laptop/desktop/iPad-with-keyboard users can type normally.
	// The SIP (software keyboard) is intentionally NOT triggered — no text input is
	// focused while the custom keypad is open.
	$effect(() => {
		if (!pricingItemId && !qtyItemId) return;
		function onKeyDown(e: KeyboardEvent) {
			// Don't intercept if focus is inside a text input (e.g. the universal bar somehow active)
			if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
			let key: string | null = null;
			if (e.key >= '0' && e.key <= '9') key = e.key;
			else if (e.key === 'Backspace') key = 'backspace';
			else if (e.key === 'Enter') key = 'enter';
			else if (e.key === '.' || e.key === ',') key = '.';
			else if (e.key === '-') key = 'minus';
			else if (e.key === 'Escape') {
				// Escape = cancel (discard), Enter = commit (save)
				e.preventDefault();
				if (pricingItemId) { pricingItemId = null; priceBuffer = ''; }
				else { qtyItemId = null; qtyBuffer = ''; }
			}
			if (key !== null) {
				e.preventDefault();
				handleKeypadInput(key);
			}
		}
		document.addEventListener('keydown', onKeyDown);
		return () => document.removeEventListener('keydown', onKeyDown);
	});

	// Cache Intl formatters — creating them on every call is expensive
	const _numFmt = new Intl.NumberFormat(undefined, {
		style: 'decimal', minimumFractionDigits: 2, maximumFractionDigits: 2
	});
	// Detect whether currency symbol goes before the number.
	// Test with USD: format as currency and check if first char is non-digit/non-space.
	const _symbolBefore = (() => {
		const s = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(1);
		return /^[^\d\s]/.test(s); // true if starts with a symbol character
	})();

	function formatPrice(price: number | null): string {
		if (price === null) return '—';
		const symbol = settings.currency;
		const formatted = _numFmt.format(Math.abs(price));
		const sign = price < 0 ? '-' : '';
		return _symbolBefore ? `${sign}${symbol}${formatted}` : `${sign}${formatted}${symbol}`;
	}

	// ── Check-off ────────────────────────────────────────────────────────────────
	function toggleCheck(item: Item) {
		updateItem(item.id, { checked: !item.checked });
	}

	// ── Bulk actions ─────────────────────────────────────────────────────────────
	// Move items

	// ── Selection mode ────────────────────────────────────────────────────────────
	let showSelectionPanel = $state(false);

	function enterSelectionMode() {
		selectedIds = new Set();
		selectionMode = true;
		showSelectionPanel = false;
		showHeaderMenu = false;
		// Cancel any in-progress editing states
		cancelEdit();
		pricingItemId = null; priceBuffer = '';
		qtyItemId = null; qtyBuffer = '';
	}

	function exitSelectionMode() {
		selectionMode = false;
		showSelectionPanel = false;
		selectedIds = new Set();
	}

	function toggleSelectionItem(id: string) {
		const next = new Set(selectedIds);
		if (next.has(id)) next.delete(id); else next.add(id);
		selectedIds = next;
	}

	const selectedItems = $derived(
		treeItems.filter(({ item }) => selectedIds.has(item.id)).map(({ item }) => item)
	);

	function deleteSelected() {
		const ids = [...selectedIds];
		deleteItemsBatch(ids);
		exitSelectionMode();
	}

	function isInvalidReparentTarget(targetId: string): boolean {
		if (selectedIds.has(targetId)) return true;
		let curr = targetId;
		while (curr) {
			const item = items.find(i => i.id === curr);
			if (!item) break;
			if (item.parentId && selectedIds.has(item.parentId)) return true;
			curr = item.parentId || '';
		}
		return false;
	}

	function reparentSelectedTo(targetId: string) {
		if (isInvalidReparentTarget(targetId)) return;
		for (const id of selectedIds) {
			updateItem(id, { parentId: targetId });
		}
		exitSelectionMode();
	}

	function reparentSelectedToRoot() {
		for (const id of selectedIds) {
			updateItem(id, { parentId: null });
		}
		exitSelectionMode();
	}

	function getReparentMenuItem(targetId: string) {
		if (selectionMode && selectedIds.size > 0 && !isInvalidReparentTarget(targetId)) {
			return [{ label: '↳ Reparent selected here', action: () => reparentSelectedTo(targetId) }];
		}
		return [];
	}


	function cycleFilter() {
		const next: FilterView = filterView === 'all' ? 'unchecked' : filterView === 'unchecked' ? 'checked' : 'all';
		updateList(listId, { filterView: next });
	}

	function bulkUncheck() {
		const ids = selectedIds.size > 0
			? [...selectedIds].filter((id) => { const it = items.find((i) => i.id === id); return it && !it.heading && !it.note; })
			: items.filter((i) => !i.heading && !i.note).map((i) => i.id);
		if (folderCheckboxes.length > 0) {
			clearItemCheckboxes(ids, folderCheckboxes.map((c) => c.id));
		} else {
			setItemsChecked(ids, false);
		}
		selectedIds = new Set();
	}

	function bulkDeleteChecked() {
		const targets =
			selectedIds.size > 0
				? items.filter((i) => selectedIds.has(i.id) && isDone(i)).map((i) => i.id)
				: items.filter((i) => isDone(i)).map((i) => i.id);
		deleteItemsBatch(targets);
		selectedIds = new Set();
	}

	// ── Long-press to select items ────────────────────────────────────────────────
	// `onlongpress` is not a real DOM event — implement via pointer events + timer.
	let longPressTimer: ReturnType<typeof setTimeout> | null = null;

	function onPointerDown(e: PointerEvent, id: string) {
		// Only fire on primary button / single touch
		if (e.button !== 0 && e.pointerType !== 'touch') return;
		longPressTimer = setTimeout(() => {
			if (!selectionMode) enterSelectionMode();
			toggleSelectionItem(id);
			longPressTimer = null;
		}, 500);
	}

	function cancelLongPress() {
		if (longPressTimer !== null) { clearTimeout(longPressTimer); longPressTimer = null; }
	}

	onDestroy(() => cancelLongPress());

	// ── Drag reorder (pointer events — works on both touch and mouse) ──────────────
	let touchDragFrom = $state<number | null>(null);
	let touchDragOver = $state<number | null>(null);
	let touchDragParentKey = $state<string | null>(null); // item.parentId ?? '__top__'

	function startItemDrag(e: PointerEvent, sibIdx: number, parentKey: string) {
		e.stopPropagation();
		cancelLongPress();
		touchDragFrom = sibIdx;
		touchDragOver = sibIdx;
		touchDragParentKey = parentKey;
	}

	$effect(() => {
		if (touchDragFrom === null) return;
		function onMove(e: PointerEvent) {
			e.preventDefault();
			const el = document.elementFromPoint(e.clientX, e.clientY);
			const row = el?.closest('[data-sibling-index]') as HTMLElement | null;
			if (row?.dataset.siblingIndex !== undefined && row.dataset.parentKey === touchDragParentKey) {
				touchDragOver = parseInt(row.dataset.siblingIndex, 10);
			}
		}
		let dragging = true;
		function onEnd() {
			dragging = false;
			if (touchDragFrom !== null && touchDragOver !== null && touchDragFrom !== touchDragOver && touchDragParentKey !== null) {
				const parentId = touchDragParentKey === '__top__' ? null : touchDragParentKey;
				reorderSiblings(listId, parentId, touchDragFrom, touchDragOver);
			}
			touchDragFrom = null;
			touchDragOver = null;
			touchDragParentKey = null;
		}
		document.addEventListener('pointermove', onMove, { passive: false });
		document.addEventListener('pointerup', onEnd, { once: true });
		document.addEventListener('pointercancel', onEnd, { once: true });
		return () => {
			// Always remove listeners regardless of drag state — if the effect
			// re-runs while a drag is in flight the old listeners must be cleaned up.
			document.removeEventListener('pointermove', onMove);
			document.removeEventListener('pointerup', onEnd);
			document.removeEventListener('pointercancel', onEnd);
		};
	});

	// ── Type conversion ───────────────────────────────────────────────────────────
	function toggleType() {
		if (!listMeta) return;
		// Dismiss any open keypad before switching type
		pricingItemId = null; priceBuffer = '';
		qtyItemId = null; qtyBuffer = '';
		updateList(listId, { type: listMeta.type === 'plain' ? 'priced' : 'plain' });
	}

	const isPriced = $derived(listMeta?.type === 'priced');

	// ── Copy as TSV (for pasting into Google Sheets) ──────────────────────────────
	let showHeaderMenu = $state(false);
	let menuStyle = $state('');

	// ── Tree-order navigation ────────────────────────────────────────────────────
	const navIndex = $derived(orderedLists.findIndex((l) => l.id === listId));
	const navTotal = $derived(orderedLists.length);
	function navTo(delta: number) {
		if (navTotal < 2) return;
		const next = (navIndex + delta + navTotal) % navTotal;
		onOpenList(orderedLists[next].id);
	}
	let copyStatus = $state<'idle' | 'copied' | 'error'>('idle');
	let copyMessage = $state('');

	async function copyAsTSV() {
		const name = listMeta?.name ?? 'List';
		const modified = fmtDate(listMeta?.updatedAt);
		const created  = fmtDate(listMeta?.createdAt);

		const rows: string[] = [];

		// Sentinel start
		rows.push(`--- START: ${name} ---`);

		// Metadata row: name | Modified | date | Created | date
		rows.push(`${name}\tModified\t${modified}\tCreated\t${created}`);

		// Blank separator
		rows.push('');

		// Column header
		if (isPriced) {
			rows.push('Done\tPrice\tQty\tItem');
		} else {
			rows.push('Done\tItem');
		}

		// Data rows
		for (const { item, level } of treeItems) {
			const indent = '\t'.repeat(level);
			const itemName = indent + item.name;
			if (item.heading) {
				rows.push(isPriced ? `\t\t\t${itemName}` : `\t${itemName}`);
			} else if (item.note) {
				rows.push(isPriced ? `\t\t\t${itemName}` : `\t${itemName}`);
			} else if (isPriced) {
				const price = item.price !== null ? (item.price).toFixed(2) : '';
				const qty = item.qty !== null ? String(item.qty) : '1';
				const done = doneLabel(item);
				rows.push(`${done}\t${price}\t${qty}\t${itemName}`);
			} else {
				const done = doneLabel(item);
				rows.push(`${done}\t${itemName}`);
			}
		}

		// Blank rows (⌈items / 3⌉) for extra entries
		const blankCount = Math.ceil(treeItems.length / 3);
		for (let i = 0; i < blankCount; i++) rows.push(isPriced ? '\t\t\t' : '\t');

		// SUMPRODUCT(Price × Qty) row for priced lists — relative to current row so it
		// works regardless of where the user pastes in the sheet.
		// Price = col B, Qty = col C; data starts span rows above the Total row.
		if (isPriced) {
			const span = treeItems.length + blankCount;
			rows.push(`\t=SUMPRODUCT(INDIRECT("B"&(ROW()-${span})&":B"&(ROW()-1)),INDIRECT("C"&(ROW()-${span})&":C"&(ROW()-1)))\t\tTotal`);
		}

		// Sentinel end
		rows.push(`--- END: ${name} ---`);

		const tsv = rows.join('\n');
		try {
			await navigator.clipboard.writeText(tsv);
			copyMessage = '✓ Copied! Paste into Google Sheets.';
			copyStatus = 'copied';
			setTimeout(() => { copyStatus = 'idle'; }, 2000);
		} catch {
			copyMessage = '✗ Clipboard access denied.';
			copyStatus = 'error';
			setTimeout(() => { copyStatus = 'idle'; }, 3000);
		}
		showHeaderMenu = false;
	}

	// ── Copy as journal ───────────────────────────────────────────────────────────
	function fmtJournalDate(iso: string | null | undefined): string {
		if (!iso) return '';
		const d = new Date(iso);
		const day = d.getDate();
		const month = d.getMonth() + 1;
		const year = d.getFullYear();
		const hours = d.getHours();
		const minutes = d.getMinutes();
		const ampm = hours >= 12 ? 'PM' : 'AM';
		const h12 = hours % 12 || 12;
		const mm = String(minutes).padStart(2, '0');
		return `${day}/${month}/${year} ${h12}:${mm}${ampm}`;
	}

	async function copyAsJournal() {
		const lines: string[] = [];
		const journalItems = treeItems
			.map(({ item }) => item)
			.filter((item) => !item.heading)
			.sort((a, b) => {
				const tA = a.createdAt ? new Date(a.createdAt).getTime() : Infinity;
				const tB = b.createdAt ? new Date(b.createdAt).getTime() : Infinity;
				return (isNaN(tA) ? Infinity : tA) - (isNaN(tB) ? Infinity : tB);
			});

		for (const item of journalItems) {
			const dateStr = fmtJournalDate(item.createdAt);
			const prefix = dateStr ? `${dateStr} ` : '';
			lines.push(`  * ${prefix}${item.name}`);
		}
		const text = lines.join('\n');
		try {
			await navigator.clipboard.writeText(text);
			copyMessage = '✓ Copied as journal!';
			copyStatus = 'copied';
			setTimeout(() => { copyStatus = 'idle'; }, 2000);
		} catch {
			copyMessage = '✗ Clipboard access denied.';
			copyStatus = 'error';
			setTimeout(() => { copyStatus = 'idle'; }, 3000);
		}
		showHeaderMenu = false;
	}

	$effect(() => {
		if (!showHeaderMenu) return;
		function dismiss(e: PointerEvent) {
			const el = e.target as HTMLElement | null;
			if (!el?.closest('.header-menu-wrap') && !el?.closest('.header-menu')) showHeaderMenu = false;
		}
		document.addEventListener('pointerdown', dismiss, { capture: true });
		return () => document.removeEventListener('pointerdown', dismiss, { capture: true });
	});

	// If a peer deletes the item currently being priced or named, clear stale state
	$effect(() => {
		const ids = new Set(items.map((i) => i.id));
		untrack(() => {
			if (pricingItemId !== null && !ids.has(pricingItemId)) {
				pricingItemId = null;
				priceBuffer = '';
			}
			if (qtyItemId !== null && !ids.has(qtyItemId)) {
				qtyItemId = null;
				qtyBuffer = '';
			}
			if (editingId !== null && !ids.has(editingId)) {
				cancelEdit();
			}
			if (infoItem !== null && !ids.has(infoItem.id)) {
				infoItem = null;
			}
			// Also clear any selected IDs that no longer exist
			if (selectedIds.size > 0) {
				const next = new Set([...selectedIds].filter((id) => ids.has(id)));
				if (next.size !== selectedIds.size) selectedIds = next;
			}
		});
	});

	// Reset all transient editing/drag state when navigating to a different list
	$effect(() => {
		void listId; // track prop change
		untrack(() => {
			editingId = null;
			inputMode = 'add';
			universalValue = '';
			newItemParentId = null;
			newItemIsNote = listMeta?.defaultIsNote ?? false;
			pricingItemId = null;
			priceBuffer = '';
			qtyItemId = null;
			qtyBuffer = '';
			selectedIds = new Set();
			selectionMode = false;
			showSelectionPanel = false;
			touchDragFrom = null;
			touchDragOver = null;
			touchDragParentKey = null;
			confirmAction = null;
			infoItem = null;
			showHeaderMenu = false;
			// Reset scroll-shrink when switching lists — set scrollTop to 0;
			// the scroll listener will fire and restore max-height to fullHeight automatically.
			if (itemListEl) itemListEl.scrollTop = 0;
		});
	});

	// ── Scroll-shrink favourites bar ──────────────────────────────────────────────
	// The fav-bar lives inside .item-list as its first child so it scrolls away
	// naturally — no JS listener, no layout feedback loop.
	let itemListEl: HTMLElement | null = null;

	// ── Delete confirmation ───────────────────────────────────────────────────────
	let confirmMsg = $state('');
	let confirmLabel = $state('Delete');
	let confirmAction = $state<(() => void) | null>(null);
	function tName(name: string) {
		if (!name) return '';
		return name.length > 30 ? name.slice(0, 30) + '…' : name;
	}

	function askDelete(msg: string, action: () => void, label = 'Delete') {
		confirmMsg = msg;
		confirmLabel = label;
		confirmAction = () => action();
	}

	// ── Info dialog ───────────────────────────────────────────────────────────
	let infoItem = $state<Item | null>(null);
	let fullScreenNoteItem = $state<Item | null>(null);

	// ── Copy-link dialog ─────────────────────────────────────────────────────
	let copyLinksItem = $state<Item | null>(null);

	function copyItemLinks(links: string[]) {
		if (links.length === 1) {
			navigator.clipboard.writeText(links[0]).catch(() => {
				const ta = document.createElement('textarea');
				ta.value = links[0];
				ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
				document.body.appendChild(ta);
				ta.select();
				try { document.execCommand('copy'); } catch { /* ignore */ }
				document.body.removeChild(ta);
			});
		}
	}

	// ── Internal item/list/folder refs ────────────────────────────────────────────
	let allItemsById = $derived.by(() => {
		try {
			const map = new Map<string, Item>();
			for (const i of allItemsAll) map.set(i.id, i);
			return map;
		} catch { return new Map<string, Item>(); }
	});

	function resolveRefName(type: string, id: string): string {
		if (type === 'list-ref') return allLists.find(l => l.id === id)?.name ?? '…';
		if (type === 'folder-ref') return allFolders.find(f => f.id === id)?.name ?? '…';
		return allItemsById.get(id)?.name ?? '…';
	}

	function navigateToRef(type: string, id: string) {
		if (type === 'list-ref') { onOpenList(id); return; }
		if (type === 'folder-ref') { onNavigateTo?.(id); return; }
		const target = allItemsById.get(id);
		if (target) onOpenList(target.listId);
	}

	function copyRefToClipboard(id: string) {
		const text = `[[item:${id}]]`;
		navigator.clipboard.writeText(text).catch(() => {
			const ta = document.createElement('textarea');
			ta.value = text;
			ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
			document.body.appendChild(ta);
			ta.select();
			try { document.execCommand('copy'); } catch { /* ignore */ }
			document.body.removeChild(ta);
		});
	}

	function fmtDate(iso: string | null | undefined): string {
		if (!iso) return 'Unknown';
		return new Date(iso).toLocaleString(undefined, {
			day: 'numeric', month: 'short', year: 'numeric',
			hour: '2-digit', minute: '2-digit'
		});
	}

	// ── Scroll anchor: compensate when summary bar grows/shrinks ─────────────────
	// Svelte 5 $effect runs AFTER the DOM update, so both before/after would be
	// identical if we measured there. Instead:
	//   $effect.pre  — runs synchronously BEFORE the DOM update → capture anchor
	//   $effect      — runs AFTER the DOM update → apply correction in same frame
	let _anchorEl: HTMLElement | null = null;
	let _anchorTop = 0;

	$effect.pre(() => {
		// Track checkedCount so this re-runs on every check/uncheck.
		void checkedCount;
		if (!itemListEl) return;
		const row = itemListEl.querySelector('[data-sibling-index]') as HTMLElement | null;
		_anchorEl = row;
		_anchorTop = row ? row.getBoundingClientRect().top : 0;
	});

	$effect(() => {
		// Track checkedCount so this re-runs in sync with $effect.pre above.
		void checkedCount;
		if (!_anchorEl || !itemListEl) return;
		const delta = _anchorEl.getBoundingClientRect().top - _anchorTop;
		if (delta !== 0) itemListEl.scrollTop += delta;
	});
	let screenEl = $state<HTMLElement | null>(null);
</script>

<svelte:window onkeydown={handleGlobalKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="screen" bind:this={screenEl} class:has-keypad={(pricingItemId || qtyItemId) && isPriced} style="--list-color:{listMeta?.color ?? 'var(--text)'}">
	<!-- Header -->
	<header>
		<div class="header-row1">
		<button class="home-btn" onclick={onHome} aria-label="Home">🏠</button>
		<div class="breadcrumb">
			{#each breadcrumbItems as crumb, i}
				<span class="sep">/</span>
				{#if crumb.id === 'LIST'}
					<span class="crumb current">{crumb.name}</span>
				{:else}
					<button class="crumb" onclick={() => navigateToCrumb(crumb)}>{crumb.name}</button>
				{/if}
			{/each}
		</div>
		{#if savedSearch && onRestoreSearch}
			<button class="crumb search-crumb" onclick={onRestoreSearch} title="Back to search results">🔍 "{savedSearch}"</button>
		{/if}
		</div>
		<div class="header-row2">
		<button
			class="list-fav-btn"
			class:active={listMeta?.favourite}
			onclick={() => { 
				if (listMeta && !commitState.isHistorical) {
					const nextFav = !listMeta.favourite;
					updateList(listId, { favourite: nextFav, ...(nextFav && listMeta.favouriteOrder === undefined ? { favouriteOrder: getMaxFavouriteOrder() + 1 } : {}) });
				}
			}}
			aria-label={listMeta?.favourite ? 'Unfavourite list' : 'Favourite list'}
			title={listMeta?.favourite ? 'Unfavourite list' : 'Favourite list'}
			style={commitState.isHistorical ? 'cursor: default' : ''}
		>★</button>
		<button
			class="list-done-btn"
			onclick={() => { if (listMeta && !commitState.isHistorical) updateList(listId, { done: !listMeta.done }); }}
			aria-label={listMeta?.done ? 'Mark list incomplete' : 'Mark list complete'}
			title={listMeta?.done ? 'Mark list incomplete' : 'Mark list complete'}
			style={commitState.isHistorical ? 'cursor: default; opacity: 0.7' : ''}
		>{listMeta?.done ? '☑' : '☐'}</button>
		<div class="header-menu-wrap">
			<button class="type-btn" onclick={(e) => {
				showHeaderMenu = !showHeaderMenu;
				if (showHeaderMenu) {
					const rect = e.currentTarget.getBoundingClientRect();
					// The menu is ~13rem (208px) wide. Align to right if it would overflow.
					if (rect.left + 220 > window.innerWidth) {
						menuStyle = `top: ${rect.bottom + 4}px; right: ${window.innerWidth - rect.right}px; left: auto;`;
					} else {
						menuStyle = `top: ${rect.bottom + 4}px; left: ${rect.left}px; right: auto;`;
					}
				}
			}} aria-label="More options">⋮</button>
		</div>
		<div class="header-right">
			{#if navTotal > 1}
				<div class="nav-strip">
					<button class="nav-btn" onclick={() => navTo(-1)} aria-label="Previous list">‹</button>
					<span class="nav-count">{navIndex + 1} / {navTotal}</span>
					<button class="nav-btn" onclick={() => navTo(1)} aria-label="Next list">›</button>
				</div>
			{/if}
		</div>
		</div>
	</header>

	{#if copyStatus !== 'idle'}
		<div class="copy-toast" class:error={copyStatus === 'error'}>
			{copyMessage}
		</div>
	{/if}

	<!-- Universal input bar: always present so iOS keyboard opens at a fixed position -->
	{#if !commitState.isHistorical && ((!pricingItemId && !qtyItemId) || !isPriced)}
		<div class="universal-bar">
			<!-- form fires submit on iOS keyboard return/tick, more reliable than keydown -->
			<form
				class="universal-row"
				onsubmit={(e) => { e.preventDefault(); inputMode === 'edit' ? submitEditName() : addItem(); }}
			>
				<div class="input-wrap">
					<textarea
						bind:this={universalInputEl}
						class="universal-input"
						class:editing={inputMode === 'edit'}
						class:has-toggle={inputMode !== 'edit'}
						placeholder={inputMode === 'edit' ? 'Edit name…' : newItemParentId ? (newItemIsNote ? 'Add subnote…' : 'Add subtask…') : (newItemIsNote ? 'Add note…' : 'Add item…')}
						bind:value={universalValue}
						rows="1"
						enterkeyhint="done"
						oninput={() => { resizeUniversal(); updateTagSuggestions(); }}
						onkeydown={(e) => {
							if (e.key === 'Escape') { if (tagSuggestions.length) { tagSuggestions = []; e.preventDefault(); return; } cancelEdit(); }
							if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); inputMode === 'edit' ? submitEditName() : addItem(); tagSuggestions = []; }
						}}
						onblur={() => setTimeout(() => { tagSuggestions = []; }, 150)}
					></textarea>
					{#if inputMode === 'edit'}
						<button type="button" class="input-clear" onclick={cancelEdit} aria-label="Cancel edit">✕</button>
					{:else}
						<button type="button" class="type-toggle-btn" class:is-note={newItemIsNote} onpointerdown={(e) => { 
							e.preventDefault(); 
							newItemIsNote = !newItemIsNote; 
							if (newItemParentId === null) {
								if (listMeta) {
									updateList(listId, { defaultIsNote: newItemIsNote });
								}
							}
							focusInput(); 
						}} aria-label="Toggle note/todo">{newItemIsNote ? '📝' : '☑'}</button>
					{/if}
				</div>

			</form>
			{#if tagSuggestions.length > 0}
			<div class="tag-autocomplete">
				{#each tagSuggestions as tag}
					<button class="tag-ac-item" onpointerdown={(e) => { e.preventDefault(); applyTagSuggestion(tag); }}>#{tag}</button>
				{/each}
			</div>
		{/if}
		{#if newItemParentId}
				<div class="subtask-hint">
					{newItemIsNote ? '📝 Subnote' : '➕ Subtask'} → <em>{items.find((i) => i.id === newItemParentId)?.name ?? '…'}</em>
					<button type="button" onclick={() => { newItemParentId = null; newItemIsNote = listMeta?.defaultIsNote ?? false; universalValue = ''; }} aria-label="Cancel">✕</button>
				</div>
			{/if}
		</div>
	{/if}

	<!-- Summary bar / Selection bar -->
	{#if selectionMode}
		<div class="summary-bar selection-bar">
			<span class="sel-count">{selectedIds.size} selected</span>
			<button class="bulk-btn sel-view-btn" onclick={() => showSelectionPanel = !showSelectionPanel}>
				{showSelectionPanel ? '▾ Hide list' : '▸ View list'}
			</button>
			<button class="bulk-btn sel-done-btn" onclick={exitSelectionMode}>✕ Done</button>
		</div>
	{:else}
	<div class="summary-bar">
		{#if isPriced}
			<span>Total: <strong>{formatPrice(total)}</strong></span>
		{/if}
		<span class="check-counts">✓ {checkedCount} / ✗ {uncheckedCount}</span>
		{#if items.some((i) => hasAnyChecked(i))}
			{#if !commitState.isHistorical}
			<button class="bulk-btn icon-btn" onclick={bulkUncheck} title={selectedIds.size > 0 ? 'Uncheck selected' : 'Uncheck all'} aria-label={selectedIds.size > 0 ? 'Uncheck selected' : 'Uncheck all'}>☐</button>
			{/if}
		{/if}
		{#if delCheckedCount > 0}
			{#if !commitState.isHistorical}
			<button class="bulk-btn icon-btn danger" onclick={() => askDelete(
				selectedIds.size > 0
					? `Delete ${delCheckedCount} checked item(s)?`
					: `Delete all ${checkedCount} checked item(s)?`,
				bulkDeleteChecked
			)} title={selectedIds.size > 0 ? 'Delete selected checked' : 'Delete all checked'} aria-label={selectedIds.size > 0 ? 'Delete selected checked' : 'Delete all checked'}>🗑</button>
			{/if}
		{/if}
		{#if items.some((i) => isDone(i))}
			<button
				class="bulk-btn filter-btn"
				class:filter-active={filterView !== 'all'}
				onclick={cycleFilter}
				title="Filter: show all, unchecked only, or checked only"
			>{filterView === 'all' ? 'All' : filterView === 'unchecked' ? '✗ only' : '✓ only'}</button>
		{/if}
	</div>
	{/if}

	<!-- Selection panel (shown when selectionMode && showSelectionPanel) -->
	{#if selectionMode && showSelectionPanel}
		<div class="selection-panel">
			{#if selectedItems.length === 0}
				<p class="sel-empty">No items selected yet. Tap the ◇ next to each item to select it.</p>
			{:else}
				<ul class="sel-item-list">
					{#each selectedItems as item}
						<li class="sel-item-row">
							<button class="sel-item-deselect" onclick={() => toggleSelectionItem(item.id)} aria-label="Deselect">✕</button>
							<span class="sel-item-name">{item.name}</span>
						</li>
					{/each}
				</ul>
				<button class="sel-delete-btn" onclick={() => askDelete(
					`Delete ${selectedItems.length} selected item(s)?`,
					deleteSelected
				)}>🗑 Delete {selectedItems.length} item(s)</button>
			{/if}
		</div>
	{/if}

	<!-- Item list (pin-bar and fav-bar are first children — they scroll away naturally) -->
	<div class="item-list" bind:this={itemListEl}>
		{#if allPinnedItems.length > 0}
			<div class="pin-bar">
				<span class="pin-label">📍</span>
				{#each allPinnedItems as pItem}
					{@const inThisList = pItem.listId === listId}
					{@const pItemList = allLists.find((l) => l.id === pItem.listId)}
					{@const pItemFolder = allFolders.find((f) => f.id === pItemList?.folderId)}
					<span
						class="pin-chip"
						class:pin-chip-checked={!pItem.heading && !pItem.note && isItemDone(pItem, pItemFolder)}
						class:pin-chip-foreign={!inThisList}
					>
						{#if !commitState.isHistorical}
						<button
							class="pin-chip-unpin"
							onclick={() => askDelete(`Unpin "${tName(pItem.name)}"?`, () => updateItem(pItem.id, { pinned: false }), 'Unpin')}
							title="Unpin"
							aria-label="Unpin"
						>📍</button
						>{/if}<button
							class="pin-chip-label"
							onclick={() => {
								if (inThisList && !pItem.heading && !pItem.note) toggleDone(pItem);
								else onOpenList(pItem.listId);
							}}
							title={inThisList ? pItem.name : `${pItem.name} — ${pItemList?.name ?? '…'}`}
						>{pItem.name}{#if !inThisList}<span class="pin-chip-list"> ({pItemList?.name ?? '…'})</span>{/if}</button>
					</span>
				{/each}
			</div>
		{/if}
		{#if favouriteItems.length > 0}
			<div class="fav-bar" class:fav-bar-collapsed={settings.favouritesCollapsed}>
				<button
					class="fav-label"
					onclick={() => updateSettings({ favouritesCollapsed: !settings.favouritesCollapsed })}
					aria-label={settings.favouritesCollapsed ? 'Expand favourites' : 'Collapse favourites'}
					title={settings.favouritesCollapsed ? 'Expand favourites' : 'Collapse favourites'}
				>★</button>
				{#if onOpenFavouritesOrder}
					<button
						class="fav-reorder-btn"
						onclick={onOpenFavouritesOrder}
						aria-label="Rearrange favourites"
						title="Rearrange favourites"
					>⇅</button>
				{/if}
				{#each favouriteItems as fav (fav.type + ':' + fav.item.id)}
					{#if fav.type === 'folder'}
						<button
							class="fav-chip"
							style="--chip-color:{fav.item.color}"
							title={folderPath(fav.item)}
							onclick={() => { if (onNavigateTo) onNavigateTo(fav.item.id); }}
						>📁 {settings.favouritesCollapsed ? fav.item.name : folderPath(fav.item)}</button>
					{:else}
						<button
							class="fav-chip"
							class:fav-chip-active={fav.item.id === listId}
							style="--chip-color:{fav.item.color}"
							title={listPath(fav.item)}
							onclick={() => { if (fav.item.id !== listId) onOpenList(fav.item.id); }}
						>{settings.favouritesCollapsed ? fav.item.name : listPath(fav.item)}</button>
					{/if}
				{/each}
			</div>
		{/if}
		{#snippet checkControl(item: Item)}
			{#if commitState.isHistorical}
				{#if folderCheckboxes.length > 0}
					<div class="chip-row">
						{#each folderCheckboxes as cb}
							<button class="chip-btn" class:chip-checked={isChecked(item, cb.id)} title={cb.name} style="cursor: default; opacity: 0.7" aria-label={cb.name} disabled>{chipLabel(cb.name)}</button>
						{/each}
					</div>
				{:else}
					<button class="check-btn" style="cursor: default; opacity: 0.7" disabled>{item.checked ? '☑' : '☐'}</button>
				{/if}
			{:else if selectionMode}
				<button
					class="check-btn sel-check"
					class:sel-checked={selectedIds.has(item.id)}
					onclick={() => toggleSelectionItem(item.id)}
					aria-label={selectedIds.has(item.id) ? 'Deselect' : 'Select'}
				>{selectedIds.has(item.id) ? '◆' : '◇'}</button>
			{:else if folderCheckboxes.length > 0}
				<div class="chip-row">
					{#each folderCheckboxes as cb}
						<button
							class="chip-btn"
							class:chip-checked={isChecked(item, cb.id)}
							onclick={() => toggleItemCheckbox(item, cb.id)}
							title={cb.name}
							aria-label={`${cb.name}: ${isChecked(item, cb.id) ? 'Uncheck' : 'Check'}`}
						>{chipLabel(cb.name)}</button>
					{/each}
				</div>
			{:else}
				<button
					class="check-btn"
					onclick={() => toggleCheck(item)}
					aria-label={item.checked ? 'Uncheck' : 'Check'}
				>{item.checked ? '☑' : '☐'}</button>
			{/if}
		{/snippet}
		{#each filteredTreeItems as {item, level, tlIdx, rootTlIdx, sibIdx}}
			{@const canAddChildren = !item.heading && level < 2}
			{@const linkParts = parseNameParts(item.name)}
			{@const itemLinks = linkParts.filter(p => p.type === 'url').map(p => p.value)}
			{@const parentKey = item.parentId ?? '__top__'}
			<div
				id="item-{item.id}"
				class="item-row"
				class:journal-mode={journalMode}
				class:cursored={activeCursorId === item.id}
				class:heading={item.heading}
				class:note={item.note}
				class:priced-row={isPriced && !item.heading && !item.note}
				class:checked={isDone(item)}
				class:selected={selectedIds.has(item.id)}
				class:drag-source={touchDragParentKey === parentKey && sibIdx === touchDragFrom}
				class:drag-above={touchDragParentKey === parentKey && touchDragOver === sibIdx && touchDragFrom !== null && touchDragFrom > sibIdx}
				class:drag-below={touchDragParentKey === parentKey && touchDragOver === sibIdx && touchDragFrom !== null && touchDragFrom < sibIdx}
				data-sibling-index={sibIdx}
				data-parent-key={parentKey}
				data-item-id={item.id}
				style={level > 0 ? `padding-left:calc(0.75rem + ${level} * 1.5rem)` : undefined}
			>
				{#if item.heading}
					<!-- Heading: full-width bold label, no checkbox, no price -->
					<button
						class="item-name heading-name"
						class:editing={editingId === item.id}
						onclick={() => { if (!selectionMode) startEditName(item); }}
					>{#each linkParts as part}{#if part.type === 'url'}<a class="item-url" href={part.value} target="_blank" rel="noopener noreferrer" onpointerdown={(e) => e.stopPropagation()} onclick={(e) => e.stopPropagation()}>{part.value}</a>{:else if part.type === 'tag'}<span class="tag-pill" role="button" onpointerdown={(e) => e.stopPropagation()} onclick={(e) => { e.stopPropagation(); onTagClick?.(part.value.slice(1)); }}>{part.value}</span>{:else if part.type === 'item-ref' || part.type === 'list-ref' || part.type === 'folder-ref'}<span role="button" class="ref-pill" onpointerdown={(e) => e.stopPropagation()} onclick={(e) => { e.stopPropagation(); navigateToRef(part.type, part.value); }}>{resolveRefName(part.type, part.value)}</span>{:else}{part.value}{/if}{/each}</button>
					{#if !commitState.isHistorical}
					<button class="drag-handle" aria-label="Drag to reorder" onpointerdown={(e) => startItemDrag(e, sibIdx, parentKey)}>☰</button>
					<RowMenu items={[
						{ label: 'ℹ️ Info', action: () => infoItem = item },
						{ label: item.pinned ? '📍 Unpin' : '📍 Pin', action: () => updateItem(item.id, { pinned: !item.pinned }) },
						{ label: '📌 Unheading', action: () => updateItem(item.id, { heading: false }) },
						{ label: '🔗 Tag as Link', action: () => copyRefToClipboard(item.id) },
						...(itemLinks.length > 0 ? [{ label: itemLinks.length === 1 ? '🔗 Copy Link' : '🔗 Copy Links', action: () => itemLinks.length === 1 ? copyItemLinks(itemLinks) : (copyLinksItem = item) }] : []),
						...getReparentMenuItem(item.id),
						{ label: '🗑 Delete', danger: true, action: () => askDelete(`Delete "${tName(item.name)}"?`, () => deleteItemCascade(item.id)) }
					]} />
					{/if}
				{:else if item.note}
					<!-- Note: no checkbox, italic text -->
					<span class="note-icon">📝</span>
					<button
						class="item-name note-name"
						class:fullscreen-note={item.fullScreen}
						class:editing={editingId === item.id}
						onclick={() => {
							if (selectionMode) {
								toggleSelectionItem(item.id);
							} else if (item.fullScreen) {
								fullScreenNoteItem = item;
							} else {
								startEditName(item);
							}
						}}
						onpointerdown={(e) => { if (!selectionMode) onPointerDown(e, item.id); }}
						onpointermove={cancelLongPress}
						onpointerup={cancelLongPress}
						onpointercancel={cancelLongPress}
					><span class="item-name-text" class:fullscreen-clamp={item.fullScreen}>{#each linkParts as part}{#if part.type === 'url'}<a class="item-url" href={part.value} target="_blank" rel="noopener noreferrer" onpointerdown={(e) => { e.stopPropagation(); cancelLongPress(); }} onclick={(e) => e.stopPropagation()}>{part.value}</a>{:else if part.type === 'tag'}<span class="tag-pill" role="button" onpointerdown={(e) => { e.stopPropagation(); cancelLongPress(); }} onclick={(e) => { e.stopPropagation(); onTagClick?.(part.value.slice(1)); }}>{part.value}</span>{:else if part.type === 'item-ref' || part.type === 'list-ref' || part.type === 'folder-ref'}<span role="button" class="ref-pill" onpointerdown={(e) => { e.stopPropagation(); cancelLongPress(); }} onclick={(e) => { e.stopPropagation(); navigateToRef(part.type, part.value); }}>{resolveRefName(part.type, part.value)}</span>{:else}{part.value}{/if}{/each}</span></button>
					{#if !commitState.isHistorical}
					<button class="drag-handle" aria-label="Drag to reorder" onpointerdown={(e) => startItemDrag(e, sibIdx, parentKey)}>☰</button>
					<RowMenu items={[
						{ label: item.fullScreen ? '📉 Not FS' : '📝 Full Screen', action: () => {
							if (item.fullScreen) {
								updateItem(item.id, { fullScreen: false });
							} else {
								updateItem(item.id, { fullScreen: true });
								fullScreenNoteItem = item;
							}
						}},
						{ label: 'ℹ️ Info', action: () => infoItem = item },
						{ label: item.pinned ? '📍 Unpin' : '📍 Pin', action: () => updateItem(item.id, { pinned: !item.pinned }) },
						...(canAddChildren ? [
							{ label: '➕ Add Subtask', action: () => { newItemParentId = item.id; newItemIsNote = false; focusInput(); } },
							{ label: '📝 Add Subnote', action: () => { newItemParentId = item.id; newItemIsNote = true; focusInput(); } }
						] : []),
						{ label: '🔗 Tag as Link', action: () => copyRefToClipboard(item.id) },
						...(itemLinks.length > 0 ? [{ label: itemLinks.length === 1 ? '🔗 Copy Link' : '🔗 Copy Links', action: () => itemLinks.length === 1 ? copyItemLinks(itemLinks) : (copyLinksItem = item) }] : []),
						...getReparentMenuItem(item.id),
						{ label: '🗑 Delete', danger: true, action: () => askDelete(`Delete "${tName(item.name)}"?`, () => deleteItemCascade(item.id)) }
					]} />
					{/if}
				{:else if isPriced}
					<!-- Priced: name wraps top line, controls on bottom line -->
					<div class="priced-top">
						{@render checkControl(item)}
						<button
							class="item-name"
							class:strikethrough={isDone(item)}
							class:editing={editingId === item.id}
							class:fullscreen-note={item.fullScreen}
							onclick={() => selectionMode ? toggleSelectionItem(item.id) : startEditName(item)}
							onpointerdown={(e) => { if (!selectionMode) onPointerDown(e, item.id); }}
							onpointermove={cancelLongPress}
							onpointerup={cancelLongPress}
							onpointercancel={cancelLongPress}
						><span class="item-name-text" class:fullscreen-clamp={item.fullScreen}>{#each linkParts as part}{#if part.type === 'url'}<a class="item-url" href={part.value} target="_blank" rel="noopener noreferrer" onpointerdown={(e) => { e.stopPropagation(); cancelLongPress(); }} onclick={(e) => e.stopPropagation()}>{part.value}</a>{:else if part.type === 'tag'}<span class="tag-pill" role="button" onpointerdown={(e) => { e.stopPropagation(); cancelLongPress(); }} onclick={(e) => { e.stopPropagation(); onTagClick?.(part.value.slice(1)); }}>{part.value}</span>{:else if part.type === 'item-ref' || part.type === 'list-ref' || part.type === 'folder-ref'}<span role="button" class="ref-pill" onpointerdown={(e) => { e.stopPropagation(); cancelLongPress(); }} onclick={(e) => { e.stopPropagation(); navigateToRef(part.type, part.value); }}>{resolveRefName(part.type, part.value)}</span>{:else}{part.value}{/if}{/each}</span></button>
					</div>
					<div class="priced-bottom">
						<button
							class="price-btn"
							class:editing={pricingItemId === item.id}
							onclick={() => { if (!selectionMode) { pricingItemId === item.id ? commitPrice() : startEditPrice(item); } }}
						>{pricingItemId === item.id ? (priceBuffer || '0') : formatPrice(item.price)}</button>
						<button
							class="qty-btn"
							class:editing={qtyItemId === item.id}
							onclick={() => { if (!selectionMode) { qtyItemId === item.id ? commitQty() : startEditQty(item); } }}
							title="Quantity"
						>×{qtyItemId === item.id ? (qtyBuffer || '1') : (item.qty ?? 1)}</button>
						{#if !commitState.isHistorical}
						<button class="drag-handle" aria-label="Drag to reorder" onpointerdown={(e) => startItemDrag(e, sibIdx, parentKey)}>☰</button>
						<RowMenu items={[
							{ label: 'ℹ️ Info', action: () => infoItem = item },
							{ label: item.pinned ? '📍 Unpin' : '📍 Pin', action: () => updateItem(item.id, { pinned: !item.pinned }) },
							...(canAddChildren ? [
								{ label: '➕ Add Subtask', action: () => { newItemParentId = item.id; newItemIsNote = false; focusInput(); } },
								{ label: '📝 Add Subnote', action: () => { newItemParentId = item.id; newItemIsNote = true; focusInput(); } }
							] : []),
							...(level === 0 ? [{ label: '📌 Make Heading', action: () => makeHeading(item) }] : []),
							{ label: '🔗 Tag as Link', action: () => copyRefToClipboard(item.id) },
							...(itemLinks.length > 0 ? [{ label: itemLinks.length === 1 ? '🔗 Copy Link' : '🔗 Copy Links', action: () => itemLinks.length === 1 ? copyItemLinks(itemLinks) : (copyLinksItem = item) }] : []),
							...getReparentMenuItem(item.id),
							{ label: '🗑 Delete', danger: true, action: () => askDelete(`Delete "${tName(item.name)}"?`, () => deleteItemCascade(item.id)) }
						]} />
						{/if}
					</div>
				{:else}
					<!-- Plain: single row -->
					{@render checkControl(item)}
					<button
						class="item-name"
						class:strikethrough={isDone(item)}
						class:editing={editingId === item.id}
						class:fullscreen-note={item.fullScreen}
						onclick={() => selectionMode ? toggleSelectionItem(item.id) : startEditName(item)}
						onpointerdown={(e) => { if (!selectionMode) onPointerDown(e, item.id); }}
						onpointermove={cancelLongPress}
						onpointerup={cancelLongPress}
						onpointercancel={cancelLongPress}
					><span class="item-name-text" class:fullscreen-clamp={item.fullScreen}>{#each linkParts as part}{#if part.type === 'url'}<a class="item-url" href={part.value} target="_blank" rel="noopener noreferrer" onpointerdown={(e) => { e.stopPropagation(); cancelLongPress(); }} onclick={(e) => e.stopPropagation()}>{part.value}</a>{:else if part.type === 'tag'}<span class="tag-pill" role="button" onpointerdown={(e) => { e.stopPropagation(); cancelLongPress(); }} onclick={(e) => { e.stopPropagation(); onTagClick?.(part.value.slice(1)); }}>{part.value}</span>{:else if part.type === 'item-ref' || part.type === 'list-ref' || part.type === 'folder-ref'}<span role="button" class="ref-pill" onpointerdown={(e) => { e.stopPropagation(); cancelLongPress(); }} onclick={(e) => { e.stopPropagation(); navigateToRef(part.type, part.value); }}>{resolveRefName(part.type, part.value)}</span>{:else}{part.value}{/if}{/each}</span></button>
					{#if !commitState.isHistorical}
					<button class="drag-handle" aria-label="Drag to reorder" onpointerdown={(e) => startItemDrag(e, sibIdx, parentKey)}>☰</button>
					<RowMenu items={[
						{ label: 'ℹ️ Info', action: () => infoItem = item },
						{ label: item.pinned ? '📍 Unpin' : '📍 Pin', action: () => updateItem(item.id, { pinned: !item.pinned }) },
						...(canAddChildren ? [
							{ label: '➕ Add Subtask', action: () => { newItemParentId = item.id; newItemIsNote = false; focusInput(); } },
							{ label: '📝 Add Subnote', action: () => { newItemParentId = item.id; newItemIsNote = true; focusInput(); } }
						] : []),
						...(level === 0 ? [{ label: '📌 Make Heading', action: () => makeHeading(item) }] : []),
						{ label: '🔗 Tag as Link', action: () => copyRefToClipboard(item.id) },
						...(itemLinks.length > 0 ? [{ label: itemLinks.length === 1 ? '🔗 Copy Link' : '🔗 Copy Links', action: () => itemLinks.length === 1 ? copyItemLinks(itemLinks) : (copyLinksItem = item) }] : []),
						...getReparentMenuItem(item.id),
						{ label: '🗑 Delete', danger: true, action: () => askDelete(`Delete "${tName(item.name)}"?`, () => deleteItemCascade(item.id)) }
					]} />
					{/if}
				{/if}
				{#if journalMode && item.createdAt && !item.heading}
					<div class="journal-date">{formatJournalDate(item.createdAt)}</div>
				{/if}
			</div>
		{/each}
	</div>

	<!-- Floating + / ✕ button: add item when idle; cancel when typing -->
	<!-- Position depends on handedness: left-handed = right side, right-handed = left side -->
	{#if !commitState.isHistorical && ((!pricingItemId && !qtyItemId) || !isPriced)}
		{#if universalValue.trim()}
			<!-- Cancel: discard typed text / revert edit -->
			<button
				class="fab fab-cancel"
				class:fab-right={settings.handedness !== 'right'}
				class:fab-left={settings.handedness === 'right'}
				aria-label="Cancel"
				onpointerdown={(e) => {
					e.preventDefault();
					cancelEdit();
				}}
			>✕</button>
		{:else}
			<!-- Start adding -->
			<button
				class="fab"
				class:fab-right={settings.handedness !== 'right'}
				class:fab-left={settings.handedness === 'right'}
				aria-label="Add item"
				onpointerdown={(e) => { e.preventDefault(); newItemParentId = null; newItemIsNote = listMeta?.defaultIsNote ?? false; cancelEdit(); focusInput(); }}
			>＋</button>
		{/if}
	{/if}

	<!-- Floating green confirm button: opposite side to +/✕ button -->
	{#if !commitState.isHistorical && universalValue.trim()}
		<button
			class="fab fab-confirm"
			class:fab-left={settings.handedness !== 'right'}
			class:fab-right={settings.handedness === 'right'}
			aria-label="Confirm"
			onpointerdown={(e) => {
				e.preventDefault();
				inputMode === 'edit' ? submitEditName() : addItem();
			}}
		>✓</button>
	{/if}

	<!-- Numeric keypad -->
	{#if isPriced && (pricingItemId || qtyItemId)}
		<div class="keypad-area">
			<div class="keypad-header">
				{#if qtyItemId}
					<span>Entering quantity: <strong>{qtyBuffer || '1'}</strong></span>
					<button onclick={commitQty}>Done</button>
				{:else}
					<span>Entering price: <strong>{priceBuffer || '0'}</strong></span>
					<button onclick={commitPrice}>Done</button>
				{/if}
			</div>
			<NumericKeypad onKey={handleKeypadInput} />
		</div>
	{/if}

	<!-- Delete confirmation dialog -->
	{#if confirmAction}
		<ConfirmDialog
			message={confirmMsg}
			confirmLabel={confirmLabel}
			onConfirm={() => { confirmAction?.(); confirmAction = null; }}
			onCancel={() => (confirmAction = null)}
		/>
	{/if}

	<!-- Info dialog -->
	{#if fullScreenNoteItem}
		<FullScreenEditor
			itemId={fullScreenNoteItem.id}
			initialContent={fullScreenNoteItem.name}
			onSave={(newContent) => {
				if (fullScreenNoteItem) {
					updateItem(fullScreenNoteItem.id, { name: newContent });
				}
			}}
			onClose={() => fullScreenNoteItem = null}
		/>
	{/if}

	{#if infoItem}
		{@const it = infoItem}
		<InfoDialog
			title={it.name}
			rows={[
				{ label: 'Type', value: it.heading ? 'Heading' : it.note ? 'Note' : 'Task' },
				{ label: 'Created', value: fmtDate(it.createdAt) },
				{ label: 'Modified', value: fmtDate(it.updatedAt) }
			]}
			onClose={() => infoItem = null}
		/>
	{/if}

	<!-- Copy-link dialog -->
	{#if copyLinksItem}
		{@const cl = copyLinksItem}
		<CopyLinkDialog
			links={parseNameParts(cl.name).filter(p => p.type === 'url').map(p => p.value)}
			onClose={() => copyLinksItem = null}
		/>
	{/if}

	{#if showHeaderMenu}
		<!-- Render header menu absolute to the screen so it's not clipped by header overflow -->
		<div class="header-menu" role="menu" style={menuStyle}>
			{#if !commitState.isHistorical}
			{#if selectionMode && selectedIds.size > 0}
			<button role="menuitem" onclick={() => { showHeaderMenu = false; reparentSelectedToRoot(); }}>↳ Move selected to root</button>
			{:else}
			<button role="menuitem" onclick={enterSelectionMode}>☑ Select items</button>
			{/if}
			{/if}
			<button role="menuitem" onclick={() => { showHeaderMenu = false; exportToClipboard(); }}>📤 Export to clipboard (JSON)</button>
			{#if !commitState.isHistorical}
			<button role="menuitem" onclick={() => { showHeaderMenu = false; importFromClipboard(); }}>📥 Import from clipboard</button>
			{/if}
			<button role="menuitem" onclick={() => { showHeaderMenu = false; copyAsTSV(); }}>📋 Copy as spreadsheet</button>
			<button role="menuitem" onclick={() => { showHeaderMenu = false; copyAsJournal(); }}>📓 Copy as journal</button>
			<button role="menuitem" onclick={() => { showHeaderMenu = false; toggleJournalMode(); }}>{journalMode ? '🗓 Hide dates (journal mode)' : '🗓 Show dates (journal mode)'}</button>
			{#if !commitState.isHistorical}
			<button role="menuitem" onclick={() => { showHeaderMenu = false; toggleType(); }}>{isPriced ? '📋 Switch to plain list' : '💰 Switch to priced list'}</button>
			{/if}
			<button role="menuitem" onclick={() => { showHeaderMenu = false; showUndoConfirm = true; }}>↩️ Undo last action</button>
		</div>
	{/if}
</div>

{#if showUndoConfirm}
	{#if canUndo()}
		<ConfirmDialog
			message={`Are you sure you want to undo your last action? (${getUndoCount()} action${getUndoCount() === 1 ? '' : 's'} left)`}
			confirmLabel="Yes, undo"
			onConfirm={() => {
				getUndoManager().undo();
				showUndoConfirm = false;
			}}
			onCancel={() => {
				showUndoConfirm = false;
			}}
		/>
	{:else}
		<ConfirmDialog
			message="There is nothing to undo."
			confirmLabel="OK"
			hideCancel={true}
			isDanger={false}
			onConfirm={() => {
				showUndoConfirm = false;
			}}
			onCancel={() => {
				showUndoConfirm = false;
			}}
		/>
	{/if}
{/if}

<style>
	.screen {
		display: flex;
		flex-direction: column;
		/* position:fixed is anchored to the visual viewport on iOS Safari,
		   so the screen automatically shrinks when the SIP keyboard opens.
		   No JS needed — the add-bar stays visible above the keyboard. */
		position: fixed;
		inset: 0;
		background: var(--bg);
	}
	header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 1rem;
		background: var(--bg2);
		border-bottom: 1px solid var(--border);
		flex-shrink: 0;
		overflow-x: auto;
		scrollbar-width: none;
		flex-wrap: nowrap;
	}
	header::-webkit-scrollbar { display: none; }
	.header-row1, .header-row2 { display: contents; }
	.breadcrumb {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		flex-wrap: nowrap;
		flex-shrink: 0;
		font-size: 1rem;
		min-width: 0;
		overflow-x: auto;
		scrollbar-width: none;
	}
	.breadcrumb::-webkit-scrollbar { display: none; }
	.crumb {
		background: none;
		border: none;
		color: var(--accent);
		cursor: pointer;
		padding: 0;
		font-size: inherit;
		white-space: nowrap;
		flex-shrink: 0;
	}
	.crumb.current {
		color: var(--text);
		font-weight: 600;
		cursor: default;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 160px;
		display: inline-block;
		vertical-align: bottom;
	}
	.sep { color: var(--text2); flex-shrink: 0; }
	/* ── Pinned items bar ───────────────────────────────────────────────────── */
	/* Lives inside .item-list before fav-bar — scrolls away naturally */
	.pin-bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
		padding: 0.4rem 0.75rem;
		background: var(--bg2);
		border-bottom: 1px solid var(--border);
	}
	.pin-label { font-size: 1rem; flex-shrink: 0; }
	.pin-chip {
		display: inline-flex;
		align-items: center;
		border: 1px solid var(--accent);
		border-radius: 999px;
		overflow: hidden;
		max-width: 220px;
		white-space: nowrap;
	}
	.pin-chip-unpin {
		background: none;
		border: none;
		border-right: 1px solid var(--accent);
		border-radius: 0;
		padding: 0.2rem 0.4rem;
		font-size: 0.75rem;
		cursor: pointer;
		line-height: 1;
		opacity: 0.6;
		flex-shrink: 0;
	}
	.pin-chip-unpin:hover { opacity: 1; background: color-mix(in srgb, var(--accent) 15%, transparent); }
	.pin-chip-label {
		background: none;
		border: none;
		padding: 0.2rem 0.55rem 0.2rem 0.4rem;
		font-size: 0.82rem;
		color: var(--accent);
		cursor: pointer;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.pin-chip.pin-chip-checked .pin-chip-label {
		text-decoration: line-through;
		opacity: 0.6;
	}
	.pin-chip.pin-chip-checked .pin-chip-unpin { opacity: 0.4; }
	.pin-chip.pin-chip-foreign {
		border-style: dashed;
		opacity: 0.85;
	}
	.pin-chip-list {
		font-size: 0.75em;
		opacity: 0.75;
	}
	/* ── Favourites bar ─────────────────────────────────────────────────────── */
	/* Lives inside .item-list — scrolls away naturally, no JS needed */
	.fav-bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
		padding: 0.4rem 0.75rem;
		background: var(--bg2);
		border-bottom: 1px solid var(--border);
	}
	.fav-label {
		background: none;
		border: none;
		color: #f59e0b;
		font-size: 1rem;
		flex-shrink: 0;
		cursor: pointer;
		padding: 0.1rem 0.2rem;
		line-height: 1;
	}
	.fav-label:hover { opacity: 0.75; }
	.fav-reorder-btn {
		background: none;
		border: none;
		color: var(--text2);
		font-size: 0.95rem;
		flex-shrink: 0;
		cursor: pointer;
		padding: 0.1rem 0.2rem;
		line-height: 1;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		transition: color 0.15s ease;
	}
	.fav-reorder-btn:hover {
		color: var(--accent);
		opacity: 0.9;
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
		transition: max-width 0.15s ease;
	}
	.fav-chip.fav-chip-active {
		background: var(--chip-color, var(--accent));
		color: #fff;
	}
	.fav-bar-collapsed .fav-chip {
		max-width: 90px;
		padding: 0.15rem 0.5rem;
		font-size: 0.78rem;
	}
	.list-title {
		flex: 1;
		font-weight: 600;
		font-size: 1rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.home-btn {
		background: none;
		border: none;
		font-size: 1.25rem;
		cursor: pointer;
		padding: 0;
		line-height: 1;
		flex-shrink: 0;
	}
	.search-crumb {
		color: var(--accent);
		opacity: 0.75;
		font-size: 0.88rem;
		white-space: nowrap;
		max-width: 140px;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.type-btn {
		background: none;
		border: none;
		font-size: 1.2rem;
		cursor: pointer;
		padding: 0.2rem;
	}

	.list-fav-btn {
		background: none;
		border: none;
		font-size: 1.2rem;
		cursor: pointer;
		padding: 0.2rem;
		flex-shrink: 0;
		color: var(--text2);
	}
	.list-fav-btn.active {
		color: #facc15;
	}

	.list-done-btn {
		background: none;
		border: none;
		font-size: 1.2rem;
		cursor: pointer;
		padding: 0.2rem;
		flex-shrink: 0;
		color: var(--list-color, var(--text));
	}
	.header-menu-wrap {
		position: relative;
		margin-left: 0.4rem;
		flex-shrink: 0;
	}
	.header-right {
		margin-left: auto;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		gap: 0.3rem;
	}
	.nav-strip {
		display: flex;
		align-items: center;
		gap: 0.1rem;
	}
	.nav-btn {
		background: none;
		border: none;
		font-size: 1.3rem;
		line-height: 1;
		padding: 0.1rem 0.3rem;
		cursor: pointer;
		color: var(--text2);
	}
	.nav-btn:hover { color: var(--text); }
	.nav-count {
		font-size: 0.75rem;
		color: var(--text2);
		white-space: nowrap;
		min-width: 2.8rem;
		text-align: center;
	}
	.header-menu {
		position: absolute;
		top: calc(100% + 4px);
		left: 0;
		background: var(--bg2);
		border: 1px solid var(--border);
		border-radius: 8px;
		box-shadow: 0 4px 16px rgba(0,0,0,0.18);
		z-index: 200;
		min-width: 13rem;
		overflow: hidden;
	}
	.header-menu button {
		display: block;
		width: 100%;
		padding: 0.65rem 1rem;
		background: none;
		border: none;
		text-align: left;
		font-size: 0.9rem;
		color: var(--text);
		cursor: pointer;
	}
	.header-menu button:hover { background: var(--bg3); }

	.copy-toast {
		position: fixed;
		bottom: 5rem;
		left: 50%;
		transform: translateX(-50%);
		background: #22c55e;
		color: #fff;
		padding: 0.5rem 1.2rem;
		border-radius: 999px;
		font-size: 0.85rem;
		font-weight: 600;
		pointer-events: none;
		z-index: 300;
		white-space: nowrap;
	}
	.copy-toast.error { background: #ef4444; }
	.summary-bar {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.35rem 0.75rem;
		background: var(--bg3);
		font-size: 0.85rem;
		flex-shrink: 0;
		overflow: hidden;
	}
	.check-counts { color: var(--text2); white-space: nowrap; }
	.bulk-btn {
		padding: 0.25rem 0.6rem;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--bg2);
		color: var(--text);
		font-size: 0.8rem;
		cursor: pointer;
		white-space: nowrap;
		flex-shrink: 0;
	}
	.bulk-btn.icon-btn {
		padding: 0.2rem 0.5rem;
		font-size: 1rem;
		line-height: 1;
	}
	.bulk-btn.danger { color: #ef4444; border-color: #ef4444; }
	.bulk-btn.filter-btn { margin-left: auto; }
	.bulk-btn.filter-active { color: var(--accent); border-color: var(--accent); }
	.item-list {
		flex: 1;
		overflow-x: hidden;
		overflow-y: auto;
		-webkit-overflow-scrolling: touch;
		/* Leave room for the FAB at the bottom */
		padding-bottom: 5rem;
	}
	.item-row {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: var(--item-spacing, 8px) 0.75rem;
		border-bottom: 1px solid var(--border);
		transition: background 0.15s, opacity 0.15s;
		line-height: var(--row-line-height, normal);
	}
	.item-row.journal-mode {
		flex-wrap: wrap;
	}
	.journal-date {
		width: 100%;
		font-size: 0.75rem;
		color: var(--text-muted, #888);
		padding-left: 2.2rem;
		margin-top: -0.3rem;
		opacity: 0.7;
	}
	/* Priced rows: two-line layout on touch devices only */
	@media (pointer: coarse) {
		.item-row.priced-row {
			flex-direction: column;
			align-items: stretch;
			gap: 0;
			padding: var(--item-spacing, 0.4rem) 0.75rem;
		}
		.priced-top {
			display: flex;
			align-items: center;
			gap: 0.4rem;
		}
		.priced-bottom {
			display: flex;
			align-items: center;
			gap: 0.4rem;
			padding-left: 0.25rem;
			justify-content: flex-end;
		}
	}
	/* On pointer:fine (desktop), priced rows fall back to the standard single-row flex */
	@media (pointer: fine) {
		.priced-top { display: contents; }
		.priced-bottom { display: contents; }
	}
	.item-row.selected { background: var(--bg3); }
	.item-row.cursored {
		background-color: var(--bg2);
		outline: 2px solid var(--accent);
		outline-offset: -2px;
		border-radius: 4px;
	}
	.item-row.drag-source { opacity: 0.4; }
	.item-row.drag-above { background: var(--bg3); box-shadow: inset 0 2px 0 var(--accent); }
	.item-row.drag-below { background: var(--bg3); box-shadow: inset 0 -2px 0 var(--accent); }
	/* Selection-mode check button */
	.check-btn.sel-check { color: var(--text2); }
	.check-btn.sel-checked { color: var(--list-color, var(--accent)); }
	/* Selected item row highlight */
	.item-row:has(.sel-checked) { background: color-mix(in srgb, var(--list-color, var(--accent)) 12%, var(--bg)); }
	/* Selection bar */
	.summary-bar.selection-bar {
		background: color-mix(in srgb, var(--list-color, var(--accent)) 15%, var(--bg2));
		border-bottom: 2px solid var(--list-color, var(--accent));
	}
	.sel-count { font-weight: 600; flex: 1; }
	.sel-view-btn {
		background: var(--bg3);
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 0.2rem 0.6rem;
		font-size: 0.85rem;
		cursor: pointer;
	}
	.sel-done-btn {
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 0.2rem 0.6rem;
		font-size: 0.85rem;
		cursor: pointer;
		color: var(--text);
	}
	/* Selection panel */
	.selection-panel {
		background: var(--bg2);
		border-bottom: 1px solid var(--border);
		padding: 0.5rem 0.75rem;
		flex-shrink: 0;
		max-height: 40vh;
		overflow-y: auto;
	}
	.sel-empty { color: var(--text2); font-size: 0.88rem; margin: 0; padding: 0.25rem 0; }
	.sel-item-list { list-style: none; margin: 0; padding: 0; }
	.sel-item-row {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.3rem 0;
		border-bottom: 1px solid var(--border);
		font-size: 0.9rem;
	}
	.sel-item-row:last-child { border-bottom: none; }
	.sel-item-deselect {
		background: none;
		border: none;
		cursor: pointer;
		color: var(--text2);
		font-size: 0.8rem;
		flex-shrink: 0;
		padding: 0.1rem 0.3rem;
	}
	.sel-item-name { flex: 1; word-break: break-word; }
	.sel-delete-btn {
		display: block;
		margin-top: 0.5rem;
		width: 100%;
		padding: 0.45rem;
		background: #dc262620;
		border: 1px solid #dc2626;
		border-radius: 6px;
		color: #dc2626;
		font-size: 0.9rem;
		font-weight: 600;
		cursor: pointer;
	}
	.sel-delete-btn:hover { background: #dc262630; }
	.item-row.heading {
		background: var(--bg2);
		border-top: 1px solid var(--border);
		padding: var(--item-spacing, 4px) 0.75rem;
	}
	.heading-name {
		font-weight: 700;
		font-size: 1rem;
		letter-spacing: 0.02em;
		color: var(--text);
		text-transform: uppercase;
	}
	.check-btn {
		background: none;
		border: none;
		font-size: var(--row-icon-size, 1.82rem);
		cursor: pointer;
		padding: 0;
		flex-shrink: 0;
		min-width: 50px;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--list-color, var(--text));
	}
	@media (pointer: fine) {
		/* Mouse/trackpad users: revert to original size */
		.check-btn { font-size: var(--row-icon-size, 1.4rem); min-width: 44px; }
	}
	.chip-row {
		display: flex;
		flex-wrap: wrap;
		gap: 3px;
		flex-shrink: 0;
		max-width: 40%;
	}
	.chip-btn {
		background: none;
		border: 1.5px solid var(--border);
		border-radius: 6px;
		font-size: 0.7rem;
		font-weight: 600;
		line-height: 1;
		cursor: pointer;
		padding: 4px 5px;
		color: var(--text2);
		min-width: 22px;
	}
	.chip-btn.chip-checked {
		background: #ef4444;
		border-color: #ef4444;
		color: #fff;
	}
	.item-name {
		flex: 1;
		background: none;
		border: none;
		text-align: left;
		font-size: 0.95rem;
		color: var(--text);
		cursor: pointer;
		padding: 0;
		min-width: 0;
		/* Allow wrapping in priced rows; plain rows also benefit from wrap */
		white-space: pre-wrap;
		word-break: break-word;
		overflow-wrap: break-word;
	}
	.item-name.strikethrough { text-decoration: line-through; color: var(--text2); }
	.item-name.editing { color: var(--accent); font-style: italic; }
	.item-name-text {
		display: block;
		width: 100%;
		min-width: 0;
	}
	.item-name-text.fullscreen-clamp {
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		text-overflow: ellipsis;
		word-break: break-word;
		overflow-wrap: break-word;
	}
	.item-url {
		color: var(--accent);
		text-decoration: underline;
		word-break: break-all;
	}
	.tag-pill {
		display: inline-block;
		background: color-mix(in srgb, var(--list-color, var(--accent)) 18%, transparent);
		color: var(--list-color, var(--accent));
		border-radius: 999px;
		padding: 0 0.45em;
		font-size: 0.82em;
		font-weight: 600;
		white-space: nowrap;
		letter-spacing: 0.01em;
		cursor: pointer;
	}
	.ref-pill {
		display: inline-block;
		background: color-mix(in srgb, var(--list-color, var(--accent)) 10%, transparent);
		color: var(--list-color, var(--accent));
		border: 1px solid color-mix(in srgb, var(--list-color, var(--accent)) 40%, transparent);
		border-radius: 4px;
		padding: 0 0.45em;
		font-size: 0.82em;
		font-weight: 500;
		white-space: normal;
		overflow-wrap: break-word;
		cursor: pointer;
		font-family: inherit;
		line-height: 1.4;
		vertical-align: middle;
	}
	.ref-pill::before { content: '→\00a0'; opacity: 0.7; }
	/* ── Tag autocomplete dropdown ──────────────────────────────────────────── */
	.tag-autocomplete {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		padding: 0.3rem 0.75rem;
		background: var(--bg2);
		border-bottom: 1px solid var(--border);
	}
	.tag-ac-item {
		background: color-mix(in srgb, var(--list-color, var(--accent)) 15%, transparent);
		color: var(--list-color, var(--accent));
		border: 1px solid var(--list-color, var(--accent));
		border-radius: 999px;
		padding: 0.15rem 0.65rem;
		font-size: 0.82rem;
		font-weight: 600;
		cursor: pointer;
		white-space: nowrap;
	}
	.tag-ac-item:hover { background: color-mix(in srgb, var(--list-color, var(--accent)) 28%, transparent); }
	/* ── Subnotes ────────────────────────────────────────────────────────── */
	.note-icon {
		font-size: var(--row-icon-size, 1.1rem);
		flex-shrink: 0;
		min-width: 50px;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.note-name {
		font-size: 1rem;
	}
	/* ── Subtask hint bar ────────────────────────────────────────────────── */
	.subtask-hint {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.2rem 0.4rem 0;
		font-size: 0.8rem;
		color: var(--text2);
	}
	.subtask-hint em { color: var(--text); font-style: normal; font-weight: 600; }
	.subtask-hint button {
		background: none;
		border: none;
		cursor: pointer;
		color: var(--text2);
		padding: 0 0.2rem;
		font-size: 0.9rem;
		line-height: 1;
		margin-left: auto;
	}
	.price-btn {
		min-width: 72px;
		padding: 0.25rem 0.4rem;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--bg2);
		color: var(--text);
		font-size: 0.9rem;
		cursor: pointer;
		text-align: right;
		flex-shrink: 0;
	}
	.price-btn.editing {
		border-color: var(--accent);
		background: var(--bg);
		font-weight: 700;
	}
	.qty-btn {
		min-width: 42px;
		padding: 0.25rem 0.4rem;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--bg2);
		color: var(--text2);
		font-size: 0.85rem;
		cursor: pointer;
		text-align: center;
		flex-shrink: 0;
	}
	.qty-btn.editing {
		border-color: var(--accent);
		background: var(--bg);
		color: var(--text);
		font-weight: 700;
	}
	.del-btn {
		background: none;
		border: none;
		font-size: 1.1rem;
		color: var(--text2);
		cursor: pointer;
		flex-shrink: 0;
		min-width: 40px;
		min-height: 44px;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.drag-handle {
		background: none;
		border: none;
		padding: 0;
		cursor: grab;
		color: var(--text2);
		font-size: 1.1rem;
		user-select: none;
		flex-shrink: 0;
		min-width: 44px;
		display: flex;
		align-items: center;
		justify-content: center;
		touch-action: none;
		-webkit-user-select: none;
	}
	.drag-handle:active { color: var(--accent); }
	/* ── Universal input bar ──────────────────────────────────────── */
	.universal-bar {
		padding: 0.5rem 0.75rem 0.4rem;
		border-bottom: 1px solid var(--border);
		background: var(--bg2);
		flex-shrink: 0;
	}
	.universal-row {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.input-wrap {
		position: relative;
		flex: 1;
		min-width: 0;
	}
	.universal-input {
		width: 100%;
		padding: 0.6rem 2.2rem 0.6rem 0.8rem; /* right pad leaves room for ✕ */
		border: 1px solid var(--border);
		border-radius: 10px;
		font-size: 1rem;
		background: var(--bg);
		color: var(--text);
		outline: none;
		box-sizing: border-box;
		resize: none;
		overflow: hidden;
		min-height: 2.5rem;
		line-height: 1.4;
		font-family: inherit;
	}
	.universal-input:focus { border-color: var(--accent); }
	.universal-input.editing { border-color: var(--accent); }
	.universal-input.has-toggle { padding-right: 2.8rem; }
	.type-toggle-btn {
		position: absolute;
		right: 0.3rem;
		top: 0.35rem;
		background: var(--bg2);
		border: 1px solid var(--border);
		border-radius: 6px;
		color: var(--text2);
		font-size: 1.1rem;
		cursor: pointer;
		padding: 0.2rem 0.4rem;
		line-height: 1.2;
		white-space: nowrap;
	}
	.type-toggle-btn.is-note {
		color: var(--accent);
		border-color: var(--accent);
		background: transparent;
	}
	.input-clear {
		position: absolute;
		right: 0.4rem;
		top: 0.4rem;
		background: none;
		border: none;
		color: var(--text2);
		font-size: 1rem;
		cursor: pointer;
		padding: 0.2rem 0.3rem;
		line-height: 1;
	}
	/* ── Floating action buttons ────────────────────────────────────── */
	.fab {
		position: absolute;
		bottom: 1.25rem;
		width: 56px;
		height: 56px;
		border-radius: 50%;
		color: #fff;
		font-size: 2rem;
		line-height: 1;
		border: none;
		cursor: pointer;
		box-shadow: 0 4px 12px rgba(0,0,0,0.25);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 10;
	}
	.fab-right { right: 1.25rem; background: var(--accent); }
	.fab-left  { left: 1.25rem; background: var(--accent); }
	.fab-confirm { background: #22c55e; font-size: 1.8rem; }
	.fab-cancel  { background: #ef4444; font-size: 1.8rem; }
	.keypad-area {
		flex-shrink: 0;
		border-top: 2px solid var(--accent);
		background: var(--bg2);
	}
	.keypad-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.5rem 1rem;
		font-size: 0.9rem;
	}
	.keypad-header button {
		padding: 0.35rem 0.9rem;
		background: var(--accent);
		color: #fff;
		border: none;
		border-radius: 8px;
		font-size: 0.9rem;
		cursor: pointer;
	}
	@keyframes highlightFade {
		0% { background-color: var(--accent); }
		100% { background-color: transparent; }
	}
	:global(.highlight-animation) {
		animation: highlightFade 2s ease-out;
	}

	@media (max-width: 600px) {
		.item-row { padding-left: 0.25rem; padding-right: 0.25rem; gap: 0.1rem; }
		.drag-handle { min-width: 24px; }
		.check-btn { min-width: 32px; }
		.note-icon { min-width: 32px; }
	}
</style>
