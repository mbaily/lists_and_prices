<script lang="ts">
	import { settings, updateSettings, DEFAULT_KEYBINDINGS } from '$lib/settings.svelte';

	let { onBack }: { onBack: () => void } = $props();

	const ACTIONS = [
		{ id: 'upOneLevel', label: 'Up one level' },
		{ id: 'up', label: 'Up' },
		{ id: 'down', label: 'Down' },
		{ id: 'open', label: 'Open' },
		// Add more actions here later
	];

	let listeningActionId = $state<string | null>(null);

	function startListening(actionId: string) {
		listeningActionId = actionId;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (listeningActionId) {
			e.preventDefault();
			e.stopPropagation();

			// Modifier keys should not trigger a bind by themselves
			if (['Control', 'Meta', 'Alt', 'Shift', 'CapsLock'].includes(e.key)) return;

			let modifiers = [];
			if (e.ctrlKey) modifiers.push('Ctrl');
			if (e.metaKey) modifiers.push('Meta');
			if (e.altKey) modifiers.push('Alt');
			if (e.shiftKey) modifiers.push('Shift');

			let keyName = e.key;
			// Normalize some common key names
			if (keyName === ' ') keyName = 'Space';
			else if (keyName === 'Escape') keyName = 'Esc';
			else if (keyName === 'ArrowUp') keyName = 'Up';
			else if (keyName === 'ArrowDown') keyName = 'Down';
			else if (keyName === 'ArrowLeft') keyName = 'Left';
			else if (keyName === 'ArrowRight') keyName = 'Right';

			const combo = [...modifiers, keyName].join('+');

			updateSettings({
				keybindings: {
					...settings.keybindings,
					[listeningActionId]: combo
				}
			});
			listeningActionId = null;
		}
	}

	function resetToDefault() {
		updateSettings({ keybindings: { ...DEFAULT_KEYBINDINGS } });
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="screen">
	<header>
		<button class="back-btn" onclick={onBack}>← Back</button>
		<span class="title">Keyboard Shortcuts</span>
	</header>

	<div class="content">
		<section>
			<div class="header-row">
				<h2>Key Bindings</h2>
				<button class="reset-btn" onclick={resetToDefault}>Reset to Default</button>
			</div>

			<div class="bindings-list">
				{#each ACTIONS as action}
					<div class="binding-row">
						<span class="binding-label">{action.label}</span>
						<button 
							class="binding-btn" 
							class:listening={listeningActionId === action.id}
							onclick={() => startListening(action.id)}
						>
							{listeningActionId === action.id ? 'Press any key...' : settings.keybindings[action.id] || 'Not bound'}
						</button>
					</div>
				{/each}
			</div>
		</section>
	</div>
</div>

<style>
	.screen {
		height: 100dvh;
		background: var(--bg);
		display: flex;
		flex-direction: column;
		overflow: hidden;
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
		flex: 1;
		overflow-y: auto;
		padding: 1rem;
	}
	section {
		margin-bottom: 2rem;
	}
	.header-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1rem;
	}
	h2 {
		font-size: 0.95rem;
		text-transform: uppercase;
		color: var(--text2);
		margin: 0;
	}
	.reset-btn {
		background: none;
		border: 1px solid var(--border);
		color: var(--text2);
		font-size: 0.8rem;
		padding: 0.25rem 0.5rem;
		border-radius: 4px;
		cursor: pointer;
	}
	.bindings-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.binding-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.75rem;
		background: var(--bg2);
		border: 1px solid var(--border);
		border-radius: 8px;
	}
	.binding-label {
		font-size: 1rem;
		color: var(--text);
	}
	.binding-btn {
		background: var(--bg);
		border: 1px solid var(--border);
		color: var(--text);
		padding: 0.5rem 1rem;
		border-radius: 6px;
		font-family: monospace;
		font-size: 0.95rem;
		cursor: pointer;
		min-width: 140px;
		text-align: center;
		transition: all 0.2s;
	}
	.binding-btn.listening {
		background: var(--accent);
		color: white;
		border-color: var(--accent);
		animation: pulse 1.5s infinite;
	}
	@keyframes pulse {
		0% { opacity: 1; }
		50% { opacity: 0.7; }
		100% { opacity: 1; }
	}
</style>
