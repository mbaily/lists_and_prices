<script lang="ts">
	import { onMount } from 'svelte';

	type SWStatus = 'unsupported' | 'installing' | 'active';
	let swStatus = $state<SWStatus>('unsupported');

	onMount(() => {
		if (!('serviceWorker' in navigator)) {
			swStatus = 'unsupported';
			return;
		}

		if (navigator.serviceWorker.controller) {
			swStatus = 'active';
		} else {
			swStatus = 'installing';
		}

		navigator.serviceWorker.addEventListener('controllerchange', () => {
			swStatus = 'active';
		});
	});

	const label: Record<SWStatus, string> = {
		unsupported: 'No SW',
		installing: 'SW Wait',
		active: 'SW Ready'
	};
	
	const color: Record<SWStatus, string> = {
		unsupported: '#ef4444',
		installing: '#f97316',
		active: '#22c55e'
	};
</script>

<span class="badge" style="--dot:{color[swStatus]}">
	<span class="dot"></span>
	{label[swStatus]}
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
