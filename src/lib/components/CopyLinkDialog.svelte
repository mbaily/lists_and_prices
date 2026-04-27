<script lang="ts">
	import { onMount } from 'svelte';

	let {
		links,
		onClose
	}: {
		links: string[];
		onClose: () => void;
	} = $props();

	let copiedUrl = $state<string | null>(null);
	let copyTimer: ReturnType<typeof setTimeout> | null = null;

	async function copyLink(url: string) {
		try {
			await navigator.clipboard.writeText(url);
		} catch {
			// Fallback for environments where clipboard API is unavailable
			const ta = document.createElement('textarea');
			ta.value = url;
			ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
			document.body.appendChild(ta);
			ta.select();
			try { document.execCommand('copy'); } catch { /* ignore */ }
			document.body.removeChild(ta);
		}
		copiedUrl = url;
		if (copyTimer) clearTimeout(copyTimer);
		copyTimer = setTimeout(() => { copiedUrl = null; }, 1500);
	}

	onMount(() => {
		function handleKey(e: KeyboardEvent) {
			if (e.key === 'Escape') onClose();
		}
		document.addEventListener('keydown', handleKey);
		return () => {
			document.removeEventListener('keydown', handleKey);
			if (copyTimer) clearTimeout(copyTimer);
		};
	});
</script>

<div
	class="backdrop"
	role="dialog"
	aria-modal="true"
	aria-label="Copy a link"
	onclick={(e) => { if (e.target === e.currentTarget) onClose(); }}
>
	<div class="dialog">
		<div class="dialog-title">Copy a link</div>
		<ul class="link-list" role="list">
			{#each links as url}
				<li>
					<button
						class="link-btn"
						class:copied={copiedUrl === url}
						title={url}
						onclick={() => copyLink(url)}
					>
						<span class="link-text">{url}</span>
						<span class="copy-badge">{copiedUrl === url ? '✓ Copied' : 'Copy'}</span>
					</button>
				</li>
			{/each}
		</ul>
		<button class="close-btn" onclick={onClose}>Close</button>
	</div>
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 100;
		padding: 1rem;
	}

	.dialog {
		background: var(--bg);
		border-radius: 16px;
		padding: 1.25rem 1.25rem 1rem;
		width: 100%;
		max-width: 420px;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		/* Prevent dialog itself from growing taller than the viewport */
		max-height: calc(100dvh - 2rem);
	}

	.dialog-title {
		font-weight: 700;
		font-size: 1rem;
		color: var(--text);
		flex-shrink: 0;
	}

	.link-list {
		list-style: none;
		margin: 0;
		padding: 0;
		overflow-y: auto;
		/* Scrollable area: takes available space up to ~60 % of viewport */
		max-height: min(60vh, 320px);
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.link-btn {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.65rem 0.75rem;
		background: var(--bg2);
		border: 1px solid var(--border);
		border-radius: 10px;
		cursor: pointer;
		text-align: left;
		transition: background 0.15s, border-color 0.15s;
	}

	.link-btn:hover,
	.link-btn:focus-visible {
		background: var(--bg3);
		border-color: var(--accent);
		outline: none;
	}

	.link-btn.copied {
		border-color: #22c55e;
		background: color-mix(in srgb, #22c55e 12%, var(--bg2));
	}

	.link-text {
		flex: 1;
		min-width: 0;
		font-size: 0.875rem;
		color: var(--accent);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		word-break: break-all;
	}

	.copy-badge {
		flex-shrink: 0;
		font-size: 0.78rem;
		font-weight: 600;
		padding: 0.2rem 0.55rem;
		border-radius: 999px;
		background: var(--bg3);
		color: var(--text2);
		transition: background 0.15s, color 0.15s;
		white-space: nowrap;
	}

	.link-btn.copied .copy-badge {
		background: #22c55e;
		color: #fff;
	}

	.close-btn {
		flex-shrink: 0;
		width: 100%;
		padding: 0.7rem;
		border: none;
		border-radius: 10px;
		background: var(--bg3);
		color: var(--text);
		font-size: 0.95rem;
		font-weight: 600;
		cursor: pointer;
	}

	.close-btn:hover,
	.close-btn:focus-visible {
		background: var(--bg3);
		filter: brightness(0.92);
		outline: none;
	}
</style>
