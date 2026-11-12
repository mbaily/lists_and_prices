<script lang="ts">
	import { splitHashtags } from '$lib/tags';
	let { text, href, onTagClick, completed = false }: {
		text: string; href?: string; onTagClick?: (tag: string) => void; completed?: boolean;
	} = $props();
</script>

<span class:completed>{#each splitHashtags(text) as part}{#if part.type === 'tag'}{#if onTagClick}<button type="button" class="tag-pill" onpointerdown={event => event.stopPropagation()} onclick={event => { event.stopPropagation(); onTagClick?.(part.value.slice(1)); }}>{part.value}</button>{:else}<span class="tag-pill">{part.value}</span>{/if}{:else if href}<a {href} target="_blank" rel="noopener noreferrer" onpointerdown={event => event.stopPropagation()} onclick={event => event.stopPropagation()}>{part.value}</a>{:else}{part.value}{/if}{/each}</span>

<style>
	a { color: inherit; text-decoration: none; }
	.completed { text-decoration: line-through; }
	.tag-pill { display: inline-block; background: color-mix(in srgb, var(--list-color, var(--accent)) 18%, transparent); color: var(--list-color, var(--accent)); border-radius: 999px; padding: 0 .45em; font: inherit; font-size: .82em; font-weight: 600; border: 0; white-space: nowrap; }
	button.tag-pill { cursor: pointer; }
</style>
