<script lang="ts">
	import { onMount } from 'svelte';
	import { docState } from '$lib/yjsStore.svelte';
	import {
		readFolders,
		addFolderCheckbox,
		renameFolderCheckbox,
		removeFolderCheckbox,
		moveFolderCheckbox,
		MAX_FOLDER_CHECKBOXES,
		type Folder
	} from '$lib/data';
	import ConfirmDialog from './ConfirmDialog.svelte';

	let { folder, onClose }: { folder: Folder; onClose: () => void } = $props();

	let backdropEl: HTMLDivElement | null = null;

	onMount(() => {
		function handleKey(e: KeyboardEvent) {
			if (e.key === 'Escape') {
				const backdrops = document.querySelectorAll('.backdrop');
				if (backdrops[backdrops.length - 1] === backdropEl) {
					onClose();
				}
			}
		}
		document.addEventListener('keydown', handleKey);
		return () => document.removeEventListener('keydown', handleKey);
	});

	// Re-derive from the live doc so add/rename/reorder/delete are reflected immediately.
	let liveFolder = $derived.by(() => {
		void docState.version;
		return readFolders().find((f) => f.id === folder.id) ?? folder;
	});
	let checkboxes = $derived(liveFolder.checkboxes ?? []);

	let newName = $state('');
	let addError = $state('');
	let renamingId = $state<string | null>(null);
	let renameValue = $state('');
	let renameError = $state('');
	let confirmRemoveId = $state<string | null>(null);

	function addNew() {
		const name = newName.trim();
		if (!name) return;
		if (checkboxes.length >= MAX_FOLDER_CHECKBOXES) { addError = `Maximum of ${MAX_FOLDER_CHECKBOXES} names reached.`; return; }
		if (checkboxes.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
			addError = 'A checkbox with that name already exists.';
			return;
		}
		const id = addFolderCheckbox(folder.id, name);
		if (!id) { addError = 'Could not add that name.'; return; }
		newName = '';
		addError = '';
	}

	function startRename(id: string, current: string) {
		renamingId = id;
		renameValue = current;
		renameError = '';
	}

	function commitRename() {
		if (renamingId && renameValue.trim()) {
			const ok = renameFolderCheckbox(folder.id, renamingId, renameValue.trim());
			if (!ok) {
				renameError = 'Another checkbox already has that name.';
				return; // keep editing so the user can fix it
			}
		}
		renamingId = null;
		renameValue = '';
		renameError = '';
	}

	function requestRemove(id: string) {
		confirmRemoveId = id;
	}

	function confirmRemove() {
		if (confirmRemoveId) removeFolderCheckbox(folder.id, confirmRemoveId);
		confirmRemoveId = null;
	}
</script>

<div bind:this={backdropEl} class="backdrop fc-backdrop" role="dialog" aria-modal="true"
	onclick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
	<div class="fc-dialog">
		<div class="fc-title">☑ Named Checkboxes</div>
		<div class="fc-folder-name">📁 {folder.name}</div>
		<p class="fc-hint">
			Each item gets one toggle per name below. The <strong>last</strong> name in the
			list marks an item as fully done for counts and filters. Removing all names
			reverts lists in this folder to a single checkbox.
		</p>

		{#if checkboxes.length > 0}
			<div class="fc-list">
				{#each checkboxes as cb, i}
					<div class="fc-row">
						{#if renamingId === cb.id}
							<div class="fc-rename-wrap">
								<input
									class="fc-input"
									bind:value={renameValue}
									autofocus
									oninput={() => renameError = ''}
									onkeydown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') { renamingId = null; renameError = ''; } }}
									onblur={commitRename}
								/>
								{#if renameError}<p class="fc-error">{renameError}</p>{/if}
							</div>
						{:else}
							<button class="fc-name-btn" onclick={() => startRename(cb.id, cb.name)} title="Rename">
								{cb.name}{#if i === checkboxes.length - 1}<span class="fc-final-badge">final</span>{/if}
							</button>
						{/if}
						<button class="fc-icon-btn" disabled={i === 0} onclick={() => moveFolderCheckbox(folder.id, cb.id, 'up')} aria-label="Move up">↑</button>
						<button class="fc-icon-btn" disabled={i === checkboxes.length - 1} onclick={() => moveFolderCheckbox(folder.id, cb.id, 'down')} aria-label="Move down">↓</button>
						<button class="fc-icon-btn fc-del" onclick={() => requestRemove(cb.id)} aria-label="Remove">🗑</button>
					</div>
				{/each}
			</div>
		{:else}
			<p class="fc-empty">No named checkboxes — lists here use a single plain checkbox.</p>
		{/if}

		<div class="fc-new-row">
			<input
				class="fc-input"
				bind:value={newName}
				placeholder="Add a name…"
				maxlength="24"
				oninput={() => addError = ''}
				onkeydown={(e) => { if (e.key === 'Enter') addNew(); }}
			/>
			<button class="fc-add-btn" onclick={addNew} disabled={!newName.trim() || checkboxes.length >= MAX_FOLDER_CHECKBOXES}>Add</button>
		</div>
		{#if addError}<p class="fc-error">{addError}</p>{/if}
		{#if checkboxes.length >= MAX_FOLDER_CHECKBOXES}
			<p class="fc-limit">Maximum of {MAX_FOLDER_CHECKBOXES} names reached.</p>
		{/if}

		<button class="fc-close" onclick={onClose}>Done</button>
	</div>
</div>

{#if confirmRemoveId}
	<ConfirmDialog
		message={checkboxes.length === 1
			? 'Remove this name? Lists in this folder will revert to a single plain checkbox. Per-name checked state is not recoverable.'
			: 'Remove this name? Its per-item checked state is not recoverable.'}
		confirmLabel="Remove"
		onConfirm={confirmRemove}
		onCancel={() => confirmRemoveId = null}
	/>
{/if}

<style>
	.fc-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0,0,0,0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 100;
		padding: 1rem;
	}
	.fc-dialog {
		background: var(--bg);
		border-radius: 16px;
		padding: 1.25rem;
		max-width: 340px;
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.fc-title {
		font-size: 1rem;
		font-weight: 700;
	}
	.fc-folder-name {
		font-size: 0.9rem;
		color: var(--text2);
	}
	.fc-hint {
		font-size: 0.78rem;
		color: var(--text2);
		margin: 0;
		line-height: 1.4;
	}
	.fc-empty {
		font-size: 0.85rem;
		color: var(--text2);
		margin: 0.25rem 0;
	}
	.fc-list {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		max-height: 40vh;
		overflow-y: auto;
	}
	.fc-row {
		display: flex;
		align-items: center;
		gap: 0.3rem;
	}
	.fc-rename-wrap {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
	.fc-error {
		font-size: 0.75rem;
		color: #ef4444;
		margin: 0;
	}
	.fc-name-btn {
		flex: 1;
		background: none;
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 0.5rem 0.65rem;
		text-align: left;
		font-size: 0.9rem;
		color: var(--text);
		cursor: pointer;
	}
	.fc-final-badge {
		margin-left: 0.4rem;
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--accent);
	}
	.fc-icon-btn {
		background: none;
		border: none;
		cursor: pointer;
		font-size: 1rem;
		color: var(--text2);
		padding: 0.3rem;
		min-width: 32px;
		min-height: 36px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 6px;
	}
	.fc-icon-btn:disabled { opacity: 0.3; cursor: default; }
	.fc-icon-btn:not(:disabled):hover { background: var(--bg2); }
	.fc-del { color: #ef4444; }
	.fc-del:hover { background: color-mix(in srgb, #ef4444 12%, transparent); }
	.fc-new-row {
		display: flex;
		gap: 0.4rem;
		margin-top: 0.25rem;
	}
	.fc-input {
		flex: 1;
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 0.5rem 0.65rem;
		font-size: 0.9rem;
		background: var(--bg2);
		color: var(--text);
	}
	.fc-add-btn {
		background: var(--accent);
		color: #fff;
		border: none;
		border-radius: 8px;
		padding: 0.5rem 0.85rem;
		font-size: 0.9rem;
		font-weight: 600;
		cursor: pointer;
	}
	.fc-add-btn:disabled { opacity: 0.4; cursor: default; }
	.fc-limit {
		font-size: 0.75rem;
		color: #ef4444;
		margin: 0;
	}
	.fc-close {
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
