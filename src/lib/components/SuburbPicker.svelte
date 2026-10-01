<script lang="ts">
    import catalogue from '$lib/locations/melbourne-suburbs.json';
    import { searchSuburbs, type Suburb } from '$lib/suburbSearch';

    let { value = $bindable(''), onSelect, onClear = () => {}, label = 'Or start near a Melbourne suburb' }: { value?: string; onSelect: (suburb: Suburb) => void; onClear?: () => void; label?: string } = $props();
    let input: HTMLInputElement;
    const uid = $props.id();
    let open = $state(false);
    let activeIndex = $state(0);
    const matches = $derived(searchSuburbs(catalogue.suburbs, value));
    const expanded = $derived(open && value.trim().length > 0);

    function choose(suburb: Suburb) {
        value = suburb.name;
        open = false;
        activeIndex = 0;
        onSelect(suburb);
    }
    function clear() {
        value = '';
        open = false;
        activeIndex = 0;
        onClear();
        input.focus();
    }
    function handleKey(event: KeyboardEvent) {
        if (event.key === 'Escape') { open = false; return; }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (!open) { open = true; activeIndex = 0; }
            else if (matches.length) activeIndex = (activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length;
        } else if (event.key === 'Enter' && expanded && matches[activeIndex]) {
            event.preventDefault();
            choose(matches[activeIndex]);
        }
    }
</script>

<div class="suburb-picker">
    <label for={uid}>{label}</label>
    <div class="input-row">
    <button class="clear" type="button" aria-label="Clear suburb" title="Clear suburb" disabled={!value} onclick={clear}><span aria-hidden="true">×</span></button>
    <input bind:this={input} id={uid} role="combobox" aria-autocomplete="list" aria-expanded={expanded}
        aria-controls={`${uid}-results`} aria-describedby={`${uid}-hint`}
        aria-activedescendant={expanded && matches[activeIndex] ? `${uid}-option-${activeIndex}` : undefined}
        bind:value placeholder="Choose a starting location…" autocomplete="off" spellcheck="false"
        onfocus={() => { open = true; activeIndex = 0; }} onblur={() => open = false}
        oninput={() => { open = true; activeIndex = 0; }} onkeydown={handleKey} />
    </div>
    <div id={`${uid}-results`} role="listbox" aria-label="Melbourne suburbs" hidden={!expanded}>
        {#each matches as suburb, index (suburb.id)}
            <button id={`${uid}-option-${index}`} type="button" role="option" tabindex="-1"
                aria-selected={index === activeIndex} class:active={index === activeIndex}
                onmousedown={event => event.preventDefault()} onclick={() => choose(suburb)}>{suburb.name}</button>
        {/each}
    </div>
    {#if expanded && matches.length === 0}<p class="hint" role="status">No matching suburb. Try another spelling.</p>{/if}
    <p id={`${uid}-hint`} class="hint">Type a suburb name and choose a match. Distances start from its approximate centre.</p>
    <p class="attribution"><a href={catalogue.source} target="_blank" rel="noopener noreferrer">Suburb data: Vicmap Admin © State of Victoria</a> · <a href={catalogue.licenseUrl} target="_blank" rel="noopener noreferrer">{catalogue.license}</a></p>
</div>

<style>
    .suburb-picker { margin: .7rem 0; }
    label { display: block; margin-bottom: .4rem; }
    input, button { font: inherit; color: var(--text); background: var(--bg2); border: 1px solid var(--border); padding: .65rem; }
    input { width: 100%; box-sizing: border-box; border-radius: 6px; }
    .input-row { display: flex; gap: .5rem; }
    .input-row input { flex: 1; min-width: 0; }
    .clear { width: 44px; flex-shrink: 0; min-height: 44px; border: 1px solid var(--border); border-radius: 6px; text-align: center; font-size: 1.5rem; line-height: 1; }
    .clear:disabled { opacity: .5; cursor: default; }
    [role='listbox'] { margin-top: .3rem; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
    button { display: block; width: 100%; border: 0; border-radius: 0; text-align: left; cursor: pointer; }
    button + button { border-top: 1px solid var(--border); }
    button.active, button:hover { background: var(--accent); color: white; }
    .hint { font-size: .85rem; color: var(--text2); line-height: 1.5; }
    .attribution { font-size: .75rem; } a { color: var(--accent); }
</style>
