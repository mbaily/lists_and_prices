<script lang="ts">
	let {
		title,
		rows,
		onClose
	}: {
		title: string;
		rows: { label: string; value: string }[];
		onClose: () => void;
	} = $props();
</script>

<div class="backdrop" onclick={(e) => { if (e.target === e.currentTarget) onClose(); }} role="dialog" aria-modal="true">
	<div class="dialog">
		<div class="dialog-title">{title}</div>
		<dl class="info-list">
			{#each rows as row}
				<div class="info-row">
					<dt>{row.label}</dt>
					<dd>{row.value}</dd>
				</div>
			{/each}
		</dl>
		<button class="close-btn" onclick={onClose}>Close</button>
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
		max-width: 320px;
		width: 100%;
	}
	.dialog-title {
		font-weight: 700;
		font-size: 1rem;
		margin-bottom: 1rem;
		word-break: break-word;
	}
	.info-list {
		margin: 0 0 1.25rem;
		padding: 0;
	}
	.info-row {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.4rem 0;
		border-bottom: 1px solid var(--border);
		font-size: 0.9rem;
	}
	.info-row:last-child { border-bottom: none; }
	dt { color: var(--text2); flex-shrink: 0; }
	dd { margin: 0; text-align: right; color: var(--text); word-break: break-word; }
	.close-btn {
		width: 100%;
		padding: 0.7rem;
		border: none;
		border-radius: 10px;
		background: var(--bg3);
		color: var(--text);
		font-size: 0.95rem;
		font-weight: 600;
		cursor: pointer;
	}
</style>
