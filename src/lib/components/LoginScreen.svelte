<script lang="ts">
	import { login } from '$lib/auth.svelte';

	let { onLogin }: { onLogin: (username: string) => void } = $props();

	let username = $state('');
	let password = $state('');
	let error = $state('');
	let busy = $state(false);

	async function handleSubmit(e: Event) {
		e.preventDefault();
		if (!username.trim() || !password) return;
		busy = true;
		error = '';
		const result = await login(username.trim(), password);
		busy = false;
		if (result.ok) {
			onLogin(username.trim());
		} else {
			error = result.error ?? 'Login failed';
		}
	}
</script>

<div class="screen">
	<div class="card">
		<h1>Lists &amp; Prices</h1>
		<form onsubmit={handleSubmit}>
			<label>
				Username
				<input
					type="text"
					autocomplete="username"
					autocapitalize="none"
					bind:value={username}
					disabled={busy}
				/>
			</label>
			<label>
				Password
				<input
					type="password"
					autocomplete="current-password"
					bind:value={password}
					disabled={busy}
				/>
			</label>
			{#if error}
				<p class="error">{error}</p>
			{/if}
			<button type="submit" disabled={busy || !username.trim() || !password}>
				{busy ? 'Signing in…' : 'Sign in'}
			</button>
		</form>
	</div>
</div>

<style>
	.screen {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 100dvh;
		background: var(--bg);
		padding: 1rem;
	}
	.card {
		width: 100%;
		max-width: 340px;
	}
	h1 {
		font-size: 1.5rem;
		margin: 0 0 1.5rem;
		text-align: center;
		color: var(--accent);
	}
	form {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		font-size: 0.85rem;
		color: var(--text2);
	}
	input {
		padding: 0.75rem 1rem;
		border: 1px solid var(--border);
		border-radius: 10px;
		font-size: 1rem;
		background: var(--bg2);
		color: var(--text);
		outline: none;
	}
	input:focus {
		border-color: var(--accent);
	}
	button {
		padding: 0.8rem;
		border: none;
		border-radius: 10px;
		background: var(--accent);
		color: #fff;
		font-size: 1rem;
		font-weight: 600;
		cursor: pointer;
	}
	button:disabled {
		opacity: 0.5;
	}
	.error {
		color: #ef4444;
		font-size: 0.85rem;
		margin: 0;
	}
</style>
