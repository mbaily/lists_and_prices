<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { helpTopics, type HelpTopic } from '$lib/help';

	let { onBack }: { onBack: () => void } = $props();
	let selectedTopic = $state<HelpTopic | null>(null);
	let contentEl: HTMLElement | undefined;
	let headingEl = $state<HTMLHeadingElement>();

	onMount(() => headingEl?.focus({ preventScroll: true }));

	async function openTopic(topic: HelpTopic | null) {
		selectedTopic = topic;
		await tick();
		contentEl?.scrollTo(0, 0);
		headingEl?.focus({ preventScroll: true });
	}

	function goBack() {
		if (selectedTopic) void openTopic(null);
		else onBack();
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && !event.defaultPrevented) {
			event.preventDefault();
			goBack();
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="screen">
	<header>
		<button class="back-btn" onclick={goBack}>
			← {selectedTopic ? 'Help menu' : 'Settings'}
		</button>
		<span class="title">Help &amp; user guide</span>
	</header>

	<main class="content" bind:this={contentEl}>
		<div class="page">
			{#if selectedTopic}
				<article aria-labelledby="help-heading">
					<p class="eyebrow">Lists &amp; Prices user guide</p>
					<h1 id="help-heading" tabindex="-1" bind:this={headingEl}>{selectedTopic.title}</h1>
					<p class="intro">{selectedTopic.summary}</p>
					{#each selectedTopic.sections as section}
						<section>
							<h2>{section.title}</h2>
							{#each section.paragraphs as paragraph}
								<p>{paragraph}</p>
							{/each}
							{#if section.steps}
								<ol>
									{#each section.steps as step}<li>{step}</li>{/each}
								</ol>
							{/if}
							{#if section.bullets}
								<ul>
									{#each section.bullets as bullet}<li>{bullet}</li>{/each}
								</ul>
							{/if}
						</section>
					{/each}
				</article>
				<nav class="related" aria-label="Related help topics">
					<h2>Related help</h2>
					{#each helpTopics.filter((topic) => selectedTopic?.related.includes(topic.id)) as topic}
						<button class="related-btn" onclick={() => openTopic(topic)}>{topic.title} →</button>
					{/each}
					<button class="related-btn" onclick={() => openTopic(null)}>← All help topics</button>
				</nav>
			{:else}
				<p class="eyebrow">Lists &amp; Prices user guide</p>
				<h1 id="help-heading" tabindex="-1" bind:this={headingEl}>How can we help?</h1>
				<p class="intro">Choose a topic for step-by-step instructions, examples and answers to common questions. This guide is available offline with the app.</p>
				<nav aria-label="Help topics">
					<ul class="topic-list">
						{#each helpTopics as topic (topic.id)}
							<li>
								<button class="topic-btn" onclick={() => openTopic(topic)}>
									<span class="topic-icon" aria-hidden="true">{topic.icon}</span>
									<span class="topic-copy">
										<span class="topic-title">{topic.title}</span>
										<span class="topic-summary">{topic.summary}</span>
									</span>
									<span class="topic-arrow" aria-hidden="true">›</span>
								</button>
							</li>
						{/each}
					</ul>
				</nav>
			{/if}
		</div>
	</main>
</div>

<style>
	.screen {
		height: 100dvh;
		display: flex;
		flex-direction: column;
		background: var(--bg);
		color: var(--text);
		overflow: hidden;
	}
	header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem 1rem;
		background: var(--bg2);
		border-bottom: 1px solid var(--border);
		flex-shrink: 0;
	}
	button { font: inherit; cursor: pointer; }
	.back-btn {
		min-height: 44px;
		padding: 0.35rem 0;
		border: none;
		background: none;
		color: var(--accent);
		white-space: nowrap;
	}
	.title { font-size: 0.95rem; font-weight: 600; }
	.content { flex: 1; min-height: 0; overflow-y: auto; }
	.page {
		max-width: 48rem;
		margin: 0 auto;
		padding: 1.5rem 1rem calc(2rem + env(safe-area-inset-bottom));
		line-height: 1.65;
		overflow-wrap: anywhere;
	}
	.eyebrow { margin: 0 0 0.4rem; color: var(--text2); font-size: 0.85rem; }
	h1 { margin: 0; font-size: clamp(1.5rem, 4vw, 2rem); line-height: 1.25; }
	h1:focus { outline: none; }
	.intro { margin: 0.75rem 0 1.5rem; color: var(--text2); }
	.topic-list { list-style: none; padding: 0; margin: 0; }
	.topic-list li + li { margin-top: 0.75rem; }
	.topic-btn {
		display: flex;
		align-items: center;
		gap: 0.85rem;
		width: 100%;
		padding: 1rem;
		text-align: left;
		color: var(--text);
		background: var(--bg2);
		border: 1px solid var(--border);
		border-radius: 10px;
	}
	.topic-btn:hover { background: var(--bg3); border-color: var(--accent); }
	.topic-icon { flex-shrink: 0; width: 1.75rem; text-align: center; font-size: 1.4rem; }
	.topic-copy { flex: 1; min-width: 0; }
	.topic-title { display: block; font-weight: 600; line-height: 1.4; }
	.topic-summary { display: block; margin-top: 0.3rem; color: var(--text2); font-size: 0.9rem; line-height: 1.5; }
	.topic-arrow { color: var(--accent); font-size: 1.5rem; }
	section { margin-top: 1.75rem; }
	h2 { margin: 0 0 0.65rem; font-size: 1.15rem; line-height: 1.4; }
	section p { margin: 0 0 0.85rem; }
	section ol, section ul { padding-left: 1.5rem; margin: 0.85rem 0; }
	section li + li { margin-top: 0.65rem; }
	.related { margin-top: 2rem; padding-top: 1.25rem; border-top: 1px solid var(--border); }
	.related-btn {
		display: block;
		min-height: 44px;
		padding: 0.5rem 0;
		text-align: left;
		border: none;
		background: none;
		color: var(--accent);
	}
	.related-btn:hover, .back-btn:hover { text-decoration: underline; }
	button:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
</style>
