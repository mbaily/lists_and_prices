<script lang="ts">
	import { commitState, createCommit, readCommits, viewCommit, docState } from '$lib/yjsStore.svelte';

	let { onBack }: { onBack: () => void } = $props();

	let newCommitName = $state(
		new Date().toLocaleString(undefined, {
			day: 'numeric', month: 'short', year: 'numeric',
			hour: '2-digit', minute: '2-digit', second: '2-digit'
		})
	);

	let commitsList = $derived.by(() => {
		void docState.version;
		return readCommits();
	});

	function handleCommit() {
		if (newCommitName.trim()) {
			createCommit(newCommitName.trim());
			newCommitName = new Date().toLocaleString(undefined, {
				day: 'numeric', month: 'short', year: 'numeric',
				hour: '2-digit', minute: '2-digit', second: '2-digit'
			});
		}
	}

	function fmtDate(iso: string): string {
		return new Date(iso).toLocaleString(undefined, {
			day: 'numeric', month: 'short', year: 'numeric',
			hour: '2-digit', minute: '2-digit'
		});
	}
</script>

<div class="screen">
	<header>
		<button class="back-btn" onclick={onBack}>← Back</button>
		<span class="title">Version History</span>
	</header>

	<div class="content">
		{#if !commitState.isHistorical}
			<section>
				<h2>New Commit</h2>
				<div class="commits-new">
					<input placeholder="Commit name..." bind:value={newCommitName} onkeydown={(e) => { if (e.key === 'Enter') handleCommit(); }} />
					<button onclick={handleCommit}>Commit</button>
				</div>
			</section>
		{/if}

		<section>
			<h2>Past Commits</h2>
			<div class="commits-list">
				{#each commitsList as commit}
					<div class="commit-row">
						<div class="commit-info">
							<div class="commit-name">{commit.name}</div>
							<div class="commit-date">{fmtDate(commit.createdAt)}</div>
						</div>
						<button class="commit-view-btn" onclick={() => { viewCommit(commit.id); onBack(); }}>View</button>
					</div>
				{:else}
					<div class="commits-empty">No commits yet.</div>
				{/each}
			</div>
		</section>
	</div>
</div>

<style>
	.screen {
		display: flex;
		flex-direction: column;
		position: fixed;
		inset: 0;
		background: var(--bg);
		z-index: 100;
	}
	header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		background: var(--bg2);
		border-bottom: 1px solid var(--border);
		flex-shrink: 0;
	}
	.back-btn {
		background: none;
		border: none;
		font-size: 1rem;
		color: var(--accent);
		cursor: pointer;
		padding: 0.25rem 0.5rem;
		margin-left: -0.5rem;
	}
	.title {
		font-weight: 600;
		font-size: 1rem;
	}
	.content {
		flex: 1;
		padding: 1.5rem;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 2rem;
	}
	section {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	h2 {
		font-size: 1rem;
		margin: 0;
		color: var(--text2);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.commits-new {
		display: flex;
		gap: 0.5rem;
	}
	.commits-new input {
		flex: 1;
		padding: 0.75rem;
		border: 1px solid var(--border);
		border-radius: 10px;
		background: var(--bg2);
		color: var(--text);
		font-size: 1rem;
	}
	.commits-new button {
		background: var(--accent);
		color: #fff;
		border: none;
		border-radius: 10px;
		padding: 0 1.5rem;
		font-weight: 600;
		font-size: 1rem;
		cursor: pointer;
	}
	.commits-list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.commit-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 1rem;
		background: var(--bg2);
		border-radius: 12px;
		border: 1px solid var(--border);
	}
	.commit-info {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.commit-name {
		font-weight: 600;
		font-size: 1.05rem;
		color: var(--text);
	}
	.commit-date {
		font-size: 0.85rem;
		color: var(--text2);
	}
	.commit-view-btn {
		background: var(--accent);
		color: #fff;
		border: none;
		border-radius: 8px;
		padding: 0.5rem 1rem;
		cursor: pointer;
		font-size: 0.95rem;
		font-weight: 600;
	}
	.commits-empty {
		padding: 2rem;
		text-align: center;
		color: var(--text2);
		font-style: italic;
		background: var(--bg2);
		border-radius: 12px;
		border: 1px dashed var(--border);
	}
</style>
