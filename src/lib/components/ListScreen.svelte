<script lang="ts">
	import { docState } from '$lib/yjsStore.svelte';
	import { onDestroy, tick } from 'svelte';
	import {
		readItems,
		readLists,
		createItem,
		updateItem,
		deleteItem,
		updateList,
		reorderItems,
		type Item,
		type ListMeta
	} from '$lib/data';
	import { settings } from '$lib/settings.svelte';
	import NumericKeypad from './NumericKeypad.svelte';
	import ConfirmDialog from './ConfirmDialog.svelte';

	let { listId, onBack, onHome }: { listId: string; onBack: () => void; onHome: () => void } = $props();

	let items = $derived.by(() => {
		void docState.version;
		try { return readItems(listId); } catch { return []; }
	});
	let listMeta = $derived.by(() => {
		void docState.version;
		try { return readLists().find((l) => l.id === listId) ?? null; } catch { return null; }
	});

	// Sum in integer cents to avoid float accumulation (e.g. 0.1+0.2 = 0.300...04)
	const total = $derived(
		Math.round(items.reduce((s, i) => s + Math.round((i.price ?? 0) * 100), 0)) / 100
	);
	const checkedCount = $derived(items.filter((i) => i.checked).length);
	const uncheckedCount = $derived(items.filter((i) => !i.checked).length);

	// ── Universal input (add + edit) ─────────────────────────────────────────
	// A single text input always at the top — iOS opens keyboard in the same
	// place every time, preventing the scroll-jump on focus.
	type InputMode = 'add' | 'edit';
	let inputMode = $state<InputMode>('add');
	let universalValue = $state('');
	// bind:this requires a plain let (not $state) to receive the real DOM node
	let universalInputEl: HTMLInputElement | null = null;

	function focusInput() {
		tick().then(() => universalInputEl?.focus());
	}

	function addItem() {
		if (!universalValue.trim()) return;
		createItem(listId, universalValue.trim());
		universalValue = '';
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
			.filter((l) => l.length > 0)        // strip blank / whitespace-only
			.filter((l) => /[a-zA-Z]/.test(l)); // strip lines with no alphabetic char
		if (lines.length === 0) {
			alert('No valid items found in clipboard.');
			return;
		}
		for (const name of lines) createItem(listId, name);
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
		universalInputEl?.blur();
	}

	function startEditPrice(item: Item) {
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
		const targets = selectedIds.size > 0 ? [...selectedIds] : items.map((i) => i.id);
		for (const id of targets) updateItem(id, { checked: false });
		selectedIds = new Set();
	}

	function bulkDeleteChecked() {
		const targets =
			selectedIds.size > 0
				? items.filter((i) => selectedIds.has(i.id) && i.checked).map((i) => i.id)
				: items.filter((i) => i.checked).map((i) => i.id);
		for (const id of targets) deleteItem(id);
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

	// ── Touch drag reorder ────────────────────────────────────────────────────────────────
	// HTML5 drag doesn't work on iOS — use touch events instead.
	let touchDragFrom = $state<number | null>(null);
	let touchDragOver = $state<number | null>(null);

	function startItemDrag(e: TouchEvent, index: number) {
		e.stopPropagation();
		cancelLongPress(); // don't trigger select when dragging
		touchDragFrom = index;
		touchDragOver = index;
	}

	$effect(() => {
		if (touchDragFrom === null) return;
		function onMove(e: TouchEvent) {
			e.preventDefault();
			const touch = e.touches[0];
			const el = document.elementFromPoint(touch.clientX, touch.clientY);
			const row = el?.closest('[data-item-index]') as HTMLElement | null;
			if (row?.dataset.itemIndex !== undefined) {
				touchDragOver = parseInt(row.dataset.itemIndex, 10);
			}
		}
		function onEnd() {
			if (touchDragFrom !== null && touchDragOver !== null && touchDragFrom !== touchDragOver) {
				reorderItems(listId, touchDragFrom, touchDragOver);
			}
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

	// ── Type conversion ───────────────────────────────────────────────────────────
	function toggleType() {
		if (!listMeta) return;
		updateList(listId, { type: listMeta.type === 'plain' ? 'priced' : 'plain' });
	}

	const isPriced = $derived(listMeta?.type === 'priced');
</script>

<div class="screen" class:has-keypad={pricingItemId && isPriced}>
	<!-- Header -->
	<header>
		<button class="home-btn" onclick={onHome} aria-label="Home">🏠</button>
		<button class="back-btn" onclick={onBack}>← Back</button>
		<span class="list-title">{listMeta?.name ?? '…'}</span>
		<div class="header-right">
			<button class="type-btn" onclick={toggleType} title="Convert list type">
				{isPriced ? '📋' : '💰'}
			</button>
		</div>
	</header>

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
						placeholder={inputMode === 'edit' ? 'Edit name…' : 'Add item…'}
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
			<button class="bulk-btn danger" onclick={bulkDeleteChecked}>Del checked</button>
		{/if}
	</div>

	<!-- Item list -->
	<div class="item-list">
		{#each items as item, i}
			<div
				class="item-row"
				class:priced-row={isPriced}
				class:checked={item.checked}
				class:selected={selectedIds.has(item.id)}
				class:drag-source={touchDragFrom === i}
				class:drag-target={touchDragOver === i && touchDragFrom !== null && touchDragFrom !== i}
				data-item-index={i}
			>
				{#if isPriced}
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
						>{item.name}</button>
					</div>
					<div class="priced-bottom">
						<button
							class="price-btn"
							class:editing={pricingItemId === item.id}
							onclick={() => pricingItemId === item.id ? commitPrice() : startEditPrice(item)}
						>{pricingItemId === item.id ? (priceBuffer || '0') : formatPrice(item.price)}</button>
						<button class="del-btn" onclick={() => deleteItem(item.id)} aria-label="Delete">🗑</button>
						<button class="drag-handle" aria-label="Drag to reorder" ontouchstart={(e) => startItemDrag(e, i)}>⠿</button>
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
					>{item.name}</button>
					<button class="del-btn" onclick={() => deleteItem(item.id)} aria-label="Delete">🗑</button>
					<button class="drag-handle" aria-label="Drag to reorder" ontouchstart={(e) => startItemDrag(e, i)}>⠿</button>
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
			onclick={() => { cancelEdit(); focusInput(); }}
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
		padding: 0.75rem 1rem;
		background: var(--bg2);
		border-bottom: 1px solid var(--border);
		flex-shrink: 0;
	}
	.back-btn {
		background: none;
		border: none;
		font-size: 1rem;
		color: var(--accent);
		cursor: pointer;
		padding: 0;
	}
	.home-btn {
		background: none;
		border: none;
		font-size: 1.1rem;
		cursor: pointer;
		padding: 0;
		line-height: 1;
	}
	.list-title {
		flex: 1;
		font-weight: 600;
		font-size: 1rem;
		white-space: nowrap;
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
	.item-row.drag-target { background: var(--bg3); box-shadow: inset 0 2px 0 var(--accent); }
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
		cursor: grab;
		color: var(--text2);
		font-size: 1.3rem;
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
