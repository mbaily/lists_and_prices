<script lang="ts">
	import { onMount } from 'svelte';
	import { dokuwikiUi, saveToken } from '$lib/dokuwikiClient.svelte';

	let token = $state('');
	let remember = $state(true);
	let busy = $state(false);
	let error = $state('');
	let backdropEl: HTMLDivElement | null = null;
	let inputEl: HTMLInputElement | null = $state(null);

	function close() {
		dokuwikiUi.tokenDialogOpen = false;
		token = '';
		error = '';
	}

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		if (!token.trim() || busy) return;
		busy = true;
		error = '';
		try {
			await saveToken(token.trim(), remember);
			close();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Could not save the token.';
		} finally {
			busy = false;
		}
	}

	onMount(() => {
		inputEl?.focus();
		function handleKey(e: KeyboardEvent) {
			if (e.key !== 'Escape') return;
			const backdrops = document.querySelectorAll('.backdrop');
			if (backdrops[backdrops.length - 1] === backdropEl) close();
		}
		document.addEventListener('keydown', handleKey);
		return () => document.removeEventListener('keydown', handleKey);
	});
</script>

<div
	bind:this={backdropEl}
	class="backdrop"
	role="dialog"
	aria-modal="true"
	aria-label="DokuWiki API token"
	onclick={(e) => { if (e.target === e.currentTarget) close(); }}
>
	<form class="dialog" onsubmit={submit}>
		<div class="dialog-title">🔑 DokuWiki API token</div>
		{#if dokuwikiUi.tokenReason}<p class="reason">{dokuwikiUi.tokenReason}</p>{/if}
		<p class="hint">Create a token on your DokuWiki profile page (DokuWiki 2024-02 or newer). It is sent to this app's server, never stored in the browser.</p>
		<input bind:this={inputEl} type="password" autocomplete="off" spellcheck="false" placeholder="API token" bind:value={token} disabled={busy} />
		<label class="remember"><input type="checkbox" bind:checked={remember} disabled={busy} /> Remember on the server (encrypted)</label>
		{#if error}<p class="error" role="alert">{error}</p>{/if}
		<div class="buttons">
			<button type="button" class="secondary" onclick={close} disabled={busy}>Cancel</button>
			<button type="submit" class="primary" disabled={busy || !token.trim()}>{busy ? 'Saving…' : 'Save'}</button>
		</div>
	</form>
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 200;
		padding: 1rem;
	}
	.dialog {
		background: var(--bg);
		color: var(--text);
		border-radius: 16px;
		padding: 1.25rem;
		width: 100%;
		max-width: 420px;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.dialog-title { font-weight: 700; font-size: 1rem; }
	.reason { margin: 0; font-size: 0.9rem; }
	.hint { margin: 0; font-size: 0.8rem; color: var(--text2); }
	input[type='password'] {
		padding: 0.6rem 0.75rem;
		border: 1px solid var(--border);
		border-radius: 10px;
		background: var(--bg2);
		color: var(--text);
		font-size: 1rem;
	}
	.remember { display: flex; gap: 0.5rem; align-items: center; font-size: 0.9rem; }
	.error { margin: 0; color: #dc2626; font-size: 0.85rem; }
	.buttons { display: flex; justify-content: flex-end; gap: 0.5rem; }
	.buttons button { padding: 0.55rem 1rem; border-radius: 10px; border: 1px solid var(--border); cursor: pointer; font-size: 0.95rem; }
	.secondary { background: var(--bg2); color: var(--text); }
	.primary { background: var(--accent); color: white; border-color: var(--accent); }
	.primary:disabled { opacity: 0.5; cursor: default; }
</style>
