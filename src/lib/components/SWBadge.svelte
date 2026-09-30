<script lang="ts">
	import { onMount } from 'svelte';

	type SWStatus = 'unsupported' | 'unregistered' | 'installing' | 'active';
	let swStatus = $state<SWStatus>('unsupported');

	onMount(() => {
		if (!('serviceWorker' in navigator)) {
			swStatus = 'unsupported';
			return;
		}

		swStatus = 'unregistered';
		let disposed = false;

		const check = async () => {
			const reg = await navigator.serviceWorker.getRegistration();
			if (disposed) return;
			if (reg?.active || navigator.serviceWorker.controller) {
				swStatus = 'active';
			} else {
				swStatus = reg?.installing || reg?.waiting ? 'installing' : 'unregistered';
			}
		};

		check();
		const interval = setInterval(check, 1000);

		navigator.serviceWorker.ready.then(() => {
			if (disposed) return;
			swStatus = 'active';
			clearInterval(interval);
		});

		const onControllerChange = () => { void check(); };
		navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

		return () => {
			disposed = true;
			clearInterval(interval);
			navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
		};
	});

	const color: Record<SWStatus, string> = {
		unsupported: '#ef4444',
		unregistered: '#ef4444',
		installing: '#f97316',
		active: '#22c55e'
	};
</script>

<span class="badge" style="--dot:{color[swStatus]}" title="Service Worker: {swStatus}">
	<span class="dot"></span>
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
		width: 8px;
		height: 8px;
		border-radius: 2px;
		background: var(--dot);
	}
</style>
