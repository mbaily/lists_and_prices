<script lang="ts">
	/**
	 * Full-width numeric keypad — 4 columns × 4 rows.
	 * Col 1-3: digits / decimal. Col 4: Enter, -, Backspace, (empty).
	 *
	 * Layout:
	 *   7  8  9  ⌫
	 *   4  5  6  +/-
	 *   1  2  3  (empty)
	 *   .  0  0  ✓
	 */
	let { onKey }: { onKey: (key: string) => void } = $props();

	const keys: Array<{ label: string; key: string; wide?: boolean; action?: boolean }> = [
		{ label: '7', key: '7' },
		{ label: '8', key: '8' },
		{ label: '9', key: '9' },
		{ label: '⌫', key: 'backspace', action: true },

		{ label: '4', key: '4' },
		{ label: '5', key: '5' },
		{ label: '6', key: '6' },
		{ label: '±', key: 'minus', action: true },

		{ label: '1', key: '1' },
		{ label: '2', key: '2' },
		{ label: '3', key: '3' },
		{ label: '', key: '' },

		{ label: '0', key: '0' },
		{ label: '.', key: '.' },
		{ label: '00', key: '00' },
		{ label: '✓', key: 'enter', action: true }
	];

	function tap(key: string) {
		if (!key) return;
		if (key === '00') {
			onKey('0');
			onKey('0');
		} else {
			onKey(key);
		}
	}

	// iOS fires both touchstart and a synthetic click ~300ms later.
	// Track whether the last interaction was a touch so onclick can be ignored.
	let lastTouchTime = 0;

	function handleTouch(e: TouchEvent, key: string) {
		e.preventDefault(); // prevents scroll AND suppresses the synthetic click
		lastTouchTime = Date.now();
		tap(key);
	}

	function handleClick(key: string) {
		// Ignore the synthetic click that iOS generates after touchstart
		if (Date.now() - lastTouchTime < 600) return;
		tap(key);
	}
</script>

<div class="keypad">
	{#each keys as k}
		<button
			class="key"
			class:action={k.action}
			class:empty={!k.key}
			disabled={!k.key}
			ontouchstart={(e) => handleTouch(e, k.key)}
			onclick={() => handleClick(k.key)}
		>
			{k.label}
		</button>
	{/each}
</div>

<style>
	.keypad {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		width: 100%;
	}
	.key {
		border: none;
		border-top: 1px solid var(--border);
		border-right: 1px solid var(--border);
		background: var(--bg2);
		color: var(--text);
		font-size: 1.4rem;
		font-weight: 500;
		padding: 1rem 0;
		cursor: pointer;
		user-select: none;
		-webkit-user-select: none;
		touch-action: manipulation;
		transition: background 0.1s;
	}
	.key:nth-child(4n) { border-right: none; }
	.key:active { background: var(--bg3); }
	.key.action {
		background: var(--bg3);
		color: var(--accent);
		font-weight: 700;
	}
	.key.action:last-child {
		background: var(--accent);
		color: #fff;
	}
	.key.empty, .key:disabled {
		background: var(--bg);
		cursor: default;
		pointer-events: none;
	}
</style>
