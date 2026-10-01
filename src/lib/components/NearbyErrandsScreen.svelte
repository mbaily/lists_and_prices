<script lang="ts">
    import { onDestroy, tick } from 'svelte';
    import catalogue from '$lib/locations/melbourne.json';
    import { docState, commitState } from '$lib/yjsStore.svelte';
    import { readFolders, readLists, readAllItems, readCustomLocations, saveCustomLocation, deleteCustomLocation, readStartingLocation, saveStartingLocation, clearStartingLocation, isItemDone, readNearbyChecklist, nearbyItemFingerprint, rememberNearbyChecklist, dismissNearbyChecklist, setNearbyTodoDone } from '$lib/data';
    import { collectErrands, nearbyStops, suggestStops, type NearbyStop } from '$lib/nearbyErrands';
    import { availableLocationTags, matchingLocationTags, validCoordinates, normalizeLocationTag, type Coordinates, type RetailLocation } from '$lib/retailLocations';
    import ConfirmDialog from './ConfirmDialog.svelte';
    import SuburbPicker from './SuburbPicker.svelte';
    import type { Suburb } from '$lib/suburbSearch';
    import { isChecklistDismissed } from '$lib/nearbyChecklist';

    let { onBack, onOpenItem }: { onBack: () => void; onOpenItem: (listId: string, itemId: string) => void } = $props();
    const savedLocation = $derived.by(() => { void docState.version; return readStartingLocation(); });
    const origin = $derived<Coordinates | null>(savedLocation ? { latitude: savedLocation.latitude, longitude: savedLocation.longitude } : null);
    const originLabel = $derived(savedLocation ? savedLocation.source === 'gps' ? 'Last GPS location' : `${savedLocation.label} · approximate suburb centre` : '');
    const accuracy = $derived(savedLocation?.accuracy ?? null);
    let locating = $state(false);
    let locationError = $state('');
    let radius = $state(5);
    let suburbQuery = $state('');
    let showLocations = $state(false);
    let name = $state('');
    let address = $state('');
    let tags = $state('');
    let latitude = $state('');
    let longitude = $state('');
    let editingId = $state<string | null>(null);
    let formError = $state('');
    let deleteTarget = $state<RetailLocation | null>(null);
    let requestVersion = 0;
    onDestroy(() => { requestVersion++; });

    $effect(() => {
        // Restore local persistence and follow remote updates without writing defaults back to Yjs.
        const location = savedLocation;
        suburbQuery = location?.source === 'suburb' ? location.label : '';
        requestVersion++;
        locating = false;
    });

    const customLocations = $derived.by(() => { void docState.version; return readCustomLocations(); });
    const locations = $derived([...catalogue.locations, ...customLocations] as RetailLocation[]);
    const availableTags = $derived(availableLocationTags(locations));
    let tagQuery = $state('');
    let showAllTags = $state(false);
    let selectedTag = $state<string | null>(null);
    let tagLocationsPanel = $state<HTMLElement>();
    const selectedTagLocations = $derived(selectedTag ? locations.filter(location => matchingLocationTags([selectedTag!], location).length > 0)
        .sort((a, b) => a.name.localeCompare(b.name) || (a.address ?? '').localeCompare(b.address ?? '')) : []);
    async function selectTag(tag: string) {
        selectedTag = tag;
        await tick();
        tagLocationsPanel?.scrollIntoView({ block: 'nearest' });
    }
    let showAlternatives = $state(false);
    const matchingTags = $derived(availableTags.filter(entry => entry.tag.includes(normalizeLocationTag(tagQuery).replace(/[^\w]/g, ''))));
    const visibleTags = $derived(tagQuery.trim() || showAllTags ? matchingTags : [...matchingTags].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)).slice(0, 12));
    const checklistStates = $derived.by(() => { void docState.version; return readNearbyChecklist(); });
    const candidates = $derived.by(() => {
        void docState.version;
        const folders = readFolders();
        const folderById = new Map(folders.map(folder => [folder.id, folder]));
        return collectErrands(readAllItems(), readLists(), folders, true).map(errand => {
            const folder = folderById.get(errand.list.folderId);
            const done = !errand.item.note && isItemDone(errand.item, folder);
            const fingerprint = nearbyItemFingerprint(errand.item, errand.list, folder);
            const state = checklistStates[errand.item.id];
            return { errand, done, fingerprint, state, hidden: isChecklistDismissed(state, fingerprint, done) };
        });
    });
    const errands = $derived(candidates.filter(row => !row.done && !row.hidden).map(row => row.errand));
    const supportedErrands = $derived(errands.filter(errand => locations.some(location => matchingLocationTags(errand.tags, location).length > 0)));
    const supportedIds = $derived(new Set(supportedErrands.map(errand => errand.item.id)));
    const checklist = $derived(candidates.filter(row => !row.hidden && (row.done ? !!row.state : supportedIds.has(row.errand.item.id) || !!row.state)));
    const completedChecklist = $derived(checklist.filter(row => row.done));
    const stops = $derived(origin ? nearbyStops(locations, origin, radius, errands) : []);
    const plan = $derived(suggestStops(stops, errands));
    const coveredCount = $derived(errands.length - plan.unavailable.length);
    const nearbyIds = $derived(new Set(stops.flatMap(stop => stop.errands.map(errand => errand.item.id))));

    $effect(() => {
        if (commitState.isHistorical) return;
        rememberNearbyChecklist(checklist.filter(row => !row.done).map(row => ({ id: row.errand.item.id, fingerprint: row.fingerprint })));
    });

    function dismissTask(id: string) {
        if (commitState.isHistorical) return;
        const row = checklist.find(row => row.errand.item.id === id);
        if (row) dismissNearbyChecklist([{ id, fingerprint: row.fingerprint }]);
    }
    function clearCompletedTasks() {
        if (commitState.isHistorical) return;
        dismissNearbyChecklist(completedChecklist.map(row => ({ id: row.errand.item.id, fingerprint: row.fingerprint })));
    }
    function setTaskDone(id: string, checked: boolean) {
        if (!commitState.isHistorical) setNearbyTodoDone(id, checked);
    }
    const customIds = $derived(new Set(customLocations.map(location => location.id)));

    function useGps() {
        if (commitState.isHistorical) return;
        if (!navigator.geolocation) { locationError = 'This browser does not support location. Choose a starting location below.'; return; }
        const version = ++requestVersion;
        locating = true;
        locationError = '';
        navigator.geolocation.getCurrentPosition(position => {
            if (version !== requestVersion || commitState.isHistorical) return;
            saveStartingLocation({ latitude: position.coords.latitude, longitude: position.coords.longitude,
                source: 'gps', label: 'Last GPS location', accuracy: position.coords.accuracy, updatedAt: new Date().toISOString() });
            locating = false;
        }, error => {
            if (version !== requestVersion) return;
            locating = false;
            locationError = error.code === 1 ? 'Location permission was denied. Choose a starting location below, or enable location access in your browser.' : 'Could not get your location. Try again or choose a starting location below.';
        }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
    }

    function selectSuburb(suburb: Suburb) {
        if (commitState.isHistorical) return;
        requestVersion++;
        locating = false;
        locationError = '';
        saveStartingLocation({ latitude: suburb.latitude, longitude: suburb.longitude,
            source: 'suburb', label: suburb.name, accuracy: null, updatedAt: new Date().toISOString() });
    }

    function clearSuburb() {
        if (commitState.isHistorical) return;
        requestVersion++;
        locating = false;
        locationError = '';
        // Clearing search text must not discard a saved GPS starting point.
        if (savedLocation?.source === 'suburb') clearStartingLocation();
    }

    function clearForm() {
        editingId = null; name = ''; address = ''; tags = ''; latitude = ''; longitude = ''; formError = '';
    }
    function editLocation(location: RetailLocation) {
        editingId = location.id; name = location.name; address = location.address ?? '';
        tags = location.tags.map(tag => '#' + tag).join(' ');
        latitude = String(location.latitude); longitude = String(location.longitude); formError = '';
    }
    function saveLocation() {
        if (commitState.isHistorical) return;
        formError = '';
        if (!latitude.trim() || !longitude.trim()) { formError = 'Enter both latitude and longitude, or use your current location.'; return; }
        const coordinates = { latitude: Number(latitude), longitude: Number(longitude) };
        if (!validCoordinates(coordinates)) { formError = 'Enter a latitude from −90 to 90 and longitude from −180 to 180.'; return; }
        try {
            saveCustomLocation({ id: editingId ?? 'custom-' + crypto.randomUUID(), name, address: address.trim(), tags: tags.trim().split(/[\s,]+/).filter(Boolean).map(normalizeLocationTag), ...coordinates });
            clearForm();
        } catch (error) { formError = error instanceof Error ? error.message : 'Could not save the location.'; }
    }
    function removeLocation() {
        if (!deleteTarget || commitState.isHistorical) return;
        deleteCustomLocation(deleteTarget.id);
        if (editingId === deleteTarget.id) clearForm();
        deleteTarget = null;
    }
    function directions(location: RetailLocation) {
        const destination = location.coordinateAccuracy === 'suburb' && location.address ? location.address : `${location.latitude},${location.longitude}`;
        return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
    }
    function distanceLabel(km: number) { return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`; }
</script>

{#snippet stopCard(stop: NearbyStop)}
                <article class="stop">
                    <div class="stop-heading"><div><h2>{stop.location.name}</h2><p>{distanceLabel(stop.distanceKm)} away{stop.location.address ? ' · ' + stop.location.address : ''}</p>{#if stop.location.coordinateAccuracy === 'shopping-centre'}<p>Distance and directions use the shopping centre location.</p>{:else if stop.location.coordinateAccuracy === 'suburb'}<p>Approximate suburb location. Check the store address before travelling.</p>{/if}</div><a href={directions(stop.location)} target="_blank" rel="noopener noreferrer">Directions ↗</a></div>
                    <p class="match-count">{stop.errands.length} matching item{stop.errands.length === 1 ? '' : 's'}</p>
                    <ul>{#each stop.errands as errand (errand.item.id)}<li><button class="errand" onclick={() => onOpenItem(errand.list.id, errand.item.id)}><span>{errand.item.name}</span><small>{errand.list.name}{errand.item.note ? ' · Note' : ''}</small></button></li>{/each}</ul>
                    {#if !customIds.has(stop.location.id) && stop.location.source}<a class="source" href={stop.location.source} target="_blank" rel="noopener noreferrer">Location source ↗</a>{/if}
                </article>
{/snippet}

<div class="nearby-screen">
    <header>
        <button class="back" onclick={onBack} aria-label="Back to lists">←</button>
        <h1>Nearby errands</h1>
        <button class="manage" onclick={() => showLocations = !showLocations}>{showLocations ? 'Errands' : 'Locations'}</button>
    </header>
    <main>
        {#if commitState.isHistorical}<p class="notice">Viewing historical todos and custom locations. Exit history to make changes.</p>{/if}
        <section class="position">
            <button class="primary" onclick={useGps} disabled={locating || commitState.isHistorical}>{locating ? 'Finding your location…' : origin ? 'Update my location' : 'Use my location'}</button>
            <p class="hint">Your last starting location is remembered and syncs across your devices. GPS updates only when you press this button.</p>
            {#if locationError}<p role="alert" class="error">{locationError}</p>{/if}
            <fieldset disabled={commitState.isHistorical}><SuburbPicker bind:value={suburbQuery} onSelect={selectSuburb} onClear={clearSuburb} /></fieldset>
            {#if origin}<p class="origin">{originLabel}{accuracy !== null ? ` · GPS accuracy approximately ${Math.round(accuracy)} m` : ''}</p>{/if}
            {#if savedLocation}<p class="hint">Last updated: {new Date(savedLocation.updatedAt).toLocaleString()}</p>{/if}
        </section>


        {#if showLocations}
            <section class="custom">
                <h2>{editingId ? 'Edit location' : 'Add a location'}</h2>
                <p class="hint">Add any shop or place. Matching hashtags might be #postoffice, #pharmacy or #home. A #coles or #woolworths location also matches #supermarket automatically.</p>
                <form onsubmit={(event) => { event.preventDefault(); saveLocation(); }}>
                    <fieldset disabled={commitState.isHistorical}>
                        <label>Name<input bind:value={name} required placeholder="My local pharmacy" /></label>
                        <label>Address (optional)<input bind:value={address} placeholder="Street and suburb" /></label>
                        <label>Matching hashtags<input bind:value={tags} required placeholder="#pharmacy" /></label>
                        <div class="coordinates"><label>Latitude<input bind:value={latitude} inputmode="decimal" required placeholder="−37.8136" /></label><label>Longitude<input bind:value={longitude} inputmode="decimal" required placeholder="144.9631" /></label></div>
                        <button type="button" disabled={!origin} onclick={() => { if (origin) { latitude = String(origin.latitude); longitude = String(origin.longitude); } }}>Use starting location coordinates</button>
                        <div class="form-actions"><button class="primary" type="submit">{editingId ? 'Save changes' : 'Add location'}</button>{#if editingId}<button type="button" onclick={clearForm}>Cancel edit</button>{/if}</div>
                    </fieldset>
                    {#if formError}<p class="error" role="alert">{formError}</p>{/if}
                </form>
                <h2>Your locations ({customLocations.length})</h2>
                <p class="hint">Saved locations sync across your devices and are included in JSON backups.</p>
                {#each customLocations as location (location.id)}
                    <article class="saved"><div><strong>{location.name}</strong><p>{location.tags.map(tag => '#' + tag).join(' ')} · {location.latitude.toFixed(5)}, {location.longitude.toFixed(5)}</p></div><div class="form-actions"><button disabled={commitState.isHistorical} onclick={() => editLocation(location)}>Edit</button><button disabled={commitState.isHistorical} onclick={() => deleteTarget = location}>Delete</button></div></article>
                {:else}<p class="hint">No custom locations yet.</p>{/each}
            </section>
        {:else}
            <section class="task-checklist" aria-labelledby="matched-tasks-heading">
                <div class="checklist-heading"><h2 id="matched-tasks-heading">Matched tasks ({checklist.length})</h2>{#if completedChecklist.length}<button disabled={commitState.isHistorical} onclick={clearCompletedTasks}>Clear completed</button>{/if}</div>
                <p class="hint">Ticks update the original todos. Completed tasks stay until cleared. Dismissed notes and unchecked tasks return when edited; checked todos stay completed. This checklist syncs across devices.</p>
                <ul>{#each checklist as row (row.errand.item.id)}
                    <li class="checklist-row" class:completed={row.done}>
                        {#if row.errand.item.note}<span class="note-mark" aria-label="Note">📝</span>{:else}<input type="checkbox" checked={row.done} disabled={commitState.isHistorical} aria-label={`Completed: ${row.errand.item.name}`} onchange={(event) => setTaskDone(row.errand.item.id, event.currentTarget.checked)} />{/if}
                        <button class="errand" onclick={() => onOpenItem(row.errand.list.id, row.errand.item.id)}><span>{row.errand.item.name}</span><small>{row.errand.list.name}{row.errand.item.note ? ' · Note' : ''}</small>{#if !row.done && origin && !nearbyIds.has(row.errand.item.id)}<small>{supportedIds.has(row.errand.item.id) ? `No match within ${radius} km.` : 'No matching location in the database.'}</small>{/if}</button>
                        <button class="dismiss-task" disabled={commitState.isHistorical} onclick={() => dismissTask(row.errand.item.id)} aria-label={`Dismiss from errands: ${row.errand.item.name}`} title="Dismiss from errands">×</button>
                    </li>
                {:else}<li class="hint">No matched tasks. Add location hashtags to a todo, note or list name.</li>{/each}</ul>
            </section>
            <div class="filters"><label>Within <select bind:value={radius}>{#each [1, 2, 5, 10, 25, 50] as km}<option value={km}>{km} km</option>{/each}</select></label></div>
            {#if !origin}
                <p class="empty">Use your location or choose a starting suburb to see nearby errands.</p>
            {:else}
                <section class="suggestions" aria-labelledby="suggested-stops-heading">
                    <h2 id="suggested-stops-heading">Suggested stops</h2>
                    <p class="coverage" aria-live="polite">{coveredCount} of {errands.length} tagged item{errands.length === 1 ? '' : 's'} covered by {plan.suggested.length} stop{plan.suggested.length === 1 ? '' : 's'} within {radius} km.</p>
                    <p class="hint">A short set of shops covering all nearby matches, shown nearest first. Each item appears once. Distances are straight-line distances.</p>
                    {#if plan.unavailable.length}
                        <div class="unavailable">
                            <h3>Items without a nearby match ({plan.unavailable.length})</h3>
                            <ul>{#each plan.unavailable as errand (errand.item.id)}<li>
                                <button class="errand" onclick={() => onOpenItem(errand.list.id, errand.item.id)}><span>{errand.item.name}</span><small>{errand.list.name}{errand.item.note ? ' · Note' : ''}</small><small>{supportedIds.has(errand.item.id) ? `No match within ${radius} km. Try a larger radius.` : 'No matching location in the database. Add a place in Locations.'}</small></button>
                            </li>{/each}</ul>
                        </div>
                    {/if}
                    {#if errands.length === 0}<p class="empty">Add location hashtags to an unchecked todo, note or list name to find places to go.</p>{/if}
                    {#each plan.suggested as stop (stop.location.id)}{@render stopCard(stop)}{/each}
                </section>
                {#if plan.alternatives.length}
                    <details class="alternatives" bind:open={showAlternatives}>
                        <summary>Alternatives ({plan.alternatives.length} other locations)</summary>
                        <p class="hint">Other shops matching your items, nearest first. These offer alternatives to the suggested stops.</p>
                        {#if showAlternatives}{#each plan.alternatives as stop (stop.location.id)}{@render stopCard(stop)}{/each}{/if}
                    </details>
                {/if}
            {/if}
        {/if}
        <details class="available-tags">
            <summary>Available location hashtags</summary>
            <p class="hint">Add these hashtags to a list name to match its todos and notes, or tag individual items. Item hashtags take precedence over list hashtags. Counts cover all locations in the database, including your saved places. #supermarket matches Coles, Woolworths and Aldi.</p>
            <label class="tag-search">Find a location hashtag<input type="search" bind:value={tagQuery} placeholder="e.g. bunnings, jbhifi or northland" /></label>
            {#if selectedTag}
                <section class="tag-locations" bind:this={tagLocationsPanel} aria-label={`Locations matching #${selectedTag}`}>
                    <div class="checklist-heading"><h2>#{selectedTag} · {selectedTagLocations.length} locations</h2><button aria-label="Close location list" onclick={() => selectedTag = null}>×</button></div>
                    <ul class="tag-location-list">
                        {#each selectedTagLocations as location (location.id)}
                            <li><div><strong>{location.name}</strong>{#if location.address}<p>{location.address}</p>{/if}</div><a href={directions(location)} target="_blank" rel="noopener noreferrer" aria-label={`Directions to ${location.name}`}>Directions ↗</a></li>
                        {:else}<li class="hint">No locations for this hashtag.</li>{/each}
                    </ul>
                </section>
            {/if}
            <ul class="tag-list">
                {#each visibleTags as entry (entry.tag)}
                    <li><button class:chosen={selectedTag === entry.tag} aria-pressed={selectedTag === entry.tag} onclick={() => selectTag(entry.tag)}><strong>#{entry.tag}</strong><span>{entry.count} location{entry.count === 1 ? '' : 's'}</span></button></li>
                {:else}<li>{availableTags.length ? 'No matching hashtags.' : 'No location hashtags yet. Add a place in Locations.'}</li>{/each}
            </ul>
            {#if !tagQuery.trim() && availableTags.length > 12}<button onclick={() => showAllTags = !showAllTags}>{showAllTags ? 'Show fewer hashtags' : `Show all ${availableTags.length} hashtags`}</button>{/if}
            <p class="hint">For example: name a list “Shopping #supermarket”, or tag one item “Buy milk #coles”. New location hashtags appear here automatically.</p>
        </details>
        <footer>{catalogue.locations.length} pre-recorded Melbourne locations · <a href={catalogue.source} target="_blank" rel="noopener noreferrer">{catalogue.attribution}</a> · <a href={catalogue.licenseUrl} target="_blank" rel="noopener noreferrer">{catalogue.license}</a><p>Catalogue retrieved: {catalogue.retrievedAt}. Store openings and closures may need manual updates.</p></footer>
    </main>
</div>
{#if deleteTarget}<ConfirmDialog message={`Delete “${deleteTarget.name}”?`} confirmLabel="Delete" isDanger={true} onConfirm={removeLocation} onCancel={() => deleteTarget = null} />{/if}

<style>
    .nearby-screen { position: fixed; inset: 0; display: flex; flex-direction: column; background: var(--bg); color: var(--text); }
    header { display: flex; align-items: center; gap: .75rem; padding: .65rem .8rem; border-bottom: 1px solid var(--border); flex-shrink: 0; }
    h1 { font-size: 1.15rem; margin: 0; flex: 1; } h2 { font-size: 1rem; margin: 0 0 .4rem; }
    main { overflow-y: auto; padding: 1rem; padding-bottom: max(1rem, env(safe-area-inset-bottom)); flex: 1; }
    main > * { max-width: 760px; margin-left: auto; margin-right: auto; }
    button, select, input { font: inherit; color: var(--text); border: 1px solid var(--border); background: var(--bg2); border-radius: 6px; padding: .65rem; }
    button, select { cursor: pointer; } button:disabled { opacity: .5; cursor: default; }
    .back { border: 0; font-size: 1.35rem; padding: .3rem .6rem; } .primary { background: var(--accent); color: #fff; border-color: var(--accent); }
    label { display: flex; flex-direction: column; gap: .4rem; margin: .7rem 0; } select, input { width: 100%; min-width: 0; }
    .hint, .origin, footer, small { font-size: .85rem; color: var(--text2); line-height: 1.5; }
    .error { color: #dc2626; } .notice, .empty { padding: 1rem; border-radius: 6px; background: var(--bg2); }
    .filters, .stop-heading, .saved { display: flex; align-items: center; justify-content: space-between; gap: .8rem; }
    .filters label { flex-direction: row; align-items: center; } .filters select { width: auto; }
    .stop, .saved { border: 1px solid var(--border); border-radius: 8px; margin-top: .8rem; padding: .9rem; }
    .stop-heading { align-items: flex-start; } .stop-heading p, .saved p { color: var(--text2); font-size: .85rem; margin: .2rem 0; }
    a { color: var(--accent); } .stop-heading a { flex-shrink: 0; font-size: .85rem; padding-top: .2rem; }
    ul { list-style: none; padding: 0; margin: .7rem 0 0; } li + li { border-top: 1px solid var(--border); }
    .errand { border: 0; background: transparent; text-align: left; width: 100%; display: flex; flex-direction: column; gap: .3rem; padding: .7rem 0; overflow-wrap: anywhere; }
    .source { font-size: .75rem; } footer { margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid var(--border); } footer p { margin: .3rem 0; }
    fieldset { padding: 0; border: 0; margin: 0; min-width: 0; } .coordinates { display: flex; gap: .7rem; } .coordinates label { flex: 1; min-width: 0; }
    .form-actions { display: flex; gap: .5rem; margin: .7rem 0; } .custom > h2 { margin-top: 1.3rem; } .saved { flex-wrap: wrap; }
    .task-checklist { margin: 1rem auto; border: 1px solid var(--border); border-radius: 8px; padding: .8rem; }
    .checklist-heading { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .5rem; }
    .checklist-heading h2 { margin: 0; }
    .checklist-row { display: flex; gap: .5rem; align-items: center; }
    .checklist-row .errand { flex: 1; min-width: 0; }
    .checklist-row input[type="checkbox"] { width: 22px; height: 22px; flex-shrink: 0; margin: 0 8px; accent-color: var(--accent); }
    .note-mark { width: 38px; flex-shrink: 0; text-align: center; }
    .dismiss-task { width: 44px; height: 44px; flex-shrink: 0; font-size: 1.4rem; border: 0; background: transparent; }
    .completed .errand > span { text-decoration: line-through; color: var(--text2); }
    .available-tags, .alternatives { margin-top: 1.2rem; }
    summary { cursor: pointer; padding: .75rem 0; font-weight: 600; }
    .coverage { font-weight: 600; line-height: 1.5; }
    .match-count { color: var(--accent); font-size: .85rem; margin: .6rem 0 0; }
    .unavailable { border: 1px solid var(--border); border-radius: 8px; background: var(--bg2); padding: .8rem; margin: .8rem 0; }
    .unavailable h3 { font-size: .95rem; margin: 0; }
    .tag-list { display: flex; flex-wrap: wrap; gap: .5rem; }
    .tag-list li { border: 0; }
    .tag-list button { display: flex; align-items: baseline; flex-wrap: wrap; gap: .4rem; padding: .65rem; min-height: 44px; text-align: left; }
    .tag-list button.chosen { border-color: var(--accent); }
    .tag-locations { border: 1px solid var(--border); border-radius: 8px; padding: .75rem; margin-top: .75rem; }
    .tag-location-list { max-height: 320px; overflow-y: auto; overscroll-behavior: contain; }
    .tag-location-list li { display: flex; align-items: flex-start; justify-content: space-between; gap: .75rem; padding: .75rem 0; overflow-wrap: anywhere; }
    .tag-location-list li > div { min-width: 0; }
    .tag-location-list p { font-size: .85rem; color: var(--text2); margin: .25rem 0 0; }
    .tag-location-list a { flex-shrink: 0; font-size: .85rem; padding: .25rem 0; }
    .tag-list span { color: var(--text2); font-size: .8rem; }
    @media(max-width: 420px) { .stop-heading { flex-direction: column; } main { padding: .75rem; } }
</style>
