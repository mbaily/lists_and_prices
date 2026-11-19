<script lang="ts">
	import { tick } from 'svelte';
	import { createSearchMatcher } from '$lib/homeSearch';

	type Destination = { id: string | null; label: string; disabled?: boolean };
	let {
		label,
		options,
		value = $bindable()
	}: {
		label: string;
		options: Destination[];
		value?: string | null;
	} = $props();

	const id = $props.id();
	let query = $state('');
	let open = $state(false);
	let activeId = $state<string | null | undefined>();
	const selection = $derived(options.find(option => option.id === value && !option.disabled));
	const matches = $derived.by(() => {
		const match = createSearchMatcher(selection ? '' : query, 'and');
		return match ? options.filter(option => match(option.label)) : options;
	});
	const activeIndex = $derived(matches.findIndex(option => option.id === activeId && !option.disabled));

	function openPicker() {
		if (open) return;
		open = true;
		activeId = selection?.id;
	}

	function choose(option: Destination) {
		if (option.disabled) return;
		query = '';
		value = option.id;
		open = false;
	}

	function handleKey(event: KeyboardEvent) {
		if (event.isComposing) return;
		const { key } = event;
		if (key === 'Escape' && open) {
			event.preventDefault();
			open = false;
		} else if (key === 'ArrowDown' || key === 'ArrowUp') {
			event.preventDefault();
			openPicker();
			const choices = matches.filter(option => !option.disabled);
			if (choices.length === 0) return;
			const index = choices.findIndex(option => option.id === activeId);
			const next = key === 'ArrowDown' ? index + 1 : (index === -1 ? choices.length - 1 : index - 1);
			activeId = choices[(next + choices.length) % choices.length].id;
			void tick().then(() => document.getElementById(`${id}-option-${activeIndex}`)?.scrollIntoView({ block: 'nearest' }));
		} else if (key === 'Enter' && open) {
			event.preventDefault();
			const option = matches[activeIndex] ?? matches.find(option => !option.disabled);
			if (option) choose(option);
		}
	}
</script>

<div class="destination-picker">
	<label for={id}>{label}</label>
	<input
		{id}
		role="combobox"
		aria-autocomplete="list"
		aria-expanded={open}
		aria-controls={`${id}-options`}
		aria-activedescendant={open && activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined}
		placeholder="Search Favourites folders…"
		autocomplete="off"
		value={selection?.label ?? query}
		onfocus={openPicker}
		onclick={openPicker}
		onblur={() => open = false}
		oninput={(event) => {
			query = event.currentTarget.value;
			value = undefined;
			activeId = undefined;
			open = true;
		}}
		onkeydown={handleKey}
	/>
	<div id={`${id}-options`} role="listbox" aria-label="Favourites destinations" hidden={!open}>
		{#each matches as option, index (option.id)}
			<button
				id={`${id}-option-${index}`}
				type="button"
				role="option"
				tabindex="-1"
				aria-selected={activeIndex >= 0 ? index === activeIndex : selection?.id === option.id}
				class:active={index === activeIndex}
				aria-disabled={option.disabled || undefined}
				onmousedown={(event) => event.preventDefault()}
				onclick={() => choose(option)}
			>
				<span>{option.label}</span>
				{#if option.disabled}<span class="current" aria-hidden="true">Current location</span>{/if}
			</button>
		{/each}
	</div>
	{#if open && matches.length === 0}
		<p class="no-matches" role="status">No matching destinations.</p>
	{/if}
</div>

<style>
	.destination-picker { display: grid; gap: 0.35rem; }
	label { font-size: 0.9rem; font-weight: 600; }
	input {
		min-width: 0;
		padding: 0.4rem 0.55rem;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--bg);
		color: var(--text);
		font: inherit;
	}
	[role='listbox'] {
		max-height: min(12rem, 30dvh);
		overflow-y: auto;
		overscroll-behavior: contain;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--bg);
	}
	[role='listbox']:empty { display: none; }
	button {
		display: flex;
		justify-content: space-between;
		gap: 0.75rem;
		width: 100%;
		min-height: 2.5rem;
		align-items: center;
		padding: 0.4rem 0.55rem;
		border: 0;
		background: transparent;
		color: var(--text);
		font: inherit;
		text-align: left;
		cursor: pointer;
		overflow-wrap: anywhere;
	}
	button + button { border-top: 1px solid var(--border); }
	button:not([aria-disabled]):hover, button.active, button[aria-selected='true'] { background: var(--bg3); }
	button[aria-disabled] { color: var(--text2); cursor: default; }
	.current { flex-shrink: 0; font-size: 0.78rem; }
	.no-matches { margin: 0; color: var(--text2); font-size: 0.85rem; }
</style>
