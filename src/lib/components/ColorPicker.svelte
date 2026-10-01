<script lang="ts">
	/** Colour swatch picker — tapping a swatch sets the value. */
	let { value = $bindable('#6366f1'), folderColor, colorChildren = $bindable(false), showSetAll = false }: {
		value: string; folderColor?: string; colorChildren?: boolean; showSetAll?: boolean;
	} = $props();

	const colours = [
		'#6366f1', '#8b5cf6', '#ec4899', '#ef4444',
		'#f97316', '#eab308', '#22c55e', '#14b8a6',
		'#3b82f6', '#64748b', '#a16207', '#be123c'
	];
</script>

<div class="picker">
	{#each colours as c}
		<button
			class="swatch"
			class:selected={value === c}
			style="background:{c}"
			onclick={() => (value = c)}
			aria-label={c}
		></button>
	{/each}
	{#if folderColor}
		<button type="button" class="folder-color" title="Use folder colour" aria-label="Use folder colour" onclick={() => { if (folderColor) value = folderColor; }}>
			<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
				<path d="M3 7V5h6l2 2h10v13H3z" />
				<path d="M12 17v-7m-3 3 3-3 3 3" />
			</svg>
		</button>
	{/if}
	{#if showSetAll}
		<button type="button" class="folder-color" class:active={colorChildren}
			title="Set all direct children to this colour when saved" aria-label="Set all direct children to this colour when saved"
			aria-pressed={colorChildren} onclick={() => (colorChildren = !colorChildren)}>
			<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
				<path d="M12 3v6M5 14v-5h14v5M12 9v5" />
				<rect x="2" y="15" width="6" height="6" rx="1" />
				<rect x="9" y="15" width="6" height="6" rx="1" />
				<rect x="16" y="15" width="6" height="6" rx="1" />
			</svg>
		</button>
	{/if}
</div>

<style>
	.picker {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.swatch {
		width: 28px;
		height: 28px;
		border-radius: 50%;
		border: 3px solid transparent;
		cursor: pointer;
		padding: 0;
	}
	.swatch.selected {
		border-color: var(--text);
	}
	.folder-color {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.3rem 0.5rem;
		border: 1px solid var(--border, #ccc);
		border-radius: 6px;
		background: var(--bg);
		color: var(--text);
		font: inherit;
		cursor: pointer;
	}
	.folder-color.active {
		border-color: var(--accent);
		background: var(--accent);
		color: #fff;
	}
</style>
