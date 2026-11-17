<script lang="ts">
	import { onMount, tick } from 'svelte';
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
	type ListView = 'quick' | 'manage';
	let dialog: HTMLDialogElement;
	let list = $state<HTMLUListElement>();
	let listAction = $state<HTMLButtonElement>();
	let nameInput = $state<HTMLInputElement>();
	let view = $state<ListView | 'editor'>('quick');
	let editorReturnView: ListView = 'manage';
	let name = $state('');
	let query = $state('');
	let mode = $state<SearchMode>('phrase');
	let editingId = $state<string | null>(null);
	let error = $state('');

	onMount(() => {
		dialog.showModal();
		void focusList();
	});

	function run(search: SavedSearch) {
		dialog.close();
		onRun(search);
	}

	async function focusList() {
		await tick();
		(list?.querySelector('button') ?? listAction)?.focus();
	}

	function showList(nextView: ListView) {
		view = nextView;
		void focusList();
	}

	async function openEditor(search?: SavedSearch) {
		if (view === 'editor') return;
		editorReturnView = view;
		editingId = search?.id ?? null;
		name = search?.name ?? '';
		query = search?.query ?? initialQuery;
		mode = search?.mode ?? initialMode;
		error = '';
		view = 'editor';
		await tick();
		nameInput?.focus();
	}

	function goBack() {
		if (view === 'quick') dialog.close();
		else showList(view === 'editor' ? editorReturnView : 'quick');
	}

	function save() {
		const searchName = name.trim();
		const searchQuery = query.trim();
		if (!searchName || !searchQuery) return;
		try {
			const search = { id: editingId ?? crypto.randomUUID(), name: searchName, query: searchQuery, mode };
			const savedSearches = editingId
				? settings.savedSearches.map((entry) => entry.id === search.id ? search : entry)
				: [...settings.savedSearches, search];
			updateSettings({ savedSearches });
		} catch {
			error = 'Could not save this search.';
			return;
		}
		showList(editorReturnView);
	}

	function remove() {
		try {
			updateSettings({ savedSearches: settings.savedSearches.filter((entry) => entry.id !== editingId) });
		} catch {
			error = 'Could not remove this search.';
			return;
		}
		showList(editorReturnView);
	}
</script>

<dialog bind:this={dialog} aria-labelledby={titleId} onclose={onClose}
	oncancel={(event) => { if (view !== 'quick') { event.preventDefault(); goBack(); } }}>
	<div class="dialog-header">
		<h2 id={titleId}>
			{#if view === 'editor'}{editingId ? 'Edit saved search' : 'New saved search'}
			{:else}{view === 'manage' ? 'Manage saved searches' : 'Saved searches'}{/if}
		</h2>
		<button type="button" onclick={goBack}>{view === 'quick' ? 'Done' : 'Back'}</button>
	</div>

	{#if view === 'editor'}
		<form onsubmit={(event) => { event.preventDefault(); save(); }}>
			<label>
				Name
				<input bind:this={nameInput} bind:value={name} required />
			</label>
			<label>
				Search terms
				<input bind:value={query} required />
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
				<button type="submit" class="save-search" disabled={!name.trim() || !query.trim()}>{editingId ? 'Save changes' : 'Save search'}</button>
				{#if editingId}<button type="button" onclick={remove}>Remove</button>{/if}
			</div>
		</form>
	{:else}
		{#if settings.savedSearches.length}
			<ul bind:this={list}>
				{#each settings.savedSearches as search (search.id)}
					<li>
						<button type="button" class="search-entry" onclick={() => view === 'manage' ? openEditor(search) : run(search)}>
							<span>{search.name}</span>
							{#if view === 'manage'}<small>{search.query} · {modeLabels[search.mode]}</small>{/if}
						</button>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="empty">No saved searches yet.</p>
		{/if}
		{#if view === 'quick' && settings.savedSearches.length}
			<button bind:this={listAction} type="button" onclick={() => showList('manage')}>Manage</button>
		{:else}
			<button bind:this={listAction} type="button" onclick={() => openEditor()}>New search</button>
		{/if}
	{/if}
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
	.dialog-header, .form-actions { display: flex; align-items: center; gap: 0.5rem; }
	.dialog-header { justify-content: space-between; }
	h2 { margin: 0; font-size: 1.1rem; }
	ul { list-style: none; padding: 2px; margin: 0.75rem 0; max-height: 50dvh; overflow-y: auto; }
	li + li { margin-top: 0.4rem; }
	.search-entry { width: 100%; text-align: left; overflow-wrap: anywhere; }
	.search-entry small { display: block; color: var(--text2); }
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
	.empty { margin: 0.75rem 0; color: var(--text2); }
</style>
