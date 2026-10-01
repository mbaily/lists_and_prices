<script lang="ts">
    import { untrack } from 'svelte';
    import { suburbById } from '$lib/hotSuburbs';
    import SuburbPicker from './SuburbPicker.svelte';
    import type { Suburb } from '$lib/suburbSearch';

    let { initialIds, onBack, onSave }: { initialIds: string[]; onBack: () => void; onSave: (ids: string[]) => void } = $props();
    let ids = $state(untrack(() => [...initialIds]));
    let query = $state('');

    function add(suburb: Suburb) {
        if (!ids.includes(suburb.id)) ids = [...ids, suburb.id];
        query = '';
    }
    function move(index: number, direction: -1 | 1) {
        const target = index + direction;
        if (target < 0 || target >= ids.length) return;
        const next = [...ids];
        [next[index], next[target]] = [next[target], next[index]];
        ids = next;
    }
</script>

<div class="hot-screen">
    <header><button onclick={onBack} aria-label="Back to nearby errands" title="Back">←</button><h1>Hot suburbs</h1></header>
    <main>
        <p>Choose the suburb shortcuts shown beside the location button. Each uses the suburb’s approximate centre.</p>
        <SuburbPicker bind:value={query} onSelect={add} label="Add a suburb" />
        <ul>
            {#each ids as id, index (id)}
                {@const name = suburbById.get(id)?.name ?? id}
                <li><span>{name}</span>
                    <button disabled={index === 0} onclick={() => move(index, -1)} aria-label={`Move ${name} earlier`} title="Move earlier">↑</button>
                    <button disabled={index === ids.length - 1} onclick={() => move(index, 1)} aria-label={`Move ${name} later`} title="Move later">↓</button>
                    <button onclick={() => ids = ids.filter(saved => saved !== id)} aria-label={`Remove ${name}`} title="Remove">×</button>
                </li>
            {:else}<li>Add a suburb above to create a shortcut.</li>{/each}
        </ul>
        <div class="actions"><button class="save" onclick={() => onSave(ids)}>Save</button><button onclick={onBack}>Cancel</button></div>
    </main>
</div>

<style>
    .hot-screen { position: fixed; inset: 0; display: flex; flex-direction: column; background: var(--bg); color: var(--text); }
    header { display: flex; align-items: center; gap: .75rem; padding: .65rem .8rem; border-bottom: 1px solid var(--border); }
    h1 { font-size: 1.15rem; margin: 0; }
    main { flex: 1; overflow-y: auto; padding: 1rem; padding-bottom: max(1rem, env(safe-area-inset-bottom)); }
    main > * { max-width: 760px; margin-left: auto; margin-right: auto; }
    button { font: inherit; color: var(--text); border: 1px solid var(--border); background: #000; border-radius: 6px; padding: .65rem; min-width: 44px; min-height: 44px; cursor: pointer; }
    button:disabled { opacity: .4; cursor: default; }
    ul { list-style: none; padding: 0; }
    li { display: flex; align-items: center; gap: .4rem; padding: .5rem 0; border-bottom: 1px solid var(--border); }
    li span { flex: 1; min-width: 0; }
    .actions { display: flex; gap: .5rem; margin-top: 1rem; }
    .save { background: var(--accent); color: #fff; }
</style>
