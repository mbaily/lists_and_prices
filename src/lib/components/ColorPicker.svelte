<script lang="ts">
	/** Colour swatch picker — tapping a swatch sets the value. */
	let { value = $bindable('#6366f1'), folderColor }: { value: string; folderColor?: string } = $props();

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
		<button type="button" class="folder-color" onclick={() => { if (folderColor) value = folderColor; }}>
			<span class="folder-swatch" style="background:{folderColor}" aria-hidden="true"></span>
			Use folder colour
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
	.folder-swatch {
		width: 16px;
		height: 16px;
		border-radius: 50%;
		flex-shrink: 0;
	}
</style>
