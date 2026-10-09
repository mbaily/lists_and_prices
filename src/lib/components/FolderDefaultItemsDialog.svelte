<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { docState, commitState } from '$lib/yjsStore.svelte';
	import {
		readFolders, addFolderDefaultItem, updateFolderDefaultItem,
		removeFolderDefaultItem, moveFolderDefaultItem,
		type Folder, type FolderDefaultItem
	} from '$lib/data';
	import ConfirmDialog from './ConfirmDialog.svelte';

	let { folder, onClose }: { folder: Folder; onClose: () => void } = $props();
	const dialogId = $props.id();
	let backdropEl: HTMLDivElement;
	let dialogEl: HTMLElement;
	let inputEl: HTMLTextAreaElement;
	let name = $state('');
	let isNote = $state(false);
	let editingId = $state<string | null>(null);
	let error = $state('');
	let removeId = $state<string | null>(null);
	const liveFolder = $derived.by(() => {
		void docState.version;
		return readFolders().find(entry => entry.id === folder.id);
	});
	const items = $derived(liveFolder?.defaultItems ?? []);
	const canEdit = $derived(!!liveFolder && !commitState.isHistorical);

	function resizeInput() {
		if (!inputEl) return;
		inputEl.style.height = 'auto';
		inputEl.style.height = `${inputEl.scrollHeight}px`;
	}

	async function focusInput() {
		await tick();
		if (inputEl?.isConnected) {
			resizeInput();
			inputEl.focus();
		}
	}

	function resetInput() {
		name = '';
		editingId = null;
		error = '';
	}

	function toggleType() {
		if (!canEdit) return;
		isNote = !isNote;
		void focusInput();
	}

	function startEdit(item: FolderDefaultItem) {
		if (!canEdit) return;
		editingId = item.id;
		name = item.name;
		isNote = item.note;
		error = '';
		void focusInput();
	}

	function submitItem() {
		if (!canEdit || !name.trim()) return;
		const saved = editingId
			? updateFolderDefaultItem(folder.id, editingId, { name: name.trim(), note: isNote })
			: addFolderDefaultItem(folder.id, name.trim(), isNote);
		if (!saved) {
			error = 'Could not save this default item. It may have been removed.';
			return;
		}
		resetInput();
		void focusInput();
	}

	function confirmRemove() {
		if (canEdit && removeId) {
			removeFolderDefaultItem(folder.id, removeId);
			if (editingId === removeId) resetInput();
		}
		removeId = null;
	}

	$effect(() => {
		if (editingId && !items.some(item => item.id === editingId)) resetInput();
	});

	onMount(() => {
		const previousFocus = document.activeElement;
		void focusInput();
		function handleKey(event: KeyboardEvent) {
			if (event.defaultPrevented) return;
			const backdrops = document.querySelectorAll('.backdrop');
			if (backdrops[backdrops.length - 1] !== backdropEl) return;
			if (event.key === 'Escape') {
				event.preventDefault();
				onClose();
			} else if (event.key === 'Tab') {
				const controls = dialogEl.querySelectorAll<HTMLElement>('button:not([disabled]), textarea:not([disabled])');
				const first = controls[0], last = controls[controls.length - 1];
				if (event.shiftKey && (document.activeElement === first || !dialogEl.contains(document.activeElement))) {
					event.preventDefault();
					last?.focus();
				} else if (!event.shiftKey && (document.activeElement === last || !dialogEl.contains(document.activeElement))) {
					event.preventDefault();
					first?.focus();
				}
			}
		}
		document.addEventListener('keydown', handleKey);
		return () => {
			document.removeEventListener('keydown', handleKey);
			if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
		};
	});
</script>

<div bind:this={backdropEl} class="backdrop di-backdrop" role="presentation"
	onpointerdown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
	<div bind:this={dialogEl} class="di-dialog" role="dialog" aria-modal="true" aria-labelledby={`${dialogId}-title`} aria-describedby={`${dialogId}-hint`} tabindex="-1">
		<div class="di-title" id={`${dialogId}-title`}>📋 Default Items</div>
		<div class="di-folder-name">📁 {liveFolder?.name ?? folder.name}</div>
		<p class="di-hint" id={`${dialogId}-hint`}>These todos and notes are added to each new list created directly in this folder.</p>

		{#if items.length}
			<div class="di-list">
				{#each items as item, index (item.id)}
					<div class="di-row">
						<button class="di-name-btn" class:editing={editingId === item.id} disabled={!canEdit}
							onclick={() => startEdit(item)} aria-label={`Edit ${item.note ? 'note' : 'todo'}: ${item.name}`} title="Edit default item">
							<span class="di-item-type" aria-hidden="true">{item.note ? '📝' : '☑'}</span><span class="di-item-name">{item.name}</span>
						</button>
						<button class="di-icon-btn" disabled={!canEdit || index === 0} onclick={() => moveFolderDefaultItem(folder.id, item.id, 'up')} aria-label={`Move ${item.name} up`}>↑</button>
						<button class="di-icon-btn" disabled={!canEdit || index === items.length - 1} onclick={() => moveFolderDefaultItem(folder.id, item.id, 'down')} aria-label={`Move ${item.name} down`}>↓</button>
						<button class="di-icon-btn di-del" disabled={!canEdit} onclick={() => removeId = item.id} aria-label={`Remove ${item.name}`}>🗑</button>
					</div>
				{/each}
			</div>
		{:else}
			<p class="di-empty">No default items yet.</p>
		{/if}
		{#if !liveFolder}<p class="di-error" role="alert">This folder is no longer available.</p>{/if}

		<form class="di-new-row" onsubmit={(event) => { event.preventDefault(); submitItem(); }}>
			<div class="di-input-wrap">
				<textarea bind:this={inputEl} class="di-input" class:editing={editingId !== null} bind:value={name}
					rows="1" enterkeyhint="done" disabled={!canEdit}
					aria-label={editingId ? 'Edit default item' : isNote ? 'Add default note' : 'Add default todo'}
					placeholder={editingId ? 'Edit item…' : isNote ? 'Add note…' : 'Add todo…'}
					oninput={() => { error = ''; resizeInput(); }}
					onkeydown={(event) => {
						if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); submitItem(); }
						if (event.key === 'Escape' && editingId) { event.preventDefault(); event.stopPropagation(); resetInput(); void focusInput(); }
					}}></textarea>
				<button type="button" class="di-type-toggle" class:is-note={isNote} disabled={!canEdit}
					onpointerdown={(event) => event.preventDefault()} onclick={toggleType} aria-label="Toggle note/todo" aria-pressed={isNote}
					title={isNote ? 'Note — switch to todo' : 'Todo — switch to note'}>{isNote ? '📝' : '☑'}</button>
			</div>
			<button class="di-add-btn" type="submit" disabled={!canEdit || !name.trim()}>{editingId ? 'Save' : 'Add'}</button>
		</form>
		{#if editingId}<button class="di-cancel-edit" onclick={() => { resetInput(); void focusInput(); }}>Cancel edit</button>{/if}
		{#if error}<p class="di-error" role="alert">{error}</p>{/if}
		<button class="di-close" onclick={onClose}>Done</button>
	</div>
</div>

{#if removeId && canEdit}
	<ConfirmDialog message={`Remove “${items.find(item => item.id === removeId)?.name ?? 'this item'}” from default items?`}
		confirmLabel="Remove" onConfirm={confirmRemove} onCancel={() => removeId = null} />
{/if}

<style>
	.di-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0,0,0,0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 100;
		padding: 1rem;
	}
	.di-dialog {
		background: var(--bg);
		border-radius: 16px;
		padding: 1.25rem;
		max-width: 340px;
		width: 100%;
		max-height: calc(100dvh - 2rem);
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.di-title { font-size: 1rem; font-weight: 700; }
	.di-folder-name { font-size: 0.9rem; color: var(--text2); overflow-wrap: anywhere; }
	.di-hint { font-size: 0.78rem; color: var(--text2); margin: 0; line-height: 1.4; }
	.di-empty { font-size: 0.85rem; color: var(--text2); margin: 0.25rem 0; }
	.di-list { display: flex; flex-direction: column; gap: 0.3rem; max-height: 40vh; overflow-y: auto; }
	.di-row { display: flex; align-items: center; gap: 0.3rem; }
	.di-name-btn {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: baseline;
		gap: 0.4rem;
		background: none;
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 0.5rem 0.65rem;
		text-align: left;
		font-size: 0.9rem;
		color: var(--text);
		cursor: pointer;
	}
	.di-item-type { flex-shrink: 0; }
	.di-item-name { white-space: pre-wrap; overflow-wrap: anywhere; }
	.di-name-btn.editing { border-color: var(--accent); }
	.di-icon-btn {
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
	.di-icon-btn:disabled { opacity: 0.3; cursor: default; }
	.di-icon-btn:not(:disabled):hover { background: var(--bg2); }
	.di-del { color: #ef4444; }
	.di-del:not(:disabled):hover { background: color-mix(in srgb, #ef4444 12%, transparent); }
	.di-new-row { display: flex; align-items: flex-start; gap: 0.4rem; margin-top: 0.25rem; }
	.di-input-wrap { flex: 1; min-width: 0; position: relative; }
	.di-input {
		box-sizing: border-box;
		width: 100%;
		min-height: 40px;
		max-height: 20vh;
		resize: none;
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 0.5rem 2.8rem 0.5rem 0.65rem;
		font-family: inherit;
		font-size: 0.9rem;
		background: var(--bg2);
		color: var(--text);
	}
	.di-input:focus, .di-input.editing { outline: none; border-color: var(--accent); }
	.di-type-toggle {
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
	.di-type-toggle.is-note { color: var(--accent); border-color: var(--accent); background: transparent; }
	.di-add-btn {
		background: var(--accent);
		color: #fff;
		border: none;
		border-radius: 8px;
		padding: 0.6rem 0.85rem;
		font-size: 0.9rem;
		font-weight: 600;
		cursor: pointer;
	}
	.di-add-btn:disabled { opacity: 0.4; cursor: default; }
	.di-cancel-edit { align-self: flex-end; background: none; border: none; color: var(--text2); cursor: pointer; font-size: 0.8rem; }
	.di-error { font-size: 0.75rem; color: #ef4444; margin: 0; }
	.di-close {
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
