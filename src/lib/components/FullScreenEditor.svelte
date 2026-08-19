<script lang="ts">
	import { onMount } from 'svelte';
	import Quill from 'quill';
	import 'quill/dist/quill.snow.css';
	import ConfirmDialog from './ConfirmDialog.svelte';

	let {
		initialContent,
		onSave,
		onClose
	}: { initialContent: string; onSave: (content: string) => void; onClose: () => void } = $props();

	let editorContainer: HTMLDivElement | null = null;
	let quill: Quill | null = null;
	let showConfirmCancel = $state(false);
	let showConfirmClose = $state(false);
	
	// We keep a normalized version of initialContent to compare against later
	let normalizedInitial = '';

	onMount(() => {
		if (editorContainer) {
			quill = new Quill(editorContainer, {
				theme: 'snow',
				modules: {
					toolbar: false
				}
			});
			
			if (initialContent.includes('<') && initialContent.includes('>')) {
				quill.root.innerHTML = initialContent;
			} else {
				quill.setText(initialContent);
			}
			
			normalizedInitial = quill.getText().replace(/\n$/, '');
			quill.focus();
		}
	});

	function handleSave() {
		if (quill) {
			let text = quill.getText().replace(/\n$/, '');
			onSave(text);
			normalizedInitial = text;
		}
	}

	function requestCancel() {
		if (quill) {
			let currentText = quill.getText().replace(/\n$/, '');
			if (currentText !== normalizedInitial) {
				showConfirmCancel = true;
				return;
			}
		}
		onClose();
	}

	function requestClose() {
		if (quill) {
			let currentText = quill.getText().replace(/\n$/, '');
			if (currentText !== normalizedInitial) {
				showConfirmClose = true;
				return;
			}
		}
		onClose();
	}
</script>

<div class="fullscreen-editor-overlay">
	<div class="header">
		<button class="close-btn" onclick={requestCancel}>Cancel</button>
		<button class="close-btn" onclick={requestClose}>Close</button>
		<button class="save-btn" onclick={handleSave}>Save</button>
	</div>
	
	<div class="editor-wrapper">
		<div bind:this={editorContainer}></div>
	</div>

	{#if showConfirmCancel}
		<ConfirmDialog
			message="You have unsaved changes. Are you sure you want to discard them?"
			confirmLabel="Discard"
			cancelLabel="Keep Editing"
			isDanger={true}
			onConfirm={() => { showConfirmCancel = false; onClose(); }}
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
			onConfirm={() => { showConfirmClose = false; onClose(); }}
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
		background: #fff;
		color: #000;
		overflow: hidden;
	}
	:global(.ql-container) {
		flex: 1;
		overflow-y: auto;
		font-size: 1.05rem;
		font-family: inherit;
	}
</style>
