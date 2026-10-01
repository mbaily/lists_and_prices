<script lang="ts">
    import { untrack } from 'svelte';
    import { suburbById } from '$lib/hotSuburbs';
    import SuburbPicker from './SuburbPicker.svelte';
    import type { Suburb } from '$lib/suburbSearch';

    let { initialIds, onBack, onSave }: { initialIds: string[]; onBack: () => void; onSave: (ids: string[]) => void } = $props();
    let ids = $state(untrack(() => [...initialIds]));
    let query = $state('');
    let suburbList = $state<HTMLUListElement>();
    let dragId = $state<string | null>(null);
    let overId = $state<string | null>(null);
    let dragPointer: number | null = null;

    function startDrag(event: PointerEvent, id: string) {
        if (!event.isPrimary || event.button !== 0) return;
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        dragPointer = event.pointerId;
        dragId = id;
        overId = id;
    }
    function dragOver(event: PointerEvent) {
        if (event.pointerId !== dragPointer) return;
        event.preventDefault();
        const row = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-suburb-id]');
        if (row && suburbList?.contains(row)) overId = row.dataset.suburbId ?? null;
    }
    function finishDrag(event: PointerEvent) {
        if (event.pointerId !== dragPointer) return;
        const from = ids.indexOf(dragId ?? '');
        const to = ids.indexOf(overId ?? '');
        if (from >= 0 && to >= 0 && from !== to) {
            const next = [...ids];
            const [id] = next.splice(from, 1);
            next.splice(to, 0, id);
            ids = next;
        }
        cancelDrag();
    }
    function cancelDrag() {
        dragPointer = null;
        dragId = null;
        overId = null;
    }

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
        <ul bind:this={suburbList}>
            {#each ids as id, index (id)}
                {@const name = suburbById.get(id)?.name ?? id}
                <li data-suburb-id={id} class:dragging={dragId === id} class:drop-target={dragId !== null && overId === id && dragId !== id}><span>{name}</span>
                    <button class="drag-handle" disabled={ids.length < 2} aria-label={`Reorder ${name}`} title="Drag to reorder, or use the arrow keys"
                        onpointerdown={(event) => startDrag(event, id)} onpointermove={dragOver} onpointerup={finishDrag}
                        onpointercancel={cancelDrag} onlostpointercapture={cancelDrag}
                        onkeydown={(event) => { if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); move(index, event.key === 'ArrowUp' ? -1 : 1); } }}>
                        <svg width="18" height="22" viewBox="0 0 18 22" fill="currentColor" aria-hidden="true"><circle cx="6" cy="5" r="1.5" /><circle cx="12" cy="5" r="1.5" /><circle cx="6" cy="11" r="1.5" /><circle cx="12" cy="11" r="1.5" /><circle cx="6" cy="17" r="1.5" /><circle cx="12" cy="17" r="1.5" /></svg>
                    </button>
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
    .drag-handle { display: inline-flex; align-items: center; justify-content: center; touch-action: none; user-select: none; cursor: grab; }
    .drag-handle:active { cursor: grabbing; }
    li.dragging { opacity: .5; }
    li.drop-target { outline: 2px solid var(--accent); outline-offset: -2px; }
    .actions { display: flex; gap: .5rem; margin-top: 1rem; }
    .save { background: var(--accent); color: #fff; }
</style>
