<script lang="ts">
	import { auth, login } from '$lib/auth.svelte';
	import { storageState, checkBrowserStorage } from '$lib/browserStorage.svelte';
	import { syncState, localSaveState, idbSynced, setAutomaticSync, syncNow, reconnectYjs, saveLocalData } from '$lib/yjsStore.svelte';

	let password = $state('');
	let signingIn = $state(false);
	let loginError = $state<string | null>(null);
	const savedLabels = { loading: 'Loading local data…', saving: 'Saving on this device…', saved: 'Saved on this device', error: 'Could not save on this device' };
	const protectionLabels = { unknown: 'Checking…', persistent: 'Protected against automatic cleanup', 'best-effort': 'Browser may clear data when storage is low', unsupported: 'Storage protection unavailable in this browser' };

	async function signIn(event: SubmitEvent) {
		event.preventDefault();
		if (!auth.username || signingIn) return;
		signingIn = true;
		loginError = null;
		try {
			const result = await login(auth.username, password);
			if (!result.ok) { loginError = result.error ?? 'Sign-in failed'; return; }
			password = '';
			reconnectYjs();
			await syncNow();
		} finally { signingIn = false; }
	}
</script>

<div class="offline-settings">
	<h2>Offline &amp; sync</h2>
	<div role="status" aria-live="polite">
		<p class:error={localSaveState.status === 'error'}>{savedLabels[localSaveState.status]}</p>
		<p>Offline app launch: {storageState.offlineLaunch ? 'Ready' : 'Open the app online to finish preparing'}</p>
		<p>Storage: {protectionLabels[storageState.persistence]}</p>
		<p>Last completed server sync: {syncState.lastSyncAt ? new Date(syncState.lastSyncAt).toLocaleString() : 'Not yet confirmed'}</p>
		<p>{syncState.pending ? 'Changes waiting for server confirmation.' : 'All changes confirmed by the server at the last sync.'}</p>
	</div>
	<label class="toggle">
		<input type="checkbox" checked={syncState.automatic} onchange={event => setAutomaticSync(event.currentTarget.checked)} />
		Sync automatically on this device
	</label>
	<p class="hint">{syncState.automatic ? 'Changes sync while the app is open and online.' : 'Automatic sync is off. Use Sync now before leaving and when you return. Offline edits keep saving on this device.'}</p>
	<div class="actions">
		<button disabled={!idbSynced.done || syncState.syncing || auth.needsLogin} onclick={() => syncNow()}>{syncState.syncing ? 'Syncing…' : 'Sync now'}</button>
		<button disabled={storageState.checking} onclick={() => checkBrowserStorage(true)}>{storageState.checking ? 'Checking storage…' : 'Protect offline storage'}</button>
		{#if localSaveState.status === 'error' && idbSynced.done}<button onclick={saveLocalData}>Retry saving</button>{/if}
	</div>
	{#if storageState.usage !== null}<p class="hint">App storage used: {(storageState.usage / 1048576).toFixed(1)} MB{storageState.quota !== null ? ` of approximately ${(storageState.quota / 1048576).toFixed(0)} MB available to the app` : ''}.</p>{/if}
	{#if localSaveState.error}<p class="error" role="alert">{localSaveState.error}</p>{/if}
	{#if storageState.error}<p class="error" role="alert">{storageState.error}</p>{/if}
	{#if syncState.error}<p class="error" role="alert">{syncState.error}</p>{/if}
	{#if auth.needsLogin}
		<form onsubmit={signIn}>
			<p>Sign in again as <strong>{auth.username}</strong> to sync. Your local data and offline edits are kept.</p>
			<label>Password <input type="password" autocomplete="current-password" bind:value={password} disabled={signingIn} required /></label>
			<button type="submit" disabled={signingIn || !password}>{signingIn ? 'Signing in…' : 'Sign in and sync'}</button>
			{#if loginError}<p class="error" role="alert">{loginError}</p>{/if}
		</form>
	{/if}
	<p class="hint">Keep this Home Screen app installed and use the same address. Removing it or clearing its website data can remove offline edits.</p>
</div>

<style>
	h2 { font-size: 1rem; margin: 0 0 0.8rem; }
	p { font-size: 0.85rem; margin: 0.5rem 0; }
	.hint { color: var(--text2); line-height: 1.5; font-size: 0.8rem; }
	.toggle { display: flex; align-items: center; gap: 0.6rem; margin-top: 1rem; }
	.actions { display: flex; flex-wrap: wrap; gap: 0.6rem; margin: 0.8rem 0; }
	button { padding: 0.65rem 0.85rem; border: 1px solid var(--border); border-radius: 8px; background: var(--bg2); color: var(--text); cursor: pointer; }
	button:disabled { opacity: 0.5; cursor: default; }
	form { border-top: 1px solid var(--border); padding-top: 0.6rem; }
	form label { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; margin: 0.8rem 0; }
	input[type='password'] { min-width: 0; padding: 0.65rem; background: var(--bg2); color: var(--text); border: 1px solid var(--border); border-radius: 8px; }
	.error { color: #ef4444; }
</style>
