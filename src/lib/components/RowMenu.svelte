<script lang="ts">
	/**
	 * A 3-dot (⋮) dropdown menu for folder/list rows.
	 * Props: items — array of { label, action, danger? }
	 * Closes on outside tap (not scroll) or Escape.
	 */
	type MenuItem = { label: string; action: () => void; danger?: boolean };
	let { items }: { items: MenuItem[] } = $props();

	let open = $state(false);
	let panelStyle = $state('');
	let btnEl: HTMLButtonElement | null = null;

	// Scroll-vs-tap detection
	let _mayClose = false;
	let _downX = 0, _downY = 0;

	function close() { open = false; }

	function handleKey(e: KeyboardEvent) {
		if (e.key === 'Escape') close();
	}

	function onOutsideDown(e: PointerEvent) {
		if (btnEl?.closest('.row-menu')?.contains(e.target as Node)) return;
		_mayClose = true;
		_downX = e.clientX;
		_downY = e.clientY;
	}

	function onOutsideMove(e: PointerEvent) {
		if (!_mayClose) return;
		const dx = e.clientX - _downX, dy = e.clientY - _downY;
		if (dx * dx + dy * dy > 64) _mayClose = false; // >8px → scroll, not tap
	}

	function onOutsideUp() {
		if (_mayClose) close();
		_mayClose = false;
	}

	function toggle(e: MouseEvent) {
		e.stopPropagation();
		if (!open && btnEl) {
			const rect = btnEl.getBoundingClientRect();
			const ITEM_H = 52;
			const panelH = items.length * ITEM_H + 8;
			const MARGIN = 8;
			const rightEdge = window.innerWidth - rect.right;

			// Start below the button, then slide up as needed so the panel stays on screen
			let top = rect.bottom + 4;
			top = Math.min(top, window.innerHeight - panelH - MARGIN);
			top = Math.max(top, MARGIN);

			panelStyle = `top:${top}px;right:${rightEdge}px;max-height:${window.innerHeight - 2 * MARGIN}px`;
		}
		open = !open;
	}

	$effect(() => {
		if (!open) return;
		document.addEventListener('pointerdown', onOutsideDown, { capture: true });
		document.addEventListener('pointermove', onOutsideMove, { capture: true, passive: true });
		document.addEventListener('pointerup', onOutsideUp, { capture: true });
		document.addEventListener('keydown', handleKey);
		// Close when the page (or any scroll container) scrolls — menu is fixed so it would be left behind
		document.addEventListener('scroll', close, { capture: true, passive: true });
		return () => {
			document.removeEventListener('pointerdown', onOutsideDown, { capture: true });
			document.removeEventListener('pointermove', onOutsideMove, { capture: true });
			document.removeEventListener('pointerup', onOutsideUp, { capture: true });
			document.removeEventListener('keydown', handleKey);
			document.removeEventListener('scroll', close, { capture: true });
		};
	});
</script>

<div class="row-menu">
	<button
		bind:this={btnEl}
		class="menu-trigger"
		aria-label="More options"
		aria-expanded={open}
		onclick={toggle}
	>⋮</button>
	{#if open}
		<div class="menu-panel" style={panelStyle} role="menu">
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
		position: fixed;
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 10px;
		box-shadow: 0 4px 20px rgba(0,0,0,0.18);
		min-width: 160px;
		z-index: 100;
		display: flex;
		flex-direction: column;
		overflow-y: auto;
		-webkit-overflow-scrolling: touch;
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
