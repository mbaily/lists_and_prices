<script lang="ts">
	import { settings, updateSettings } from '$lib/settings.svelte';
	import { exportBackup, importBackup, type BackupFile } from '$lib/data';
	import ConfirmDialog from './ConfirmDialog.svelte';

	let { onBack, onLogout }: { onBack: () => void; onLogout: () => void } = $props();

	const APP_VERSION = __APP_VERSION__;

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
		URL.revokeObjectURL(url);
	}

	// ── Restore ─────────────────────────────────────────────────────────────────
	let restoreMode = $state<'replace' | 'merge'>('merge');
	let restoreFileInput: HTMLInputElement | null = null;
	let restoreStatus = $state<string | null>(null);
	let restoreError = $state<string | null>(null);
	let pendingBackup = $state<BackupFile | null>(null);

	function onFileSelected(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (!file) return;
		const reader = new FileReader();
		reader.onload = () => {
			try {
				const backup = JSON.parse(reader.result as string) as BackupFile;
				if (backup.version !== 1 || !Array.isArray(backup.folders) || !Array.isArray(backup.lists) || !Array.isArray(backup.items)) {
					restoreError = 'Invalid backup file.';
					return;
				}
				pendingBackup = backup;
				restoreError = null;
			} catch (err) {
				restoreError = `Failed to parse backup: ${err}`;
				restoreStatus = null;
			} finally {
				if (restoreFileInput) restoreFileInput.value = '';
			}
		};
		reader.readAsText(file);
	}

	function confirmRestore() {
		if (!pendingBackup) return;
		try {
			importBackup(pendingBackup, restoreMode);
			restoreStatus = `Restored ${pendingBackup.folders.length} folders, ${pendingBackup.lists.length} lists, ${pendingBackup.items.length} items.`;
		} catch (err) {
			restoreError = `Restore failed: ${err}`;
		}
		pendingBackup = null;
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

<div class="screen">
	<header>
		<button class="back-btn" onclick={onBack}>← Back</button>
		<span class="title">Settings</span>
	</header>

	<div class="content">
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
			<h2>Account</h2>
			<button class="logout-btn" onclick={onLogout}>Sign out</button>
		</section>

		<section>
			<h2>Backup &amp; Restore</h2>
			<button class="action-btn" onclick={downloadBackup}>⬇ Download backup</button>

			<div class="restore-modes">
				<label class="mode-label">
					<input type="radio" name="restoreMode" value="merge" bind:group={restoreMode} />
					Merge — overwrite matching IDs, keep everything else
				</label>
				<label class="mode-label">
					<input type="radio" name="restoreMode" value="replace" bind:group={restoreMode} />
					Replace all — delete existing data, restore from file
				</label>
			</div>

			<!-- Hidden file input; triggered by the visible button -->
			<input
				bind:this={restoreFileInput}
				type="file"
				accept=".json,application/json"
				style="display:none"
				onchange={onFileSelected}
			/>
			<button class="action-btn restore-btn" onclick={() => restoreFileInput?.click()}>⬆ Restore from file</button>

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

{#if pendingBackup}
	{@const modeLabel = restoreMode === 'replace' ? 'REPLACE ALL data with' : 'merge in'}
	<ConfirmDialog
		message={`Restore and ${modeLabel} ${pendingBackup.folders.length} folders, ${pendingBackup.lists.length} lists, ${pendingBackup.items.length} items? This cannot be undone.`}
		onConfirm={confirmRestore}
		onCancel={() => pendingBackup = null}
	/>
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
	.toggle-row { display: flex; gap: 0.5rem; }
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
</style>
