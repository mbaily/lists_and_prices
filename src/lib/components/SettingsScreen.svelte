<script lang="ts">
	import { settings, updateSettings } from '$lib/settings.svelte';

	let { onBack, onLogout }: { onBack: () => void; onLogout: () => void } = $props();

	const APP_VERSION = __APP_VERSION__;

	const currencies = [
		{ symbol: '$', label: 'USD $' },
		{ symbol: '€', label: 'EUR €' },
		{ symbol: '£', label: 'GBP £' },
		{ symbol: '¥', label: 'JPY ¥' },
		{ symbol: 'A$', label: 'AUD A$' },
		{ symbol: 'C$', label: 'CAD C$' },
		{ symbol: 'CHF', label: 'CHF' },
		{ symbol: 'kr', label: 'SEK kr' },
		{ symbol: 'R', label: 'ZAR R' }
	];
</script>

<div class="screen">
	<header>
		<button class="back-btn" onclick={onBack}>← Back</button>
		<span class="title">Settings</span>
	</header>

	<div class="content">
		<section>
			<h2>Currency</h2>
			<div class="currency-list">
				{#each currencies as c}
					<button
						class="currency-btn"
						class:active={settings.currency === c.symbol}
						onclick={() => updateSettings({ currency: c.symbol })}
					>
						{c.label}
					</button>
				{/each}
			</div>
		</section>

		<section>
			<h2>Theme</h2>
			<div class="toggle-row">
				<button
					class="theme-btn"
					class:active={settings.theme === 'light'}
					onclick={() => updateSettings({ theme: 'light' })}
				>☀ Light</button>
				<button
					class="theme-btn"
					class:active={settings.theme === 'dark'}
					onclick={() => updateSettings({ theme: 'dark' })}
				>🌙 Dark</button>
			</div>
		</section>

		<section>
			<h2>Account</h2>
			<button class="logout-btn" onclick={onLogout}>Sign out</button>
		</section>

		<footer>
			<span class="version">Version {APP_VERSION}</span>
		</footer>
	</div>
</div>

<style>
	.screen {
		min-height: 100dvh;
		background: var(--bg);
		display: flex;
		flex-direction: column;
	}
	header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem 1rem;
		background: var(--bg2);
		border-bottom: 1px solid var(--border);
	}
	.back-btn {
		background: none;
		border: none;
		color: var(--accent);
		font-size: 1rem;
		cursor: pointer;
		padding: 0;
	}
	.title { font-weight: 600; font-size: 1rem; }
	.content {
		padding: 1rem;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}
	section { display: flex; flex-direction: column; gap: 0.75rem; }
	h2 { margin: 0; font-size: 0.85rem; color: var(--text2); text-transform: uppercase; letter-spacing: 0.05em; }
	.currency-list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.currency-btn {
		padding: 0.45rem 0.8rem;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--bg2);
		color: var(--text);
		font-size: 0.9rem;
		cursor: pointer;
	}
	.currency-btn.active {
		background: var(--accent);
		color: #fff;
		border-color: var(--accent);
	}
	.toggle-row { display: flex; gap: 0.5rem; }
	.theme-btn {
		flex: 1;
		padding: 0.65rem;
		border: 1px solid var(--border);
		border-radius: 10px;
		background: var(--bg2);
		color: var(--text);
		font-size: 0.95rem;
		cursor: pointer;
	}
	.theme-btn.active {
		background: var(--accent);
		color: #fff;
		border-color: var(--accent);
	}
	.logout-btn {
		padding: 0.75rem;
		background: #ef4444;
		color: #fff;
		border: none;
		border-radius: 10px;
		font-size: 0.95rem;
		font-weight: 600;
		cursor: pointer;
	}
	footer { margin-top: auto; text-align: center; }
	.version { font-size: 0.8rem; color: var(--text2); }
</style>
