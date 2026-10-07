<script lang="ts">
	import { onDestroy, tick, untrack } from 'svelte';
	import { settings, updateSettings } from '$lib/settings.svelte';
	import { exportBackup, importBackup, readFolders, type BackupFile } from '$lib/data';
	import ConfirmDialog from './ConfirmDialog.svelte';
	import KeyboardSettingsScreen from './KeyboardSettingsScreen.svelte';
	import HelpScreen from './HelpScreen.svelte';
	import { docState, commitState, exitCommitView, cacheState, idbSynced, compactLocalCache } from '$lib/yjsStore.svelte';

	let { onBack, onLogout }: { onBack: () => void; onLogout: () => void } = $props();

	const APP_VERSION = __APP_VERSION__;

	let showKeyboardSettings = $state(false);
	let showHelp = $state(false);
	let helpButtonEl = $state<HTMLButtonElement>();

	async function closeHelp() {
		showHelp = false;
		await tick();
		helpButtonEl?.focus({ preventScroll: true });
	}

	let topLevelFolders = $derived.by(() => {
		void docState.version;
		try {
			return readFolders().filter((f) => f.parentId === null && !f.archived).sort((a, b) => a.order - b.order);
		} catch {
			return [];
		}
	});

	// ── Backup ──────────────────────────────────────────────────────────────────
	function downloadBackup() {
		const data = exportBackup();
		const json = JSON.stringify(data, null, 2);
		const blob = new Blob([json], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		const date = new Date().toISOString().slice(0, 10);
		a.href = url;
		a.download = `pnl-backup-${date}.json`;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		setTimeout(() => URL.revokeObjectURL(url), 10000);
	}

	// ── Restore ─────────────────────────────────────────────────────────────────
	let restoreMode = $state<'replace' | 'merge'>('merge');
	let restoreFileInput: HTMLInputElement | null = null;
	let restoreStatus = $state<string | null>(null);
	let restoreError = $state<string | null>(null);
	let pendingBackup = $state<BackupFile | null>(null);
	let activeRestoreReader: FileReader | null = null;
	let restoreContextVersion = 0;
	let isActive = true;

	function cancelPendingRestore() {
		restoreContextVersion++;
		pendingBackup = null;
		if (activeRestoreReader && activeRestoreReader.readyState === FileReader.LOADING) activeRestoreReader.abort();
		activeRestoreReader = null;
		if (restoreFileInput) restoreFileInput.value = '';
	}

	$effect.pre(() => {
		void commitState.isHistorical;
		void commitState.commitId;
		untrack(cancelPendingRestore);
	});

	onDestroy(() => {
		isActive = false;
		cancelPendingRestore();
	});

	function onFileSelected(e: Event) {
		const input = e.target as HTMLInputElement;
		if (commitState.isHistorical || !isActive) { input.value = ''; return; }
		const file = input.files?.[0];
		if (!file) return;
		cancelPendingRestore();
		restoreStatus = null;
		restoreError = null;
		const contextVersion = restoreContextVersion;
		const reader = new FileReader();
		activeRestoreReader = reader;
		const isCurrent = () => isActive && !commitState.isHistorical && contextVersion === restoreContextVersion && activeRestoreReader === reader;
		reader.onload = () => {
			try {
				if (!isCurrent()) return;
				const backup = JSON.parse(reader.result as string) as BackupFile;
				if (backup.version !== 1 || !Array.isArray(backup.folders) || !Array.isArray(backup.lists) || !Array.isArray(backup.items)) {
					restoreError = 'Invalid backup file.';
					restoreStatus = null;
					return;
				}
				pendingBackup = backup;
				restoreError = null;
			} catch (err) {
				restoreError = `Failed to parse backup: ${err}`;
				restoreStatus = null;
			} finally {
				if (activeRestoreReader === reader) {
					activeRestoreReader = null;
					input.value = '';
				}
			}
		};
		reader.onerror = () => {
			if (!isCurrent()) return;
			restoreError = 'Could not read the backup file. Please select it again.';
			restoreStatus = null;
			activeRestoreReader = null;
			input.value = '';
		};
		reader.readAsText(file);
	}

	function confirmRestore() {
		if (commitState.isHistorical || !isActive || !pendingBackup) return;
		try {
			importBackup(pendingBackup, restoreMode);
			restoreStatus = `Restored ${pendingBackup.folders.length} folders, ${pendingBackup.lists.length} lists, ${pendingBackup.items.length} items${pendingBackup.sheets?.length ? `, ${pendingBackup.sheets.length} spreadsheets (names only — cell content is not included in backups)` : ''}.`;
			restoreError = null;
		} catch (err) {
			restoreError = `Restore failed: ${err}`;
			restoreStatus = null;
		}
		pendingBackup = null;
	}

	async function tidyLocalCache() {
		if (commitState.isHistorical || !isActive) return;
		try { await compactLocalCache(); } catch { /* Error is displayed through cacheState. */ }
	}

	const currencies = [
		{ symbol: '$', label: 'USD $' },
		{ symbol: '€', label: 'EUR €' },
		{ symbol: '£', label: 'GBP £' },
		{ symbol: '¥', label: 'JPY ¥' },
		{ symbol: 'A$', label: 'AUD A$' },
		{ symbol: 'C$', label: 'CAD C$' },
		{ symbol: 'CHF', label: 'CHF' },
		{ symbol: 'kr', label: 'SEK kr' },
		{ symbol: 'R', label: 'ZAR R' }
	];
</script>

{#if showHelp}
	<HelpScreen onBack={closeHelp} />
{:else if showKeyboardSettings}
	<KeyboardSettingsScreen onBack={() => (showKeyboardSettings = false)} />
{:else}
<div class="screen">
	<header>
		<button class="back-btn" onclick={onBack}>← Back</button>
		<span class="title">Settings</span>
	</header>
	{#if commitState.isHistorical}
		<div class="historical-banner">
			<span>Historical view — restore and local data deletion are disabled.</span>
			<button onclick={exitCommitView}>Exit</button>
		</div>
	{/if}

	<div class="content">
		<section>
			<h2>Help</h2>
			<button class="action-btn" bind:this={helpButtonEl} onclick={() => (showHelp = true)}>❓ Help &amp; user guide</button>
			<p class="hint">Instructions for lists, Smart Reports, favourites and more. Available offline.</p>
		</section>

		<section>
			<h2>Keyboard Shortcuts</h2>
			<button class="action-btn" onclick={() => (showKeyboardSettings = true)}>⌨ Configure Shortcuts</button>
		</section>

		<section>
			<h2>Quick Add</h2>
			<div class="field-group">
				<label class="field-label" for="quick-list-folder">Top Level Folder</label>
				<select
					id="quick-list-folder"
					class="setting-select"
					value={settings.quickListFolderId ?? ''}
					onchange={(e) => updateSettings({ quickListFolderId: (e.target as HTMLSelectElement).value || null })}
				>
					<option value="">Select a folder…</option>
					{#each topLevelFolders as f}
						<option value={f.id}>{f.name}</option>
					{/each}
				</select>
			</div>
			<div class="field-group">
				<label class="field-label" for="quick-list-name">Quick List Name</label>
				<input
					id="quick-list-name"
					type="text"
					class="setting-text-input"
					placeholder="Quick List"
					value={settings.quickListName ?? ''}
					oninput={(e) => updateSettings({ quickListName: (e.target as HTMLInputElement).value })}
				/>
			</div>
		</section>

		<section>
			<h2>Nearby errands</h2>
			<label class="toggle-row">
				<input
					type="checkbox"
					checked={settings.showNearbyReturnLink}
					onchange={(e) => updateSettings({ showNearbyReturnLink: e.currentTarget.checked })}
				/>
				Show return icon on lists and items opened from Nearby errands
			</label>
		</section>

		<section>
			<h2>Currency</h2>
			<div class="currency-list">
				{#each currencies as c}
					<button
						class="currency-btn"
						class:active={settings.currency === c.symbol}
						onclick={() => updateSettings({ currency: c.symbol })}
					>
						{c.label}
					</button>
				{/each}
			</div>
		</section>

		<section>
			<h2>Theme</h2>
			<div class="toggle-row">
				<button
					class="theme-btn"
					class:active={settings.theme === 'light'}
					onclick={() => updateSettings({ theme: 'light' })}
				>☀ Light</button>
				<button
					class="theme-btn"
					class:active={settings.theme === 'dark'}
					onclick={() => updateSettings({ theme: 'dark' })}
				>🌙 Dark</button>
			</div>
		</section>

		<section>
			<h2>Add items to</h2>
			<div class="toggle-row">
				<button
					class="theme-btn"
					class:active={settings.addItemPosition === 'bottom'}
					onclick={() => updateSettings({ addItemPosition: 'bottom' })}
				>⬇ Bottom</button>
				<button
					class="theme-btn"
					class:active={settings.addItemPosition === 'top'}
					onclick={() => updateSettings({ addItemPosition: 'top' })}
				>⬆ Top</button>
			</div>
		</section>

		<section>
			<h2>Add lists &amp; folders to</h2>
			<div class="toggle-row">
				<button
					class="theme-btn"
					class:active={settings.addListPosition === 'bottom'}
					onclick={() => updateSettings({ addListPosition: 'bottom' })}
				>⬇ Bottom</button>
				<button
					class="theme-btn"
					class:active={settings.addListPosition === 'top'}
					onclick={() => updateSettings({ addListPosition: 'top' })}
				>⬆ Top</button>
			</div>
		</section>

		<section>
			<h2>Parent here: add items to</h2>
			<div class="toggle-row">
				<button
					class="theme-btn"
					class:active={settings.parentHerePosition === 'bottom'}
					onclick={() => updateSettings({ parentHerePosition: 'bottom' })}
				>⬇ Bottom</button>
				<button
					class="theme-btn"
					class:active={settings.parentHerePosition === 'top'}
					onclick={() => updateSettings({ parentHerePosition: 'top' })}
				>⬆ Top</button>
			</div>
		</section>

		<section>
			<h2>Handedness</h2>
			<div class="toggle-row">
				<button
					class="theme-btn"
					class:active={settings.handedness === 'left'}
					onclick={() => updateSettings({ handedness: 'left' })}
				>🤛 Left-handed</button>
				<button
					class="theme-btn"
					class:active={settings.handedness === 'right'}
					onclick={() => updateSettings({ handedness: 'right' })}
				>🤚 Right-handed</button>
			</div>
		</section>

		<section>
			<h2>Report font size</h2>
			<div class="toggle-row">
				<input
					type="number"
					class="font-size-input"
					min="8"
					max="72"
					bind:value={settings.reportFontSize}
					onchange={(e) => {
						const val = parseInt((e.target as HTMLInputElement).value, 10);
						if (!isNaN(val) && val >= 8 && val <= 72) {
							updateSettings({ reportFontSize: val });
						} else {
							// Force re-render to revert invalid input
							const current = settings.reportFontSize;
							settings.reportFontSize = 0;
							setTimeout(() => settings.reportFontSize = current, 0);
						}
					}}
				/>
				<span class="font-size-unit">px</span>
			</div>
		</section>

		<section>
			<h2>Item spacing</h2>
			<div class="toggle-row spacing-row">
				<input
					type="range"
					class="spacing-slider"
					min="0"
					max="16"
					step="1"
					value={settings.itemSpacing}
					oninput={(e) => updateSettings({ itemSpacing: parseInt((e.target as HTMLInputElement).value, 10) })}
				/>
				<span class="spacing-value">{settings.itemSpacing}px</span>
			</div>
		</section>

		<section>
			<h2>Local cache</h2>
			<p class="hint">Your local cache is tidied automatically. You can also tidy it now; offline changes and saved history are kept.</p>
			<button disabled={commitState.isHistorical || !idbSynced.done || cacheState.compacting} onclick={tidyLocalCache}>{cacheState.compacting ? 'Tidying…' : 'Tidy local cache'}</button>
			{#if cacheState.loadMs !== null}<p class="hint">Local data loaded in {cacheState.loadMs} ms.</p>{/if}
			{#if cacheState.lastCompaction}<p class="hint" role="status">Cache tidied: {cacheState.lastCompaction.recordsBefore} stored updates → {cacheState.lastCompaction.recordsAfter}.</p>{/if}
			{#if cacheState.error}<p class="restore-err" role="alert">{cacheState.error}</p>{/if}
		</section>



		<section>
			<h2>Account</h2>
			<button class="logout-btn" onclick={onLogout}>Sign out</button>
		</section>

		<section>
			<h2>Backup &amp; Restore</h2>
			<button class="action-btn" onclick={downloadBackup}>⬇ Download backup</button>

			<div class="restore-modes">
				<label class="mode-label">
					<input type="radio" name="restoreMode" value="merge" bind:group={restoreMode} disabled={commitState.isHistorical} />
					Merge — overwrite matching IDs, keep everything else
				</label>
				<label class="mode-label">
					<input type="radio" name="restoreMode" value="replace" bind:group={restoreMode} disabled={commitState.isHistorical} />
					Replace all — delete existing data, restore from file
				</label>
			</div>

			<!-- Hidden file input; triggered by the visible button -->
			<input
				bind:this={restoreFileInput}
				type="file"
				accept=".json,application/json"
				style="display:none"
				disabled={commitState.isHistorical}
				onchange={onFileSelected}
			/>
			<button class="action-btn restore-btn" disabled={commitState.isHistorical} onclick={() => { if (!commitState.isHistorical) restoreFileInput?.click(); }}>⬆ Restore from file</button>

			{#if restoreStatus}
				<p class="restore-ok">{restoreStatus}</p>
			{/if}
			{#if restoreError}
				<p class="restore-err">{restoreError}</p>
			{/if}
		</section>

		<footer>
			<span class="version">Version {APP_VERSION}</span>
		</footer>
	</div>
</div>

{#if pendingBackup && !commitState.isHistorical}
	{@const modeLabel = restoreMode === 'replace' ? 'REPLACE ALL data with' : 'merge in'}
	<ConfirmDialog
		message={`Restore and ${modeLabel} ${pendingBackup.folders.length} folders, ${pendingBackup.lists.length} lists, ${pendingBackup.items.length} items${pendingBackup.sheets?.length ? `, ${pendingBackup.sheets.length} spreadsheets (cell content not included)` : ''}? This cannot be undone.`}
		confirmLabel="Restore"
		onConfirm={confirmRestore}
		onCancel={() => pendingBackup = null}
	/>
{/if}
{/if}

<style>
	.screen {
		height: 100dvh;
		background: var(--bg);
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
	header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem 1rem;
		background: var(--bg2);
		border-bottom: 1px solid var(--border);
	}
	.historical-banner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.4rem 1rem;
		background: #dc2626;
		color: #fff;
		font-size: 0.82rem;
		flex-shrink: 0;
	}
	.historical-banner button {
		background: transparent;
		border: 1px solid currentColor;
		border-radius: 4px;
		color: inherit;
		padding: 0.15rem 0.5rem;
		cursor: pointer;
	}
	button:disabled { cursor: default; opacity: 0.6; }
	.back-btn {
		background: none;
		border: none;
		color: var(--accent);
		font-size: 1rem;
		cursor: pointer;
		padding: 0;
	}
	.title { font-weight: 600; font-size: 1rem; }
	.content {
		padding: 1rem;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		overflow-y: auto;
		flex: 1;
	}
	section { display: flex; flex-direction: column; gap: 0.75rem; }
	h2 { margin: 0; font-size: 0.85rem; color: var(--text2); text-transform: uppercase; letter-spacing: 0.05em; }
	.currency-list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.currency-btn {
		padding: 0.45rem 0.8rem;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--bg2);
		color: var(--text);
		font-size: 0.9rem;
		cursor: pointer;
	}
	.currency-btn.active {
		background: var(--accent);
		color: #fff;
		border-color: var(--accent);
	}
	.toggle-row { display: flex; gap: 0.5rem; align-items: center; }
	.font-size-input {
		width: 5rem;
		padding: 0.4rem 0.6rem;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--bg2);
		color: var(--text);
		font-size: 1rem;
	}
	.font-size-unit { color: var(--text2); font-size: 0.95rem; }
	.theme-btn {
		flex: 1;
		padding: 0.65rem;
		border: 1px solid var(--border);
		border-radius: 10px;
		background: var(--bg2);
		color: var(--text);
		font-size: 0.95rem;
		cursor: pointer;
	}
	.theme-btn.active {
		background: var(--accent);
		color: #fff;
		border-color: var(--accent);
	}
	.logout-btn {
		padding: 0.75rem;
		background: #ef4444;
		color: #fff;
		border: none;
		border-radius: 10px;
		font-size: 0.95rem;
		font-weight: 600;
		cursor: pointer;
	}
	.action-btn {
		padding: 0.7rem 1rem;
		background: var(--accent);
		color: #fff;
		border: none;
		border-radius: 10px;
		font-size: 0.95rem;
		font-weight: 600;
		cursor: pointer;
		align-self: flex-start;
	}
	.restore-btn { background: var(--bg3); color: var(--text); border: 1px solid var(--border); }
	.restore-modes {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.mode-label {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		font-size: 0.9rem;
		color: var(--text);
		cursor: pointer;
	}
	.mode-label input { margin-top: 2px; flex-shrink: 0; }
	.restore-ok { margin: 0; font-size: 0.85rem; color: #22c55e; }
	.restore-err { margin: 0; font-size: 0.85rem; color: #ef4444; }
	footer { margin-top: auto; text-align: center; }
	.version { font-size: 0.8rem; color: var(--text2); }
	.spacing-row { align-items: center; gap: 0.75rem; }
	.spacing-slider {
		flex: 1;
		accent-color: var(--accent);
		cursor: pointer;
	}
	.spacing-value { color: var(--text2); font-size: 0.95rem; min-width: 2.5rem; text-align: right; }
	.field-group {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	.field-label {
		font-size: 0.85rem;
		color: var(--text2);
	}
	.setting-select,
	.setting-text-input {
		width: 100%;
		padding: 0.6rem 0.8rem;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--bg2);
		color: var(--text);
		font-size: 0.95rem;
		box-sizing: border-box;
		outline: none;
		font-family: inherit;
	}
	.setting-select:focus,
	.setting-text-input:focus {
		border-color: var(--accent);
	}
</style>
