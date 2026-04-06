<script lang="ts">
	import { docState } from '$lib/yjsStore.svelte';
	import { onDestroy, tick } from 'svelte';
	import {
		readItems,
		readLists,
		readFolders,
		createItem,
		createItemsBatch,
		updateItem,
		deleteItemCascade,
		deleteItemsBatch,
		setItemsChecked,
		updateList,
		reorderSiblings,
		isListEffectivelyArchived,
		type Item,
		type ListMeta
	} from '$lib/data';
	import { settings } from '$lib/settings.svelte';
	import NumericKeypad from './NumericKeypad.svelte';
	import ConfirmDialog from './ConfirmDialog.svelte';
	import RowMenu from './RowMenu.svelte';
	import InfoDialog from './InfoDialog.svelte';

	let { listId, onHome, onOpenList, onNavigateTo }: {
		listId: string;
		onHome: () => void;
		onOpenList: (id: string) => void;
		onNavigateTo: (folderId: string | null) => void;
	} = $props();

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
	let favouriteLists = $derived(allLists.filter((l) => l.favourite && !isListEffectivelyArchived(l, allFolders)));

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
			onNavigateTo(crumb.id!);
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

	// Sum in integer cents to avoid float accumulation (e.g. 0.1+0.2 = 0.300...04)
	// Only sum top-level items (parentId === null) — subtask prices are breakdowns,
	// not additive, to avoid double-counting.
	const total = $derived(
		Math.round(items
			.filter((i) => !i.heading && !i.note)
			.reduce((s, i) => s + Math.round((i.price ?? 0) * 100), 0)) / 100
	);

	// ── URL detection ─────────────────────────────────────────────────────────────
	type NamePart = { type: 'text' | 'url'; value: string };
	function parseNameParts(name: string): NamePart[] {
		const urlRe = /https?:\/\/[^\s]+/g;
		const result: NamePart[] = [];
		let last = 0, m: RegExpExecArray | null;
		while ((m = urlRe.exec(name)) !== null) {
			if (m.index > last) result.push({ type: 'text', value: name.slice(last, m.index) });
			result.push({ type: 'url', value: m[0] });
			last = m.index + m[0].length;
		}
		if (last < name.length) result.push({ type: 'text', value: name.slice(last) });
		return result.length ? result : [{ type: 'text', value: name }];
	}

	// ── Tree order (subtasks / subnotes) ──────────────────────────────────────────
	type TreeItem = { item: Item; level: number; tlIdx: number; rootTlIdx: number; sibIdx: number };
	function buildTreeOrder(allItems: Item[]): TreeItem[] {
		const result: TreeItem[] = [];
		const topLevel = allItems.filter((i) => i.parentId === null).sort((a, b) => a.order - b.order);
		const validIds = new Set(allItems.map((i) => i.id));
		function addSubtree(item: Item, level: number, rootTlIdx: number) {
			const children = allItems
				.filter((i) => i.parentId === item.id)
				.sort((a, b) => a.order - b.order);
			children.forEach((child, sibIdx) => {
				result.push({ item: child, level, tlIdx: -1, rootTlIdx, sibIdx });
				if (level < 2 && !child.note) addSubtree(child, level + 1, rootTlIdx);
			});
		}
		topLevel.forEach((item, idx) => {
			result.push({ item, level: 0, tlIdx: idx, rootTlIdx: idx, sibIdx: idx });
			if (!item.heading) addSubtree(item, 1, idx);
		});
		// Append orphaned items (parent was deleted by a peer without cascading)
		const rendered = new Set(result.map((t) => t.item.id));
		const orphans = allItems.filter((i) => i.parentId !== null && !validIds.has(i.parentId) && !rendered.has(i.id));
		orphans.forEach((item, idx) => {
			result.push({ item, level: 0, tlIdx: topLevel.length + idx, rootTlIdx: topLevel.length + idx, sibIdx: topLevel.length + idx });
		});
		return result;
	}
	const treeItems = $derived(buildTreeOrder(items));
	const checkedCount = $derived(items.filter((i) => !i.heading && !i.note && i.checked).length);
	const uncheckedCount = $derived(items.filter((i) => !i.heading && !i.note && !i.checked).length);
	// Count of items that "Del checked" would actually delete
	const delCheckedCount = $derived(
		selectedIds.size > 0
			? items.filter((i) => selectedIds.has(i.id) && i.checked).length
			: checkedCount
	);

	// ── Universal input (add + edit) ─────────────────────────────────────────
	// A single text input always at the top — iOS opens keyboard in the same
	// place every time, preventing the scroll-jump on focus.
	type InputMode = 'add' | 'edit';
	let inputMode = $state<InputMode>('add');
	let universalValue = $state('');
	// bind:this requires a plain let (not $state) to receive the real DOM node
	let universalInputEl: HTMLInputElement | null = null;
	// Subtask / subnote context when adding a child item
	let newItemParentId = $state<string | null>(null);
	let newItemIsNote = $state(false);

	function focusInput() {
		tick().then(() => universalInputEl?.focus());
	}

	function addItem() {
		if (!universalValue.trim()) return;
		createItem(listId, universalValue.trim(), null, newItemParentId, newItemIsNote);
		universalValue = '';
		newItemParentId = null;
		newItemIsNote = false;
		// Blur dismisses the iOS keyboard and hides the confirm FAB
		universalInputEl?.blur();
	}

	// ── Clipboard import ───────────────────────────────────────────────────
	async function importFromClipboard() {
		let text: string;
		try {
			text = await navigator.clipboard.readText();
		} catch {
			alert('Could not read clipboard. Make sure you have granted clipboard permission.');
			return;
		}
		const lines = text
			.split(/\r?\n/)
			.map((l) => l.trim())
			.filter((l) => l.length > 0)        // strip blank / whitespace-only lines
			.filter((l) => /\p{L}/u.test(l));   // strip lines with no letter in any script
		if (lines.length === 0) {
			alert('No valid items found in clipboard.');
			return;
		}
		createItemsBatch(listId, lines);
	}

	// ── Edit item name via universal input ────────────────────────────────────────
	let editingId = $state<string | null>(null);

	// Which item's price is currently being edited via the keypad
	let pricingItemId = $state<string | null>(null);
	let priceBuffer = $state('');

	function startEditName(item: Item) {
		editingId = item.id;
		inputMode = 'edit';
		universalValue = item.name;
		pricingItemId = null;
		newItemParentId = null;
		newItemIsNote = false;
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
		newItemIsNote = false;
		universalInputEl?.blur();
	}

	function startEditPrice(item: Item) {
		cancelLongPress(); // prevent long-press selection firing after price editor opens
		pricingItemId = item.id;
		// Use toFixed to avoid float stringification artefacts (e.g. 1.1000000000000001)
		priceBuffer = item.price !== null
			? (item.price < 0 ? '-' : '') + Math.abs(item.price).toFixed(2).replace(/\.?0+$/, '')
			: '';
		cancelEdit();
	}

	function handleKeypadInput(key: string) {
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
	let selectedIds = $state<Set<string>>(new Set());

	function toggleSelect(id: string) {
		const next = new Set(selectedIds);
		if (next.has(id)) next.delete(id); else next.add(id);
		selectedIds = next;
	}

	function bulkUncheck() {
		const ids = selectedIds.size > 0
			? [...selectedIds].filter((id) => { const it = items.find((i) => i.id === id); return it && !it.heading && !it.note; })
			: items.filter((i) => !i.heading && !i.note).map((i) => i.id);
		setItemsChecked(ids, false);
		selectedIds = new Set();
	}

	function bulkDeleteChecked() {
		const targets =
			selectedIds.size > 0
				? items.filter((i) => selectedIds.has(i.id) && i.checked).map((i) => i.id)
				: items.filter((i) => i.checked).map((i) => i.id);
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
			toggleSelect(id);
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
		function onEnd() {
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
			document.removeEventListener('pointermove', onMove);
			document.removeEventListener('pointerup', onEnd);
			document.removeEventListener('pointercancel', onEnd);
		};
	});

	// ── Type conversion ───────────────────────────────────────────────────────────
	function toggleType() {
		if (!listMeta) return;
		updateList(listId, { type: listMeta.type === 'plain' ? 'priced' : 'plain' });
	}

	const isPriced = $derived(listMeta?.type === 'priced');

	// ── Copy as TSV (for pasting into Google Sheets) ──────────────────────────────
	let showHeaderMenu = $state(false);
	let copyStatus = $state<'idle' | 'copied' | 'error'>('idle');

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
			rows.push('Done\tPrice\tItem');
		} else {
			rows.push('Done\tItem');
		}

		// Data rows
		for (const { item, level } of treeItems) {
			const indent = '\t'.repeat(level);
			const itemName = indent + item.name;
			if (item.heading) {
				rows.push(isPriced ? `\t\t${itemName}` : `\t${itemName}`);
			} else if (item.note) {
				rows.push(isPriced ? `\t\t${itemName}` : `\t${itemName}`);
			} else if (isPriced) {
				const price = item.price !== null ? (item.price).toFixed(2) : '';
				const done = item.checked ? '✓' : '';
				rows.push(`${done}\t${price}\t${itemName}`);
			} else {
				const done = item.checked ? '✓' : '';
				rows.push(`${done}\t${itemName}`);
			}
		}

		// Blank rows (⌈items / 3⌉) for extra entries
		const blankCount = Math.ceil(treeItems.length / 3);
		for (let i = 0; i < blankCount; i++) rows.push(isPriced ? '\t\t' : '\t');

		// SUM row for priced lists
		// Header is at row 4 (1-indexed); data starts at row 5.
		// Last row before SUM = 4 + treeItems.length + blankCount.
		if (isPriced) {
			const lastRow = 4 + treeItems.length + blankCount;
			rows.push(`\t=SUM(B5:B${lastRow})\tTotal`);
		}

		// Sentinel end
		rows.push(`--- END: ${name} ---`);

		const tsv = rows.join('\n');
		try {
			await navigator.clipboard.writeText(tsv);
			copyStatus = 'copied';
			setTimeout(() => { copyStatus = 'idle'; }, 2000);
		} catch {
			copyStatus = 'error';
			setTimeout(() => { copyStatus = 'idle'; }, 3000);
		}
		showHeaderMenu = false;
	}

	$effect(() => {
		if (!showHeaderMenu) return;
		function dismiss(e: PointerEvent) {
			const el = e.target as HTMLElement | null;
			if (!el?.closest('.header-menu-wrap')) showHeaderMenu = false;
		}
		document.addEventListener('pointerdown', dismiss, { capture: true });
		return () => document.removeEventListener('pointerdown', dismiss, { capture: true });
	});

	// If a peer deletes the item currently being priced or named, clear stale state
	$effect(() => {
		const ids = new Set(items.map((i) => i.id));
		if (pricingItemId !== null && !ids.has(pricingItemId)) {
			pricingItemId = null;
			priceBuffer = '';
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

	// Reset all transient editing/drag state when navigating to a different list
	$effect(() => {
		void listId; // track prop change
		editingId = null;
		inputMode = 'add';
		universalValue = '';
		newItemParentId = null;
		newItemIsNote = false;
		pricingItemId = null;
		priceBuffer = '';
		selectedIds = new Set();
		touchDragFrom = null;
		touchDragOver = null;
		touchDragParentKey = null;
		// Reset scroll-shrink when switching lists — set scrollTop to 0;
		// the scroll listener will fire and restore max-height to fullHeight automatically.
		if (itemListEl) itemListEl.scrollTop = 0;
	});

	// ── Scroll-shrink favourites bar ──────────────────────────────────────────────
	// The fav-bar lives inside .item-list as its first child so it scrolls away
	// naturally — no JS listener, no layout feedback loop.
	let itemListEl: HTMLElement | null = null;

	// ── Delete confirmation ───────────────────────────────────────────────────────
	let confirmMsg = $state('');
	let confirmAction = $state<(() => void) | null>(null);

	function askDelete(msg: string, action: () => void) {
		confirmMsg = msg;
		confirmAction = () => action();
	}

	// ── Info dialog ───────────────────────────────────────────────────────────
	let infoItem = $state<Item | null>(null);

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
</script>

<div class="screen" class:has-keypad={pricingItemId && isPriced}>
	<!-- Header -->
	<header>
		<button class="home-btn" onclick={onHome} aria-label="Home">🏠</button>
		<div class="breadcrumb">
			{#each breadcrumbItems as crumb, i}
				{#if i > 0}<span class="sep">/</span>{/if}
				{#if crumb.id === 'LIST'}
					<span class="crumb current">{crumb.name}</span>
				{:else}
					<button class="crumb" onclick={() => navigateToCrumb(crumb)}>{crumb.name}</button>
				{/if}
			{/each}
		</div>
		<div class="header-menu-wrap">
			<button class="type-btn" onclick={() => showHeaderMenu = !showHeaderMenu} aria-label="More options">⋮</button>
			{#if showHeaderMenu}
				<div class="header-menu" role="menu">
					<button role="menuitem" onclick={copyAsTSV}>📋 Copy as spreadsheet</button>
				</div>
			{/if}
		</div>
		<div class="header-right">
			<button class="type-btn" onclick={toggleType} title="Convert list type">
				{isPriced ? '📋' : '💰'}
			</button>
		</div>
	</header>

	{#if copyStatus !== 'idle'}
		<div class="copy-toast" class:error={copyStatus === 'error'}>
			{copyStatus === 'copied' ? '✓ Copied! Paste into Google Sheets.' : '✗ Clipboard access denied.'}
		</div>
	{/if}

	<!-- Universal input bar: always present so iOS keyboard opens at a fixed position -->
	{#if !pricingItemId || !isPriced}
		<div class="universal-bar">
			<!-- form fires submit on iOS keyboard return/tick, more reliable than keydown -->
			<form
				class="universal-row"
				onsubmit={(e) => { e.preventDefault(); inputMode === 'edit' ? submitEditName() : addItem(); }}
			>
				<div class="input-wrap">
					<input
						bind:this={universalInputEl}
						class="universal-input"
						class:editing={inputMode === 'edit'}
						placeholder={inputMode === 'edit' ? 'Edit name…' : newItemParentId ? (newItemIsNote ? 'Add subnote…' : 'Add subtask…') : 'Add item…'}
						bind:value={universalValue}
						onkeydown={(e) => { if (e.key === 'Escape') cancelEdit(); }}
					/>
					{#if inputMode === 'edit'}
						<button type="button" class="input-clear" onclick={cancelEdit} aria-label="Cancel edit">✕</button>
					{/if}
				</div>
				{#if inputMode === 'edit'}
					<button type="submit" class="universal-btn done-btn">OK</button>
				{:else}
					<button type="submit" class="universal-btn add-btn" disabled={!universalValue.trim()}>OK</button>
					<button type="button" class="universal-btn paste-btn" onclick={importFromClipboard} title="Import from clipboard">📋</button>
				{/if}
			</form>
			{#if newItemParentId}
				<div class="subtask-hint">
					{newItemIsNote ? '📝 Subnote' : '➕ Subtask'} → <em>{items.find((i) => i.id === newItemParentId)?.name ?? '…'}</em>
					<button type="button" onclick={() => { newItemParentId = null; newItemIsNote = false; universalValue = ''; }} aria-label="Cancel">✕</button>
				</div>
			{/if}
		</div>
	{/if}

	<!-- Summary bar -->
	<div class="summary-bar">
		{#if isPriced}
			<span>Total: <strong>{formatPrice(total)}</strong></span>
		{/if}
		<span class="check-counts">✓ {checkedCount} / ✗ {uncheckedCount}</span>
		{#if items.some((i) => i.checked)}
			<button class="bulk-btn" onclick={bulkUncheck}>Uncheck{selectedIds.size > 0 ? ' sel.' : ' all'}</button>
		{/if}
		{#if delCheckedCount > 0}
			<button class="bulk-btn danger" onclick={() => askDelete(
				selectedIds.size > 0
					? `Delete ${delCheckedCount} checked item(s)?`
					: `Delete all ${checkedCount} checked item(s)?`,
				bulkDeleteChecked
			)}>Del checked</button>
		{/if}
	</div>

	<!-- Item list (fav-bar is first child — it scrolls away naturally) -->
	<div class="item-list" bind:this={itemListEl}>
		{#if favouriteLists.length > 0}
			<div class="fav-bar">
				<span class="fav-label">★</span>
				{#each favouriteLists as fav}
					<button
						class="fav-chip"
						class:fav-chip-active={fav.id === listId}
						style="--chip-color:{fav.color}"
						onclick={() => { if (fav.id !== listId) onOpenList(fav.id); }}
					>{listPath(fav)}</button>
				{/each}
			</div>
		{/if}
		{#each treeItems as {item, level, tlIdx, rootTlIdx, sibIdx}}
			{@const canAddChildren = !item.note && !item.heading && level < 2}
			{@const linkParts = parseNameParts(item.name)}
			{@const parentKey = item.parentId ?? '__top__'}
			<div
				class="item-row"
				class:heading={item.heading}
				class:note={item.note}
				class:priced-row={isPriced && !item.heading && !item.note}
				class:checked={item.checked}
				class:selected={selectedIds.has(item.id)}
				class:drag-source={touchDragParentKey === parentKey && sibIdx === touchDragFrom}
				class:drag-above={touchDragParentKey === parentKey && touchDragOver === sibIdx && touchDragFrom !== null && touchDragFrom > sibIdx}
				class:drag-below={touchDragParentKey === parentKey && touchDragOver === sibIdx && touchDragFrom !== null && touchDragFrom < sibIdx}
				data-sibling-index={sibIdx}
				data-parent-key={parentKey}
				style={level > 0 ? `padding-left:calc(0.75rem + ${level} * 1.5rem)` : undefined}
			>
				{#if item.heading}
					<!-- Heading: full-width bold label, no checkbox, no price -->
					<button
						class="item-name heading-name"
						class:editing={editingId === item.id}
						onclick={() => startEditName(item)}
					>{#each linkParts as part}{#if part.type === 'url'}<a class="item-url" href={part.value} target="_blank" rel="noopener noreferrer" onpointerdown={(e) => e.stopPropagation()} onclick={(e) => e.stopPropagation()}>{part.value}</a>{:else}{part.value}{/if}{/each}</button>
					<button class="drag-handle" aria-label="Drag to reorder" onpointerdown={(e) => startItemDrag(e, sibIdx, parentKey)}>☰</button>
					<RowMenu items={[
						{ label: 'ℹ️ Info', action: () => infoItem = item },
					{ label: '📌 Unheading', action: () => updateItem(item.id, { heading: false }) },
						{ label: '🗑 Delete', danger: true, action: () => askDelete(`Delete "${item.name}"?`, () => deleteItemCascade(item.id)) }
					]} />
				{:else if item.note}
					<!-- Note: no checkbox, italic text -->
					<span class="note-icon">📝</span>
					<button
						class="item-name note-name"
						class:editing={editingId === item.id}
						onclick={() => startEditName(item)}
						onpointerdown={(e) => onPointerDown(e, item.id)}
						onpointermove={cancelLongPress}
						onpointerup={cancelLongPress}
						onpointercancel={cancelLongPress}
					>{#each linkParts as part}{#if part.type === 'url'}<a class="item-url" href={part.value} target="_blank" rel="noopener noreferrer" onpointerdown={(e) => { e.stopPropagation(); cancelLongPress(); }} onclick={(e) => e.stopPropagation()}>{part.value}</a>{:else}{part.value}{/if}{/each}</button>
					<button class="drag-handle" aria-label="Drag to reorder" onpointerdown={(e) => startItemDrag(e, sibIdx, parentKey)}>☰</button>
					<RowMenu items={[
						{ label: 'ℹ️ Info', action: () => infoItem = item },
						{ label: '🗑 Delete', danger: true, action: () => askDelete(`Delete "${item.name}"?`, () => deleteItemCascade(item.id)) }
					]} />
				{:else if isPriced}
					<!-- Priced: name wraps top line, controls on bottom line -->
					<div class="priced-top">
						<button class="check-btn" onclick={() => toggleCheck(item)} aria-label={item.checked ? 'Uncheck' : 'Check'}>
							{item.checked ? '☑' : '☐'}
						</button>
						<button
							class="item-name"
							class:strikethrough={item.checked}
							class:editing={editingId === item.id}
							onclick={() => startEditName(item)}
							onpointerdown={(e) => onPointerDown(e, item.id)}
							onpointermove={cancelLongPress}
							onpointerup={cancelLongPress}
							onpointercancel={cancelLongPress}
						>{#each linkParts as part}{#if part.type === 'url'}<a class="item-url" href={part.value} target="_blank" rel="noopener noreferrer" onpointerdown={(e) => { e.stopPropagation(); cancelLongPress(); }} onclick={(e) => e.stopPropagation()}>{part.value}</a>{:else}{part.value}{/if}{/each}</button>
					</div>
					<div class="priced-bottom">
						<button
							class="price-btn"
							class:editing={pricingItemId === item.id}
							onclick={() => pricingItemId === item.id ? commitPrice() : startEditPrice(item)}
						>{pricingItemId === item.id ? (priceBuffer || '0') : formatPrice(item.price)}</button>
						<button class="drag-handle" aria-label="Drag to reorder" onpointerdown={(e) => startItemDrag(e, sibIdx, parentKey)}>☰</button>
						<RowMenu items={[
							{ label: 'ℹ️ Info', action: () => infoItem = item },
							...(canAddChildren ? [
								{ label: '➕ Add Subtask', action: () => { newItemParentId = item.id; newItemIsNote = false; focusInput(); } },
								{ label: '📝 Add Subnote', action: () => { newItemParentId = item.id; newItemIsNote = true; focusInput(); } }
							] : []),
							...(level === 0 ? [{ label: '📌 Make Heading', action: () => updateItem(item.id, { heading: true, checked: false, price: null }) }] : []),
							{ label: '🗑 Delete', danger: true, action: () => askDelete(`Delete "${item.name}"?`, () => deleteItemCascade(item.id)) }
						]} />
					</div>
				{:else}
					<!-- Plain: single row -->
					<button class="check-btn" onclick={() => toggleCheck(item)} aria-label={item.checked ? 'Uncheck' : 'Check'}>
						{item.checked ? '☑' : '☐'}
					</button>
					<button
						class="item-name"
						class:strikethrough={item.checked}
						class:editing={editingId === item.id}
						onclick={() => startEditName(item)}
						onpointerdown={(e) => onPointerDown(e, item.id)}
						onpointermove={cancelLongPress}
						onpointerup={cancelLongPress}
						onpointercancel={cancelLongPress}
					>{#each linkParts as part}{#if part.type === 'url'}<a class="item-url" href={part.value} target="_blank" rel="noopener noreferrer" onpointerdown={(e) => { e.stopPropagation(); cancelLongPress(); }} onclick={(e) => e.stopPropagation()}>{part.value}</a>{:else}{part.value}{/if}{/each}</button>
					<button class="drag-handle" aria-label="Drag to reorder" onpointerdown={(e) => startItemDrag(e, sibIdx, parentKey)}>☰</button>
					<RowMenu items={[
						{ label: 'ℹ️ Info', action: () => infoItem = item },
						...(canAddChildren ? [
							{ label: '➕ Add Subtask', action: () => { newItemParentId = item.id; newItemIsNote = false; focusInput(); } },
							{ label: '📝 Add Subnote', action: () => { newItemParentId = item.id; newItemIsNote = true; focusInput(); } }
						] : []),
						...(level === 0 ? [{ label: '📌 Make Heading', action: () => updateItem(item.id, { heading: true, checked: false }) }] : []),
						{ label: '🗑 Delete', danger: true, action: () => askDelete(`Delete "${item.name}"?`, () => deleteItemCascade(item.id)) }
					]} />
				{/if}
			</div>
		{/each}
	</div>

	<!-- Floating blue + button: open keyboard / start adding -->
	<!-- Position depends on handedness: left-handed = right side, right-handed = left side -->
	{#if !pricingItemId || !isPriced}
		<button
			class="fab"
			class:fab-right={settings.handedness !== 'right'}
			class:fab-left={settings.handedness === 'right'}
			aria-label="Add item"
			onclick={() => { newItemParentId = null; newItemIsNote = false; cancelEdit(); focusInput(); }}
		>＋</button>
	{/if}

	<!-- Floating green confirm button: opposite side to blue button -->
	{#if universalValue.trim()}
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
	{#if isPriced && pricingItemId}
		<div class="keypad-area">
			<div class="keypad-header">
				<span>Entering price: <strong>{priceBuffer || '0'}</strong></span>
				<button onclick={commitPrice}>Done</button>
			</div>
			<NumericKeypad onKey={handleKeypadInput} />
		</div>
	{/if}

	<!-- Delete confirmation dialog -->
	{#if confirmAction}
		<ConfirmDialog
			message={confirmMsg}
			onConfirm={() => { confirmAction?.(); confirmAction = null; }}
			onCancel={() => (confirmAction = null)}
		/>
	{/if}

	<!-- Info dialog -->
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
</div>

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
	}
	.breadcrumb {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		flex-wrap: wrap;
		font-size: 1rem;
		min-width: 0;
	}
	.crumb {
		background: none;
		border: none;
		color: var(--accent);
		cursor: pointer;
		padding: 0;
		font-size: inherit;
		white-space: nowrap;
	}
	.crumb.current {
		color: var(--text);
		font-weight: 600;
		cursor: default;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 180px;
		display: inline-block;
	}
	.sep { color: var(--text2); }
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
	.fav-label { color: #f59e0b; font-size: 1rem; flex-shrink: 0; }
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
	.fav-chip.fav-chip-active {
		background: var(--chip-color, var(--accent));
		color: #fff;
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
	.type-btn {
		background: none;
		border: none;
		font-size: 1.2rem;
		cursor: pointer;
		padding: 0.2rem;
	}

	.header-menu-wrap {
		position: relative;
		margin-left: 0.4rem;
		flex-shrink: 0;
	}
	.header-right {
		margin-left: auto;
		flex-shrink: 0;
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
		gap: 0.75rem;
		padding: 0.5rem 1rem;
		background: var(--bg3);
		font-size: 0.85rem;
		flex-shrink: 0;
		flex-wrap: wrap;
	}
	.check-counts { color: var(--text2); }
	.bulk-btn {
		padding: 0.25rem 0.6rem;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--bg2);
		color: var(--text);
		font-size: 0.8rem;
		cursor: pointer;
	}
	.bulk-btn.danger { color: #ef4444; border-color: #ef4444; }
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
		padding: 0.5rem 0.75rem;
		border-bottom: 1px solid var(--border);
		transition: background 0.15s, opacity 0.15s;
		min-height: 52px;
	}
	/* Priced rows: two-line layout on touch devices only */
	@media (pointer: coarse) {
		.item-row.priced-row {
			flex-direction: column;
			align-items: stretch;
			gap: 0;
			padding: 0.4rem 0.75rem 0.3rem;
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
	.item-row.drag-source { opacity: 0.4; }
	.item-row.drag-above { background: var(--bg3); box-shadow: inset 0 2px 0 var(--accent); }
	.item-row.drag-below { background: var(--bg3); box-shadow: inset 0 -2px 0 var(--accent); }
	.item-row.heading {
		background: var(--bg2);
		border-top: 1px solid var(--border);
		padding: 0.25rem 0.75rem;
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
		font-size: 1.82rem;
		cursor: pointer;
		padding: 0;
		flex-shrink: 0;
		min-width: 50px;
		min-height: 50px;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	@media (pointer: fine) {
		/* Mouse/trackpad users: revert to original size */
		.check-btn { font-size: 1.4rem; min-width: 44px; min-height: 44px; }
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
		white-space: normal;
		word-break: break-word;
		overflow-wrap: break-word;
	}
	.item-name.strikethrough { text-decoration: line-through; color: var(--text2); }
	.item-name.editing { color: var(--accent); font-style: italic; }
	.item-url {
		color: var(--accent);
		text-decoration: underline;
		word-break: break-all;
	}
	/* ── Subnotes ────────────────────────────────────────────────────────── */
	.note-icon {
		font-size: 1.1rem;
		flex-shrink: 0;
		min-width: 50px;
		min-height: 50px;
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
		min-height: 44px;
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
		gap: 0.5rem;
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
	}
	.universal-input:focus { border-color: var(--accent); }
	.universal-input.editing { border-color: var(--accent); }
	.input-clear {
		position: absolute;
		right: 0.4rem;
		top: 50%;
		transform: translateY(-50%);
		background: none;
		border: none;
		color: var(--text2);
		font-size: 1rem;
		cursor: pointer;
		padding: 0.2rem 0.3rem;
		line-height: 1;
	}
	.universal-btn {
		padding: 0.6rem 1rem;
		border: none;
		border-radius: 10px;
		font-size: 0.95rem;
		font-weight: 600;
		cursor: pointer;
		flex-shrink: 0;
	}
	.add-btn { background: var(--accent); color: #fff; }
	.add-btn:disabled { opacity: 0.4; }
	.done-btn { background: #22c55e; color: #fff; }
	.paste-btn {
		background: var(--bg3);
		color: var(--text);
		padding: 0.6rem 0.7rem;
		font-size: 1.1rem;
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
</style>
