<script lang="ts">
    import type { Snippet } from 'svelte';
    let { label, children }: { label: string; children: Snippet } = $props();
</script>

<details class="help-text">
    <summary aria-label={label} title={label}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
            <circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4" /><path d="M12 16v1" />
        </svg>
    </summary>
    <div class="help-content">{@render children()}</div>
</details>

<style>
    .help-text { margin: .4rem 0; }
    summary { display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; box-sizing: border-box; list-style: none; border: 1px solid var(--border); border-radius: 50%; background: #000; color: var(--text2); cursor: pointer; }
    summary::-webkit-details-marker { display: none; }
    summary:hover, details[open] > summary { color: var(--accent); border-color: var(--accent); }
    summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .help-content { color: var(--text2); font-size: .85rem; line-height: 1.5; }
</style>
