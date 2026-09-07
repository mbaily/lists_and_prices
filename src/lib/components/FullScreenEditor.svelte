<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import type Quill from 'quill';
	import 'quill/dist/quill.snow.css';
	import { QuillBinding } from 'y-quill';
	import { getMutableDoc, getWsProvider, getUndoManager, docState, commitState } from '$lib/yjsStore.svelte';
	import { getItemYText } from '$lib/data';
	import { NoteEditSession } from '$lib/noteEditing';
	import ConfirmDialog from './ConfirmDialog.svelte';

	let {
		itemId,
		initialContent,
		readOnly = false,
		onSave,
		onClose
	}: { itemId: string; initialContent: string; readOnly?: boolean; onSave: (content: string) => void; onClose: () => void } = $props();

	let editorContainer: HTMLDivElement | null = null;
	let quill: Quill | null = null;
	let binding: QuillBinding | null = null;
	let editSession: NoteEditSession | null = null;
	let editorError = $state<string | null>(null);
	let editorReady = $state(false);
	let showConfirmCancel = $state(false);
	let showConfirmClose = $state(false);
	let viewportHeight = $state('100vh');
	let viewportTop = $state('0px');
	
	$effect(() => {
		const updateHeight = () => {
			if (window.visualViewport) {
				viewportHeight = `${window.visualViewport.height}px`;
				viewportTop = `${window.visualViewport.offsetTop}px`;
			} else {
				viewportHeight = `${window.innerHeight}px`;
				viewportTop = `0px`;
			}
		};

		if (window.visualViewport) {
			window.visualViewport.addEventListener('resize', updateHeight);
			window.visualViewport.addEventListener('scroll', updateHeight);
		} else {
			window.addEventListener('resize', updateHeight);
		}
		
		updateHeight();

		return () => {
			if (window.visualViewport) {
				window.visualViewport.removeEventListener('resize', updateHeight);
				window.visualViewport.removeEventListener('scroll', updateHeight);
			} else {
				window.removeEventListener('resize', updateHeight);
			}
		};
	});

	onMount(() => {
		let cancelled = false;
		async function initialize() {
			try {
				// Quill touches document at module load, so it must not be imported
				// during SvelteKit SSR. Also do not finish loading an unmounted note.
				const { default: Quill } = await import('quill');
				if (cancelled || !editorContainer) return;
				quill = new Quill(editorContainer, {
					theme: 'snow', readOnly,
					modules: {
						toolbar: false,
						history: { userOnly: true },
						keyboard: { bindings: {
							undo: { key: 'z', shortKey: true, shiftKey: false, handler: () => { editSession?.undoManager.undo(); return false; } },
							redo: { key: 'z', shortKey: true, shiftKey: true, handler: () => { editSession?.undoManager.redo(); return false; } },
							redoY: { key: 'y', shortKey: true, handler: () => { editSession?.undoManager.redo(); return false; } }
						} }
					}
				});
				if (readOnly) {
					quill.setText(initialContent);
					editorReady = true;
					return;
				}
				const doc = getMutableDoc();
				const yText = getItemYText(doc, itemId);
				binding = new QuillBinding(yText, quill, getWsProvider()?.awareness);
				editSession = new NoteEditSession(yText, binding, getUndoManager());
				editorReady = true;
				quill.focus();
			} catch (error) {
				if (cancelled) return;
				editorError = error instanceof Error ? error.message : 'Could not open the note.';
				quill?.disable();
			}
		}
		void initialize();
		return () => { cancelled = true; };
	});

	onDestroy(() => {
		binding?.destroy();
		editSession?.destroy();
	});

	function handleSave() {
		if (readOnly || commitState.isHistorical || !binding || !editSession) return;
		const text = binding.type.toString().replace(/\n$/, '');
		onSave(text);
		editSession.commit();
		docState.version++;
	}

	function requestCancel() {
		if (!readOnly && editSession?.hasChanges) {
			showConfirmCancel = true;
			return;
		}
		onClose();
	}

	function discardChanges() {
		if (readOnly || commitState.isHistorical) return;
		editSession?.discard();
		docState.version++;
		showConfirmCancel = false;
		onClose();
	}

	function requestClose() {
		if (!readOnly && editSession?.hasChanges) {
			showConfirmClose = true;
			return;
		}
		onClose();
	}
</script>

<div class="fullscreen-editor-overlay">
	<div class="visual-viewport-container" style="height: {viewportHeight}; top: {viewportTop};">
		<div class="header">
			{#if !readOnly}
			<button class="close-btn" onclick={requestCancel}>Cancel</button>
			{/if}
			<button class="close-btn" onclick={requestClose}>Close</button>
			{#if !readOnly}<button class="save-btn" onclick={handleSave} disabled={!editorReady || !!editorError}>Save</button>{/if}
		</div>
		{#if editorError}<p role="alert">{editorError}</p>{/if}
		
		<div class="editor-wrapper">
			<div bind:this={editorContainer}></div>
		</div>
	</div>

	{#if showConfirmCancel}
		<ConfirmDialog
			message="You have unsaved changes. Are you sure you want to discard them?"
			confirmLabel="Discard"
			cancelLabel="Keep Editing"
			isDanger={true}
			onConfirm={discardChanges}
			onCancel={() => showConfirmCancel = false}
		/>
	{/if}

	{#if showConfirmClose}
		<ConfirmDialog
			message="You have unsaved changes. Would you like to save them before closing?"
			confirmLabel="Discard"
			altLabel="Save"
			cancelLabel="Cancel"
			isDanger={true}
			onConfirm={discardChanges}
			onAlt={() => { showConfirmClose = false; handleSave(); onClose(); }}
			onCancel={() => showConfirmClose = false}
		/>
	{/if}
</div>

<style>
	.fullscreen-editor-overlay {
		position: fixed;
		inset: 0;
		background: var(--bg);
		z-index: 9999;
		overscroll-behavior: none;
	}
	.visual-viewport-container {
		position: absolute;
		left: 0;
		right: 0;
		display: flex;
		flex-direction: column;
	}
	.header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0 1rem;
		border-bottom: 1px solid var(--border);
		background: var(--bg2);
	}
	.close-btn, .save-btn {
		background: none;
		border: none;
		font-size: 1rem;
		cursor: pointer;
		padding: 0.25rem 1rem;
		border-radius: 6px;
	}
	.close-btn {
		color: var(--text2);
	}
	.close-btn:hover {
		background: var(--bg3);
	}
	.save-btn {
		background: #6366f1;
		color: #fff;
		font-weight: 600;
	}
	.save-btn:hover {
		background: #4f46e5;
	}
	.editor-wrapper {
		flex: 1;
		display: flex;
		flex-direction: column;
		background: var(--bg);
		color: var(--text);
		overflow: hidden;
	}
	:global(.ql-editor) {
		color: var(--text) !important;
		padding: 3px !important;
	}
	:global(.ql-editor.ql-blank::before) {
		color: var(--text3) !important;
		left: 3px !important;
	}
	:global(.ql-container) {
		flex: 1;
		font-size: 1.05rem;
		font-family: inherit;
	}
	:global(.ql-container.ql-snow) {
		border: none !important;
	}
</style>
