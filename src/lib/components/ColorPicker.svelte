<script lang="ts">
	/** Colour swatch picker — tapping a swatch sets the value. */
	let { value = $bindable('#6366f1') }: { value: string } = $props();

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
</style>
