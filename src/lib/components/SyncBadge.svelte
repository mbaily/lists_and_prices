<script lang="ts">
	import type { SyncStatus } from '$lib/yjsStore.svelte';
	let { status }: { status: SyncStatus } = $props();

	const label: Record<SyncStatus, string> = {
		offline: 'Offline',
		connecting: 'Connecting…',
		synced: 'Synced'
	};
	const color: Record<SyncStatus, string> = {
		offline: '#ef4444',
		connecting: '#f97316',
		synced: '#22c55e'
	};
</script>

<span class="badge" style="--dot:{color[status]}">
	<span class="dot"></span>
	{label[status]}
</span>

<style>
	.badge {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 0.75rem;
		color: var(--text2);
	}
	.dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--dot);
	}
</style>
