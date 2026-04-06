<script lang="ts">
	import { docState } from '$lib/yjsStore.svelte';
	import { readSheets, updateSheet, deleteSheet, readCells, setCell, type SheetMeta } from '$lib/data';
	import { displayValue, colIndexToLetter } from '$lib/formula';
	import ConfirmDialog from './ConfirmDialog.svelte';
	import InfoDialog from './InfoDialog.svelte';

	let { sheetId, onBack }: { sheetId: string; onBack: () => void } = $props();

	// ── Reactive data ────────────────────────────────────────────────────────────
	let sheetMeta = $derived.by((): SheetMeta | null => {
		void docState.version;
		try { return readSheets().find((s) => s.id === sheetId) ?? null; } catch { return null; }
	});

	let cells = $derived.by((): Record<string, string> => {
		void docState.version;
		try { return readCells(sheetId); } catch { return {}; }
	});

	// ── Grid dimensions ───────────────────────────────────────────────────────────
	const COLS = 26;        // A–Z
	const VISIBLE_ROWS = 50; // initial rows shown; grows as needed

	let maxRow = $derived(() => {
		let m = VISIBLE_ROWS - 1;
		for (const key of Object.keys(cells)) {
			const r = parseInt(key.split(',')[0], 10);
			if (r > m) m = r;
		}
		return m + 5; // keep 5 blank rows below last data
	});

	function getter(row: number, col: number): string {
		return cells[`${row},${col}`] ?? '';
	}

	function display(row: number, col: number): string {
		const raw = getter(row, col);
		return displayValue(raw, getter);
	}

	// ── Selection & editing ───────────────────────────────────────────────────────
	let selRow = $state(0);
	let selCol = $state(0);
	let editingValue = $state('');
	let isEditing = $state(false);
	let inputEl: HTMLInputElement | null = null;
	let cellEls: Record<string, HTMLElement> = {};

	function selectCell(row: number, col: number, startEdit = false) {
		if (isEditing) commitEdit();
		selRow = row;
		selCol = col;
		editingValue = getter(row, col);
		if (startEdit) {
			isEditing = true;
		}
	}

	function startEdit() {
		isEditing = true;
		editingValue = getter(selRow, selCol);
	}

	function commitEdit() {
		if (!isEditing) return;
		isEditing = false;
		setCell(sheetId, selRow, selCol, editingValue);
	}

	function cancelEdit() {
		isEditing = false;
		editingValue = getter(selRow, selCol);
	}

	function onCellKeydown(e: KeyboardEvent) {
		if (!isEditing) {
			if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); startEdit(); }
			else if (e.key === 'Delete' || e.key === 'Backspace') {
				e.preventDefault();
				setCell(sheetId, selRow, selCol, '');
				editingValue = '';
			}
			else if (e.key === 'ArrowRight') { e.preventDefault(); moveSel(0, 1); }
			else if (e.key === 'ArrowLeft')  { e.preventDefault(); moveSel(0, -1); }
			else if (e.key === 'ArrowDown')  { e.preventDefault(); moveSel(1, 0); }
			else if (e.key === 'ArrowUp')    { e.preventDefault(); moveSel(-1, 0); }
			else if (e.key === 'Tab')        { e.preventDefault(); moveSel(0, e.shiftKey ? -1 : 1); }
			else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
				// Start typing — clear and begin edit
				editingValue = e.key;
				isEditing = true;
			}
		} else {
			if (e.key === 'Enter')  { e.preventDefault(); commitEdit(); moveSel(1, 0); }
			else if (e.key === 'Tab') { e.preventDefault(); commitEdit(); moveSel(0, e.shiftKey ? -1 : 1); }
			else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
			else if (e.key === 'ArrowDown') { e.preventDefault(); commitEdit(); moveSel(1, 0); }
			else if (e.key === 'ArrowUp')   { e.preventDefault(); commitEdit(); moveSel(-1, 0); }
		}
	}

	function moveSel(dr: number, dc: number) {
		const newRow = Math.max(0, selRow + dr);
		const newCol = Math.max(0, Math.min(COLS - 1, selCol + dc));
		selectCell(newRow, newCol);
		// scroll cell into view
		const key = `${newRow},${newCol}`;
		cellEls[key]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
	}

	// ── Rename ────────────────────────────────────────────────────────────────────
	let renaming = $state(false);
	let renameValue = $state('');

	function startRename() {
		renameValue = sheetMeta?.name ?? '';
		renaming = true;
	}

	function submitRename() {
		if (renameValue.trim()) updateSheet(sheetId, { name: renameValue.trim() });
		renaming = false;
	}

	// ── Confirm delete ────────────────────────────────────────────────────────────
	let confirmDelete = $state(false);

	// ── Info ──────────────────────────────────────────────────────────────────────
	let showInfo = $state(false);

	function fmtDate(iso: string | null | undefined): string {
		if (!iso) return 'Unknown';
		return new Date(iso).toLocaleString(undefined, {
			day: 'numeric', month: 'short', year: 'numeric',
			hour: '2-digit', minute: '2-digit'
		});
	}

	// ── Cell address label ────────────────────────────────────────────────────────
	let cellAddr = $derived(`${colIndexToLetter(selCol)}${selRow + 1}`);

	// Close sheet if it was deleted by a peer
	$effect(() => {
		void docState.version;
		if (sheetMeta === null) onBack();
	});
</script>

<div class="screen" onkeydown={onCellKeydown} tabindex="-1" role="grid" aria-label="Spreadsheet">
	<!-- Header -->
	<header>
		<button class="back-btn" onclick={() => { commitEdit(); onBack(); }} aria-label="Back">←</button>
		{#if renaming}
			<input
				class="rename-input"
				bind:value={renameValue}
				onblur={submitRename}
				onkeydown={(e) => { if (e.key === 'Enter') submitRename(); if (e.key === 'Escape') renaming = false; }}
				autofocus
			/>
		{:else}
			<button class="sheet-title" onclick={startRename}>{sheetMeta?.name ?? '…'}</button>
		{/if}
		<div class="header-actions">
			<button class="icon-btn" onclick={() => showInfo = true} aria-label="Info">ℹ️</button>
			<button class="icon-btn danger" onclick={() => confirmDelete = true} aria-label="Delete spreadsheet">🗑</button>
		</div>
	</header>

	<!-- Formula bar -->
	<div class="formula-bar">
		<span class="cell-addr">{cellAddr}</span>
		{#if isEditing}
			<input
				class="formula-input"
				bind:this={inputEl}
				bind:value={editingValue}
				onkeydown={onCellKeydown}
				autofocus
				spellcheck={false}
				autocomplete="off"
			/>
		{:else}
			<div
				class="formula-display"
				role="textbox"
				tabindex="0"
				onclick={() => startEdit()}
				onkeydown={(e) => e.key === 'Enter' && startEdit()}
				aria-label="Cell formula"
			>{getter(selRow, selCol)}</div>
		{/if}
	</div>

	<!-- Grid -->
	<div class="grid-wrapper">
		<div class="grid" style="--cols:{COLS + 1}">
			<!-- Column header row -->
			<div class="header-cell corner"></div>
			{#each Array.from({ length: COLS }, (_, i) => i) as ci}
				<div class="header-cell col-header" class:sel-col={ci === selCol}>
					{colIndexToLetter(ci)}
				</div>
			{/each}

			<!-- Data rows -->
			{#each Array.from({ length: maxRow() }, (_, ri) => ri) as ri}
				<!-- Row header -->
				<div class="header-cell row-header" class:sel-row={ri === selRow}>{ri + 1}</div>

				{#each Array.from({ length: COLS }, (_, ci) => ci) as ci}
					{@const key = `${ri},${ci}`}
					{@const isSel = ri === selRow && ci === selCol}
					<div
						class="cell"
						class:selected={isSel}
						class:editing={isSel && isEditing}
						bind:this={cellEls[key]}
						role="gridcell"
						tabindex={isSel ? 0 : -1}
						onclick={() => selectCell(ri, ci)}
						ondblclick={() => selectCell(ri, ci, true)}
						onkeydown={isSel ? onCellKeydown : undefined}
					>
						{#if isSel && isEditing}
							<!-- editing handled in formula bar -->
						{:else}
							{display(ri, ci)}
						{/if}
					</div>
				{/each}
			{/each}
		</div>
	</div>
</div>

{#if confirmDelete}
	<ConfirmDialog
		message={`Delete spreadsheet "${sheetMeta?.name}"? All data will be lost.`}
		onConfirm={() => { deleteSheet(sheetId); confirmDelete = false; onBack(); }}
		onCancel={() => confirmDelete = false}
	/>
{/if}

{#if showInfo && sheetMeta}
	<InfoDialog
		title={sheetMeta.name}
		rows={[
			{ label: 'Type', value: 'Spreadsheet' },
			{ label: 'Created', value: fmtDate(sheetMeta.createdAt) },
			{ label: 'Modified', value: fmtDate(sheetMeta.updatedAt) }
		]}
		onClose={() => showInfo = false}
	/>
{/if}

<style>
	.screen {
		display: flex;
		flex-direction: column;
		position: fixed;
		inset: 0;
		background: var(--bg);
		outline: none;
	}

	header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		background: var(--bg2);
		border-bottom: 1px solid var(--border);
		flex-shrink: 0;
	}

	.back-btn {
		background: none;
		border: none;
		font-size: 1.3rem;
		color: var(--accent);
		cursor: pointer;
		padding: 0 0.25rem;
		line-height: 1;
	}

	.sheet-title {
		flex: 1;
		background: none;
		border: none;
		font-size: 1rem;
		font-weight: 600;
		color: var(--text);
		cursor: pointer;
		text-align: left;
		padding: 0;
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.rename-input {
		flex: 1;
		font-size: 1rem;
		font-weight: 600;
		background: var(--bg3);
		border: 1px solid var(--accent);
		border-radius: 6px;
		padding: 0.25rem 0.5rem;
		color: var(--text);
		min-width: 0;
	}

	.header-actions {
		display: flex;
		gap: 0.25rem;
		flex-shrink: 0;
	}

	.icon-btn {
		background: none;
		border: none;
		font-size: 1.1rem;
		cursor: pointer;
		padding: 0.25rem;
		color: var(--text2);
	}

	.icon-btn.danger { color: #ef4444; }

	/* Formula bar */
	.formula-bar {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.3rem 0.5rem;
		border-bottom: 1px solid var(--border);
		background: var(--bg2);
		flex-shrink: 0;
	}

	.cell-addr {
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--text2);
		min-width: 3rem;
		text-align: center;
		background: var(--bg3);
		padding: 0.15rem 0.4rem;
		border-radius: 4px;
	}

	.formula-input, .formula-display {
		flex: 1;
		font-size: 0.9rem;
		font-family: 'Courier New', monospace;
		background: var(--bg);
		border: 1px solid var(--accent);
		border-radius: 4px;
		padding: 0.2rem 0.5rem;
		color: var(--text);
		outline: none;
		min-width: 0;
	}

	.formula-display {
		border-color: var(--border);
		cursor: text;
		min-height: 1.6rem;
		display: flex;
		align-items: center;
	}

	/* Grid */
	.grid-wrapper {
		flex: 1;
		overflow: auto;
		-webkit-overflow-scrolling: touch;
	}

	.grid {
		display: grid;
		grid-template-columns: 2.5rem repeat(var(--cols, 26), minmax(6rem, 1fr));
		min-width: max-content;
	}

	.header-cell {
		position: sticky;
		background: var(--bg2);
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--text2);
		text-align: center;
		padding: 0.3rem 0.25rem;
		border-right: 1px solid var(--border);
		border-bottom: 1px solid var(--border);
		user-select: none;
		-webkit-user-select: none;
		z-index: 2;
	}

	.header-cell.col-header { top: 0; }
	.header-cell.row-header { left: 0; text-align: right; z-index: 1; }
	.header-cell.corner { top: 0; left: 0; z-index: 3; }

	.header-cell.sel-col,
	.header-cell.sel-row {
		background: var(--accent);
		color: #fff;
	}

	.cell {
		font-size: 0.85rem;
		padding: 0.2rem 0.4rem;
		border-right: 1px solid var(--border);
		border-bottom: 1px solid var(--border);
		min-height: 1.8rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		cursor: default;
		outline: none;
		color: var(--text);
		background: var(--bg);
	}

	.cell.selected {
		outline: 2px solid var(--accent);
		outline-offset: -2px;
		background: color-mix(in srgb, var(--accent) 10%, var(--bg));
		z-index: 1;
		position: relative;
	}

	.cell.editing {
		background: color-mix(in srgb, var(--accent) 15%, var(--bg));
	}
</style>
