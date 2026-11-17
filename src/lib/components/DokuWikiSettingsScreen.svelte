<script lang="ts">
	import { onMount } from 'svelte';
	import { docState, commitState } from '$lib/yjsStore.svelte';
	import {
		readSettings, saveSettings, getTokenStatus, clearToken, testConnection, openTokenDialog, dokuwikiUi, type TokenStatus
	} from '$lib/dokuwikiClient.svelte';
	import {
		DATE_VARIABLES, DEFAULT_DOKUWIKI_SETTINGS, headingFor, localDateString, markerFor, normalizeBaseUrl, pageIdFor, pageUrl,
		renderEntry, type DokuWikiSettings
	} from '$lib/dokuwikiWriter';

	let { onBack }: { onBack: () => void } = $props();

	// Edited locally, saved to the synced document on change.
	let form = $state<DokuWikiSettings>(readSettings());
	let lastVersion = docState.version;
	$effect(() => {
		// Pick up settings changed on another device while this screen is open.
		if (docState.version !== lastVersion) {
			lastVersion = docState.version;
			const fresh = readSettings();
			for (const key of Object.keys(fresh) as (keyof DokuWikiSettings)[]) {
				if (document.activeElement?.id !== `dw-${key}`) form[key] = fresh[key];
			}
		}
	});

	const readOnly = $derived(commitState.isHistorical);
	const today = localDateString();
	const urlValid = $derived(!form.baseUrl.trim() || normalizeBaseUrl(form.baseUrl) !== null);
	const preview = $derived.by(() => {
		try {
			const pageId = pageIdFor(form, today);
			return {
				pageId,
				heading: headingFor(form, today),
				line: renderEntry(form.lineTemplate, { text: 'Buy milk', children: [{ text: 'full cream', children: [] }] }, markerFor('example')),
				href: pageUrl(form.baseUrl, pageId)
			};
		} catch { return null; }
	});

	function save(key: keyof DokuWikiSettings) {
		if (readOnly) return;
		if (key === 'baseUrl' && !urlValid) return;
		saveSettings({ [key]: form[key] });
	}

	function reset(key: Exclude<keyof DokuWikiSettings, 'baseUrl'>) {
		form[key] = DEFAULT_DOKUWIKI_SETTINGS[key];
		save(key);
	}

	let token = $state<TokenStatus | null>(null);
	let tokenError = $state('');
	async function refreshToken() {
		try { token = await getTokenStatus(); tokenError = ''; }
		catch (err) { token = null; tokenError = err instanceof Error ? err.message : 'Unavailable'; }
	}
	onMount(() => { void refreshToken(); });
	// Refresh after the token dialog closes.
	$effect(() => { if (!dokuwikiUi.tokenDialogOpen) void refreshToken(); });

	async function forget() {
		try { token = await clearToken(); } catch (err) { tokenError = err instanceof Error ? err.message : 'Failed'; }
	}

	let testing = $state(false);
	let testResult = $state<{ ok: boolean; message: string } | null>(null);
	async function runTest() {
		testing = true;
		testResult = null;
		try { testResult = await testConnection(); }
		catch (err) { testResult = { ok: false, message: err instanceof Error ? err.message : 'Test failed.' }; }
		finally { testing = false; }
	}
</script>

<div class="screen">
	<header>
		<button class="back-btn" onclick={onBack}>← Back</button>
		<span class="title">DokuWiki</span>
	</header>

	<div class="content">
		<p class="intro">
			Items marked with <b>Copy &amp; Link → 📝 DokuWiki</b> are written by the server into the day's section of a DokuWiki page,
			using the XML-RPC API. These settings sync to all your devices.
		</p>

		<section>
			<h2>Wiki</h2>
			<div class="field-group">
				<label class="field-label" for="dw-baseUrl">Wiki URL</label>
				<input id="dw-baseUrl" class="text-input" type="url" placeholder="https://wiki.example.com/" bind:value={form.baseUrl}
					onchange={() => save('baseUrl')} disabled={readOnly} autocomplete="off" spellcheck="false" />
				{#if !urlValid}<span class="error">Enter an http(s) URL.</span>{:else}<span class="hint">The wiki root; a doku.php link works too. XML-RPC: lib/exe/xmlrpc.php</span>{/if}
			</div>
		</section>

		<section>
			<h2>Templates</h2>
			<div class="field-group">
				<div class="label-row"><label class="field-label" for="dw-pageTemplate">Page id</label><button class="reset-btn" onclick={() => reset('pageTemplate')} disabled={readOnly}>Default</button></div>
				<input id="dw-pageTemplate" class="text-input mono" bind:value={form.pageTemplate} onchange={() => save('pageTemplate')} disabled={readOnly} spellcheck="false" />
			</div>
			<div class="field-group">
				<div class="label-row"><label class="field-label" for="dw-headingTemplate">Section heading</label><button class="reset-btn" onclick={() => reset('headingTemplate')} disabled={readOnly}>Default</button></div>
				<input id="dw-headingTemplate" class="text-input mono" bind:value={form.headingTemplate} onchange={() => save('headingTemplate')} disabled={readOnly} spellcheck="false" />
			</div>
			<div class="field-group">
				<div class="label-row"><label class="field-label" for="dw-lineTemplate">Item line</label><button class="reset-btn" onclick={() => reset('lineTemplate')} disabled={readOnly}>Default</button></div>
				<input id="dw-lineTemplate" class="text-input mono" bind:value={form.lineTemplate} onchange={() => save('lineTemplate')} disabled={readOnly} spellcheck="false" />
				<span class="hint"><code>{'{text}'}</code> is the item text, <code>{'{id}'}</code> its marker (added at the end if left out). Subnotes become nested bullets.</span>
			</div>
			<p class="hint">Date variables: {#each DATE_VARIABLES as v, i}<code>{`{${v}}`}</code>{i < DATE_VARIABLES.length - 1 ? ' ' : ''}{/each}</p>

			{#if preview}
				<div class="preview">
					<div class="preview-title">Preview for today ({today})</div>
					<div><span class="preview-label">Page</span> {#if preview.href}<a href={preview.href} target="_blank" rel="noopener noreferrer"><code>{preview.pageId}</code></a>{:else}<code>{preview.pageId}</code>{/if}</div>
					<div><span class="preview-label">Section</span> <code>{preview.heading}</code></div>
					<pre>{preview.line}</pre>
				</div>
			{/if}
		</section>

		<section>
			<h2>API token</h2>
			{#if tokenError}
				<p class="error">{tokenError}</p>
			{:else if token}
				<p class="status">{token.hasToken ? (token.remembered ? '🔑 Stored on the server (encrypted).' : '🔑 Held in server memory until it restarts.') : 'No token entered.'}</p>
			{/if}
			<div class="buttons">
				<button class="action-btn" onclick={() => openTokenDialog()} disabled={!!tokenError}>{token?.hasToken ? 'Replace token' : 'Enter token'}</button>
				{#if token?.hasToken}<button class="secondary-btn" onclick={forget}>Forget token</button>{/if}
			</div>
		</section>

		<section>
			<h2>Check</h2>
			<button class="secondary-btn" onclick={runTest} disabled={testing || !!tokenError}>{testing ? 'Checking…' : 'Test connection'}</button>
			{#if testResult}<p class={testResult.ok ? 'ok' : 'error'}>{testResult.ok ? '✅' : '⚠️'} {testResult.message}</p>{/if}
			<p class="hint">Reads today's page and looks for today's section. Nothing is written. Missing pages and sections are not created; marked items show ⚠️ until they exist.</p>
		</section>
	</div>
</div>

<style>
	.screen { height: 100dvh; background: var(--bg); color: var(--text); display: flex; flex-direction: column; overflow: hidden; }
	header { display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem 1rem; background: var(--bg2); border-bottom: 1px solid var(--border); }
	.back-btn { background: none; border: none; color: var(--accent); font-size: 1rem; cursor: pointer; padding: 0; }
	.title { font-weight: 600; font-size: 1rem; }
	.content { flex: 1; overflow-y: auto; padding: 1rem; max-width: 720px; width: 100%; box-sizing: border-box; margin: 0 auto; }
	.intro { margin: 0 0 1.5rem; font-size: 0.9rem; color: var(--text2); }
	section { margin-bottom: 2rem; display: flex; flex-direction: column; gap: 0.85rem; }
	h2 { font-size: 0.95rem; text-transform: uppercase; color: var(--text2); margin: 0; }
	.field-group { display: flex; flex-direction: column; gap: 0.35rem; }
	.label-row { display: flex; justify-content: space-between; align-items: center; }
	.field-label { font-size: 0.85rem; color: var(--text2); }
	.text-input { width: 100%; padding: 0.6rem 0.8rem; border: 1px solid var(--border); border-radius: 8px; background: var(--bg2); color: var(--text); font-size: 0.95rem; box-sizing: border-box; outline: none; }
	.text-input:focus { border-color: var(--accent); }
	.mono, code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
	code { font-size: 0.85em; background: var(--bg2); padding: 0 0.25em; border-radius: 4px; }
	.hint { font-size: 0.8rem; color: var(--text2); margin: 0; overflow-wrap: anywhere; }
	.error { color: #dc2626; font-size: 0.85rem; margin: 0; }
	.ok { color: #16a34a; font-size: 0.85rem; margin: 0; }
	.status { margin: 0; font-size: 0.9rem; }
	.reset-btn { background: none; border: 1px solid var(--border); color: var(--text2); font-size: 0.75rem; padding: 0.15rem 0.5rem; border-radius: 4px; cursor: pointer; }
	.preview { background: var(--bg2); border: 1px solid var(--border); border-radius: 8px; padding: 0.75rem; display: flex; flex-direction: column; gap: 0.35rem; font-size: 0.85rem; overflow-wrap: anywhere; }
	.preview-title { font-weight: 600; color: var(--text2); }
	.preview-label { display: inline-block; min-width: 4.5rem; color: var(--text2); }
	.preview a { color: var(--accent); }
	pre { margin: 0.25rem 0 0; white-space: pre-wrap; font-size: 0.85rem; }
	.buttons { display: flex; gap: 0.5rem; flex-wrap: wrap; }
	.action-btn { padding: 0.7rem 1rem; background: var(--accent); color: #fff; border: none; border-radius: 10px; font-size: 0.95rem; font-weight: 600; cursor: pointer; }
	.secondary-btn { padding: 0.7rem 1rem; background: var(--bg2); color: var(--text); border: 1px solid var(--border); border-radius: 10px; font-size: 0.95rem; cursor: pointer; align-self: flex-start; }
	button:disabled { opacity: 0.5; cursor: default; }
</style>
