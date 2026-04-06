<script lang="ts">
	import { onMount } from 'svelte';

	let {
		message,
		confirmLabel = 'Delete',
		onConfirm,
		onCancel
	}: { message: string; confirmLabel?: string; onConfirm: () => void; onCancel: () => void } = $props();

	onMount(() => {
		function handleKey(e: KeyboardEvent) {
			if (e.key === 'Escape') onCancel();
		}
		document.addEventListener('keydown', handleKey);
		return () => document.removeEventListener('keydown', handleKey);
	});
</script>

<div class="backdrop" role="dialog" aria-modal="true" onclick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
	<div class="dialog">
		<p>{message}</p>
		<div class="actions">
			<button class="confirm" onclick={onConfirm}>{confirmLabel}</button>
			<button class="cancel" onclick={onCancel}>Cancel</button>
		</div>
	</div>
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0,0,0,0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 100;
		padding: 1rem;
	}
	.dialog {
		background: var(--bg);
		border-radius: 16px;
		padding: 1.5rem;
		max-width: 300px;
		width: 100%;
	}
	p { margin: 0 0 1.25rem; font-size: 0.95rem; }
	.actions { display: flex; gap: 0.5rem; }
	.confirm, .cancel {
		flex: 1;
		padding: 0.7rem;
		border: none;
		border-radius: 10px;
		font-size: 0.95rem;
		font-weight: 600;
		cursor: pointer;
	}
	.confirm { background: #ef4444; color: #fff; }
	.cancel { background: var(--bg3); color: var(--text); }
</style>
