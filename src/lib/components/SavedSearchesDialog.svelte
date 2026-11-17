<script lang="ts">
	import { onMount } from 'svelte';
	import { settings, updateSettings } from '$lib/settings.svelte';
	import type { SavedSearch, SearchMode } from '$lib/homeSearch';

	let { initialQuery, initialMode, onRun, onClose }: {
		initialQuery: string;
		initialMode: SearchMode;
		onRun: (search: SavedSearch) => void;
		onClose: () => void;
	} = $props();
	const titleId = $props.id();
	const modeLabels: Record<SearchMode, string> = { phrase: 'Phrase', and: 'AND', or: 'OR' };
	let dialog: HTMLDialogElement;
	let queryInput: HTMLInputElement;
	let query = $state('');
	let mode = $state<SearchMode>('phrase');
	let editingId = $state<string | null>(null);
	let error = $state('');

	onMount(() => {
		query = initialQuery;
		mode = initialMode;
		dialog.showModal();
	});

	function run(search: SavedSearch) {
		dialog.close();
		onRun(search);
	}

	function edit(search: SavedSearch) {
		editingId = search.id;
		query = search.query;
		mode = search.mode;
		error = '';
		queryInput.focus();
	}

	function resetForm() {
		editingId = null;
		query = '';
		mode = 'phrase';
		error = '';
		queryInput.focus();
	}

	function save() {
		const trimmed = query.trim();
		if (!trimmed) return;
		try {
			const search = { id: editingId ?? crypto.randomUUID(), query: trimmed, mode };
			const savedSearches = editingId
				? settings.savedSearches.map((entry) => entry.id === search.id ? search : entry)
				: [...settings.savedSearches, search];
			updateSettings({ savedSearches });
		} catch {
			error = 'Could not save this search.';
			return;
		}
		resetForm();
	}

	function remove() {
		try {
			updateSettings({ savedSearches: settings.savedSearches.filter((entry) => entry.id !== editingId) });
		} catch {
			error = 'Could not remove this search.';
			return;
		}
		resetForm();
	}
</script>

<dialog bind:this={dialog} aria-labelledby={titleId} onclose={onClose}>
	<div class="dialog-header">
		<h2 id={titleId}>Saved searches</h2>
		<button type="button" onclick={() => dialog.close()}>Done</button>
	</div>

	{#if settings.savedSearches.length}
		<ul>
			{#each settings.savedSearches as search (search.id)}
				<li>
					<button type="button" class="run-search" onclick={() => run(search)}>
						<span>{search.query}</span>
						<small>{modeLabels[search.mode]}</small>
					</button>
					<button type="button" aria-label={`Edit ${search.query} (${modeLabels[search.mode]})`} onclick={() => edit(search)}>Edit</button>
				</li>
			{/each}
		</ul>
	{/if}

	<form onsubmit={(event) => { event.preventDefault(); save(); }}>
		<label>
			Search terms
			<input bind:this={queryInput} bind:value={query} placeholder="e.g. oat milk" required />
		</label>
		<label>
			Match
			<select bind:value={mode}>
				<option value="phrase">Phrase (continuous text)</option>
				<option value="and">AND (all terms)</option>
				<option value="or">OR (any term)</option>
			</select>
		</label>
		{#if error}<p role="alert">{error}</p>{/if}
		<div class="form-actions">
			<button type="submit" class="save-search" disabled={!query.trim()}>{editingId ? 'Save changes' : 'Save search'}</button>
			{#if editingId}
				<button type="button" onclick={resetForm}>Cancel</button>
				<button type="button" onclick={remove}>Remove</button>
			{/if}
		</div>
	</form>
</dialog>

<style>
	dialog {
		box-sizing: border-box;
		width: min(26rem, calc(100% - 2rem));
		max-height: calc(100dvh - 2rem);
		padding: 1rem;
		border: 1px solid var(--border);
		border-radius: 16px;
		background: var(--bg);
		color: var(--text);
	}
	dialog::backdrop { background: rgb(0 0 0 / 50%); }
	.dialog-header, li, .form-actions { display: flex; align-items: center; gap: 0.5rem; }
	.dialog-header { justify-content: space-between; }
	h2 { margin: 0; font-size: 1.1rem; }
	ul { display: grid; gap: 0.4rem; padding: 0; margin: 0.75rem 0; }
	.run-search { flex: 1; min-width: 0; text-align: left; }
	.run-search span { display: block; overflow-wrap: anywhere; }
	small { color: var(--text2); }
	form { display: grid; gap: 0.65rem; margin-top: 0.75rem; }
	label { display: grid; gap: 0.3rem; font-size: 0.9rem; }
	button, input, select {
		box-sizing: border-box;
		min-height: 2.75rem;
		padding: 0.4rem 0.65rem;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--bg2);
		color: var(--text);
		font: inherit;
	}
	button { cursor: pointer; }
	button:disabled { opacity: 0.55; cursor: default; }
	.save-search { background: var(--accent); color: white; font-weight: 600; }
	.form-actions { flex-wrap: wrap; }
	p { margin: 0; }
</style>
