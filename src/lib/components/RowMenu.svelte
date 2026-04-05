<script lang="ts">
	/**
	 * A 3-dot (⋮) dropdown menu for folder/list rows.
	 * Props: items — array of { label, action, danger? }
	 * Closes on outside click or Escape.
	 */
	type MenuItem = { label: string; action: () => void; danger?: boolean };
	let { items }: { items: MenuItem[] } = $props();

	let open = $state(false);
	let btnEl: HTMLButtonElement | null = null;

	function close() { open = false; }

	function handleKey(e: KeyboardEvent) {
		if (e.key === 'Escape') close();
	}

	function handleOutside(e: MouseEvent) {
		if (btnEl && !btnEl.closest('.row-menu')?.contains(e.target as Node)) close();
	}

	$effect(() => {
		if (!open) return;
		document.addEventListener('pointerdown', handleOutside, { capture: true });
		document.addEventListener('keydown', handleKey);
		return () => {
			document.removeEventListener('pointerdown', handleOutside, { capture: true });
			document.removeEventListener('keydown', handleKey);
		};
	});
</script>

<div class="row-menu">
	<button
		bind:this={btnEl}
		class="menu-trigger"
		aria-label="More options"
		aria-expanded={open}
		onclick={(e) => { e.stopPropagation(); open = !open; }}
	>⋮</button>
	{#if open}
		<div class="menu-panel" role="menu">
			{#each items as item}
				<button
					class="menu-item"
					class:danger={item.danger}
					role="menuitem"
					onclick={() => { close(); item.action(); }}
				>{item.label}</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.row-menu {
		position: relative;
		flex-shrink: 0;
	}
	.menu-trigger {
		background: none;
		border: none;
		font-size: 1.3rem;
		color: var(--text2);
		cursor: pointer;
		min-width: 36px;
		min-height: 44px;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		line-height: 1;
		letter-spacing: 0;
	}
	.menu-panel {
		position: absolute;
		right: 0;
		top: 100%;
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 10px;
		box-shadow: 0 4px 20px rgba(0,0,0,0.18);
		min-width: 160px;
		z-index: 100;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
	.menu-item {
		background: none;
		border: none;
		padding: 0.75rem 1rem;
		text-align: left;
		font-size: 0.95rem;
		color: var(--text);
		cursor: pointer;
		border-bottom: 1px solid var(--border);
	}
	.menu-item:last-child { border-bottom: none; }
	.menu-item:hover, .menu-item:active { background: var(--bg2); }
	.menu-item.danger { color: #ef4444; }
</style>
