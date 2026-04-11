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
	<meta name="apple-mobile-web-app-status-bar-style" content="default" />	<link rel="icon" href="/favicon.svg" type="image/svg+xml" />	<title>Lists & Prices</title>
</svelte:head>

{@render children()}


