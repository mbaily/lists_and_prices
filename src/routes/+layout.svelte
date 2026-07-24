<script lang="ts">
	import { onMount } from 'svelte';
	import { applyTheme, applyItemSpacing } from '$lib/settings.svelte';
	import '../app.css';

	let { children } = $props();

	onMount(() => {
		applyTheme();
		applyItemSpacing();
	});
</script>

<svelte:head>
	<meta name="apple-mobile-web-app-capable" content="yes" />
	<meta name="apple-mobile-web-app-status-bar-style" content="default" />
	<meta name="apple-mobile-web-app-title" content="Lists" />
	<!-- iOS home-screen icon — must be a PNG, SVG is not supported by iOS Safari -->
	<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
	<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
	<title>Lists &amp; Prices</title>
</svelte:head>

{@render children()}


