<script lang="ts">
    import { onDestroy, tick, type Snippet } from 'svelte';
    import catalogue from '$lib/locations/melbourne.json';
    import suburbCatalogue from '$lib/locations/melbourne-suburbs.json';
    import { suburbLocations } from '$lib/suburbLocations';
    import { nearbyTaskPills, nearbyListPills } from '$lib/nearbyPills';
    import { groupErrands, errandPreview } from '$lib/errandGroups';
    import { docState, commitState } from '$lib/yjsStore.svelte';
    import { updateList, readFolders, readLists, readAllItems, readCustomLocations, saveCustomLocation, deleteCustomLocation, readStartingLocation, saveStartingLocation, readHotSuburbIds, saveHotSuburbIds, readNearbyPreviewLimit, saveNearbyPreviewLimit, isItemDone, readNearbyChecklist, nearbyItemFingerprint, rememberNearbyChecklist, dismissNearbyChecklist, setNearbyTodoDone, readPausedErrandTags, setErrandTagPaused, readPausedErrandItemIds, setErrandItemPaused } from '$lib/data';
    import { collectErrands, nearbyStops, suggestStops, isErrandPaused, isLocationOptionalErrand, locationOptionalTag, LOCATION_OPTIONAL_TAGS, type NearbyStop, type Errand } from '$lib/nearbyErrands';
    import { availableLocationTags, matchingLocationTags, validCoordinates, normalizeLocationTag, type Coordinates, type RetailLocation } from '$lib/retailLocations';
    import ConfirmDialog from './ConfirmDialog.svelte';
    import HelpText from './HelpText.svelte';
    import HotSuburbsScreen from './HotSuburbsScreen.svelte';
    import { suburbById } from '$lib/hotSuburbs';
    import type { Suburb } from '$lib/suburbSearch';
    import { isChecklistDismissed } from '$lib/nearbyChecklist';

    let { onBack, onOpenItem }: { onBack: () => void; onOpenItem: (listId: string, itemId: string) => void } = $props();
    const savedLocation = $derived.by(() => { void docState.version; return readStartingLocation(); });
    const origin = $derived<Coordinates | null>(savedLocation ? { latitude: savedLocation.latitude, longitude: savedLocation.longitude } : null);
    const originLabel = $derived(savedLocation ? savedLocation.source === 'gps' ? 'Last GPS location' : `${savedLocation.label} · approximate suburb centre` : '');
    const accuracy = $derived(savedLocation?.accuracy ?? null);
    let locating = $state(false);
    let locationError = $state('');
    let showLocationDetails = $state(false);
    let radius = $state(5);
    const previewLimit = $derived.by(() => { void docState.version; return readNearbyPreviewLimit(); });
    function setPreviewLimit(event: Event) {
        const input = event.currentTarget as HTMLSelectElement;
        if (!commitState.isHistorical) saveNearbyPreviewLimit(Number(input.value));
        input.value = String(previewLimit);
    }
    let showHotSuburbs = $state(false);
    const hotSuburbIds = $derived.by(() => { void docState.version; return readHotSuburbIds(); });
    const hotSuburbs = $derived(hotSuburbIds.flatMap(id => { const suburb = suburbById.get(id); return suburb ? [suburb] : []; }));
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
        void savedLocation;
        requestVersion++;
        locating = false;
    });

    const customLocations = $derived.by(() => { void docState.version; return readCustomLocations(); });
    const locations = $derived([...catalogue.locations, ...suburbLocations, ...customLocations] as RetailLocation[]);
    const availableTags = $derived.by(() => {
        const tags = availableLocationTags(locations);
        for (const tag of LOCATION_OPTIONAL_TAGS) {
            if (!tags.some(entry => entry.tag === tag)) tags.push({ tag, count: 0 });
        }
        return tags.sort((a, b) => a.tag.localeCompare(b.tag));
    });
    let tagQuery = $state('');
    let showAllTags = $state(false);
    let selectedTag = $state<string | null>(null);
    let tagLocationsPanel = $state<HTMLElement>();
    let radiusFilters = $state<HTMLElement>();
    async function scrollToRadius() {
        showLocations = false;
        await tick();
        radiusFilters?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
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
    const pausedTags = $derived.by(() => { void docState.version; return readPausedErrandTags(); });
    const pausedItemIds = $derived.by(() => { void docState.version; return readPausedErrandItemIds(); });
    const checklistStates = $derived.by(() => { void docState.version; return readNearbyChecklist(); });
    const candidates = $derived.by(() => {
        void docState.version;
        const folders = readFolders();
        const folderById = new Map(folders.map(folder => [folder.id, folder]));
        return collectErrands(readAllItems(), readLists(), folders, true, locations).map(errand => {
            const folder = folderById.get(errand.list.folderId);
            const done = !errand.item.note && isItemDone(errand.item, folder);
            const fingerprint = nearbyItemFingerprint(errand.item, errand.list, folder);
            const state = checklistStates[errand.item.id];
            return { errand, done, fingerprint, state, itemPaused: pausedItemIds.includes(errand.item.id), paused: isErrandPaused(errand, pausedTags, pausedItemIds), hidden: isChecklistDismissed(state, fingerprint, done) };
        });
    });
    const errands = $derived(candidates.filter(row => !row.done && !row.hidden && !row.paused).map(row => row.errand));
    const supportedErrands = $derived(errands.filter(errand => locations.some(location => matchingLocationTags(errand.tags, location).length > 0)));
    const supportedIds = $derived(new Set(supportedErrands.map(errand => errand.item.id)));
    const checklist = $derived(candidates.filter(row => !row.hidden && !row.paused && (row.done ? !!row.state : supportedIds.has(row.errand.item.id) || isLocationOptionalErrand(row.errand) || !!row.state)).sort((a, b) => Number(nearbyIds.has(b.errand.item.id)) - Number(nearbyIds.has(a.errand.item.id))));
    const checklistGroups = $derived(groupErrands(checklist));
    const pausedErrands = $derived(candidates.filter(row => !row.done && !row.hidden && row.paused));
    const pausedGroups = $derived(groupErrands(pausedErrands));
    function pauseTag(tag: string, paused: boolean) {
        if (!commitState.isHistorical) setErrandTagPaused(tag, paused);
    }
    function pauseItem(id: string, paused: boolean) {
        if (!commitState.isHistorical) setErrandItemPaused(id, paused);
    }
    const completedChecklist = $derived(checklist.filter(row => row.done));
    const stops = $derived(origin ? nearbyStops(locations, origin, radius, errands) : []);
    const nearbyPills = $derived(nearbyListPills(stops, errands, previewLimit));
    const nearbyIds = $derived(new Set(nearbyTaskPills(stops, errands).map(pill => pill.errand.item.id)));
    const locationIds = $derived(new Set(stops.flatMap(stop => stop.errands.map(errand => errand.item.id))));
    const locationErrands = $derived(errands.filter(errand => !isLocationOptionalErrand(errand) || locationIds.has(errand.item.id)));
    const plan = $derived(suggestStops(stops, locationErrands));
    const locationGroups = $derived(groupErrands(locationErrands.map(errand => ({ errand }))));
    const coveredCount = $derived(locationGroups.filter(group => group.rows.every(row => locationIds.has(row.errand.item.id))).length);

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
    function setGroupDone(id: string, done: boolean) {
        if (!commitState.isHistorical) updateList(id, { done });
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

    function saveHotSuburbs(ids: string[]) {
        if (commitState.isHistorical) return;
        saveHotSuburbIds(ids);
        showHotSuburbs = false;
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

{#snippet groupCheckbox(list: Errand['list'])}
    <input class="group-checkbox" type="checkbox" checked={list.done} disabled={commitState.isHistorical}
        aria-label={`Completed list: ${list.name}`} title="Complete this list; individual task checkboxes stay unchanged"
        onchange={(event) => setGroupDone(list.id, event.currentTarget.checked)} />
{/snippet}

{#snippet errandGroup(group: { id: string; list: Errand['list']; rows: { errand: Errand }[] }, children: Snippet)}
    {#if group.id.startsWith('list:') && group.rows.length > 1}
        <li class="group-row">{@render groupCheckbox(group.list)}<details class="errand-group"><summary><strong>{group.list.name}</strong><span>{errandPreview(group.rows.map(row => row.errand), previewLimit)}</span></summary>
            <ul>{@render children()}</ul>
        </details></li>
    {:else}
        {@render children()}
    {/if}
{/snippet}

{#snippet stopCard(stop: NearbyStop)}
                <article class="stop">
                    <div class="stop-heading"><div><h2>{stop.location.name}</h2><p>{distanceLabel(stop.distanceKm)} away{stop.location.address ? ' · ' + stop.location.address : ''}</p>{#if stop.location.coordinateAccuracy === 'shopping-centre'}<HelpText label="Help with shopping centre coordinates"><p>Distance and directions use the shopping centre location.</p></HelpText>{:else if stop.location.coordinateAccuracy === 'suburb'}<HelpText label="Help with approximate suburb coordinates"><p>Approximate suburb location. Check the destination before travelling.</p></HelpText>{/if}</div><a href={directions(stop.location)} target="_blank" rel="noopener noreferrer">Directions ↗</a></div>
                    <p class="match-count">{groupErrands(stop.errands.map(errand => ({ errand }))).length} errands · {stop.errands.length} tasks</p>
                    <ul class="errand-groups">{#each groupErrands(stop.errands.map(errand => ({ errand }))) as group (group.id)}
                        {#snippet errandRows()}
                            {#each group.rows as row (row.errand.item.id)}<li><button class="errand" onclick={() => onOpenItem(row.errand.list.id, row.errand.item.id)}><span>{row.errand.item.name}</span></button></li>{/each}
                        {/snippet}
                        {@render errandGroup(group, errandRows)}
                    {/each}</ul>
                    {#if !customIds.has(stop.location.id) && stop.location.source}<a class="source" href={stop.location.source} target="_blank" rel="noopener noreferrer">Location source ↗</a>{/if}
                </article>
{/snippet}

{#if showHotSuburbs}
    <HotSuburbsScreen initialIds={hotSuburbIds} onBack={() => showHotSuburbs = false} onSave={saveHotSuburbs} />
{:else}
<div class="nearby-screen">
    <header>
        <button class="back" onclick={onBack} aria-label="Back to lists">←</button>
        <h1>Nearby errands</h1>
        <button class="manage" onclick={() => showLocations = !showLocations}>{showLocations ? 'Errands' : 'Locations'}</button>
    </header>
    <main>
        {#if commitState.isHistorical}<p class="notice">Viewing historical todos and custom locations. Exit history to make changes.</p>{/if}
        <section class="nearby-strip" aria-labelledby="nearby-strip-heading">
            <h2 id="nearby-strip-heading"><button class="nearby-heading" title="Go to distance setting" onclick={scrollToRadius}>Nearby</button></h2>
            <select class="preview-limit" aria-label="Items per pill" title="Items per pill" value={previewLimit} onchange={setPreviewLimit} disabled={commitState.isHistorical}>{#each [1, 2, 3, 4, 5, 6, 7, 8, 9] as count}<option value={count}>{count}</option>{/each}</select>
            {#each nearbyPills as pill (pill.id)}
                <span class="nearby-pill">
                    {#if pill.id.startsWith('list:') && pill.errands.length > 1}{@render groupCheckbox(pill.list)}{/if}
                    <button class="nearby-pill-link" title={`${pill.list.name}: ${pill.name} ${pill.tags.map(tag => '#' + tag).join(' ')}`}
                        onclick={() => onOpenItem(pill.list.id, pill.errands[0].item.id)}>
                        <span class="nearby-pill-name">{pill.name}</span><span class="nearby-pill-tag">{pill.tags.map(tag => '#' + tag).join(' ')}</span>
                    </button>
                </span>
            {/each}
        </section>
        <section class="position">
            <div class="location-shortcuts">
                <button class="primary location-icon" onclick={useGps} disabled={locating || commitState.isHistorical}
                    aria-label={locating ? 'Finding your location…' : origin ? 'Update my location' : 'Use my location'}
                    title={locating ? 'Finding your location…' : origin ? 'Update my location' : 'Use my location'} aria-busy={locating}>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2" /><path d="M12 2v3m0 14v3M2 12h3m14 0h3" /></svg>
                </button>
                {#each hotSuburbs as suburb (suburb.id)}
                    <button class="suburb-shortcut" class:active={savedLocation?.source === 'suburb' && savedLocation.label === suburb.name}
                        aria-pressed={savedLocation?.source === 'suburb' && savedLocation.label === suburb.name}
                        disabled={commitState.isHistorical} title={`Start near ${suburb.name} centre`} onclick={() => selectSuburb(suburb)}>{suburb.name}</button>
                {/each}
                <button class="location-icon" disabled={commitState.isHistorical} onclick={() => showHotSuburbs = true} aria-label="Edit hot suburbs" title="Edit hot suburbs">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m16 3 5 5-12 12-6 1 1-6zM13 6l5 5" /></svg>
                </button>
            </div>
            <div class="location-details-controls">
                <HelpText label="Help with starting location"><p class="hint">Tap the location icon for GPS, or a suburb pill to use its centre. Your starting location and hot suburbs sync across your devices.</p></HelpText>
                {#if savedLocation}
                    <button class="location-details-toggle" onclick={() => showLocationDetails = !showLocationDetails}
                        aria-label={showLocationDetails ? 'Hide location details' : 'Show location details'}
                        title={showLocationDetails ? 'Hide location details' : 'Show location details'}
                        aria-expanded={showLocationDetails} aria-controls="starting-location-details">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d={showLocationDetails ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6'} /></svg>
                    </button>
                {/if}
            </div>
            {#if locationError}<p role="alert" class="error">{locationError}</p>{/if}
            <div id="starting-location-details" hidden={!showLocationDetails}>
                {#if origin}<p class="origin">{originLabel}{accuracy !== null ? ` · GPS accuracy approximately ${Math.round(accuracy)} m` : ''}</p>{/if}
                {#if savedLocation}<p class="hint">Last updated: {new Date(savedLocation.updatedAt).toLocaleString()}</p>{/if}
            </div>
        </section>


        {#if showLocations}
            <section class="custom">
                <h2>{editingId ? 'Edit location' : 'Add a location'}</h2>
                <HelpText label="Help with custom location hashtags"><p class="hint">Add any shop or place. Matching hashtags might be #postoffice, #pharmacy or #home. A #coles or #woolworths location also matches #supermarket automatically.</p></HelpText>
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
                <HelpText label="Help with saving locations"><p class="hint">Saved locations sync across your devices and are included in JSON backups.</p></HelpText>
                {#each customLocations as location (location.id)}
                    <article class="saved"><div><strong>{location.name}</strong><p>{location.tags.map(tag => '#' + tag).join(' ')} · {location.latitude.toFixed(5)}, {location.longitude.toFixed(5)}</p></div><div class="form-actions"><button disabled={commitState.isHistorical} onclick={() => editLocation(location)}>Edit</button><button disabled={commitState.isHistorical} onclick={() => deleteTarget = location}>Delete</button></div></article>
                {:else}<p class="hint">No custom locations yet.</p>{/each}
            </section>
        {:else}
            {#if pausedTags.length || pausedErrands.length}
                <details class="paused-errands">
                    <summary>Paused errands ({pausedGroups.length})</summary>
                    <HelpText label="Help with paused errands"><p class="hint">Resume individual errands below. Hashtag pauses apply to all tasks using that tag. Original tasks stay unchanged, and pauses sync across devices.</p></HelpText>
                    <div class="pause-actions">{#each pausedTags as tag (tag)}<button disabled={commitState.isHistorical} onclick={() => pauseTag(tag, false)}>Resume all #{tag} errands</button>{/each}</div>
                    <ul class="errand-groups">{#each pausedGroups as group (group.id)}
                        {#snippet errandRows()}
                            {#each group.rows as row (row.errand.item.id)}<li class="checklist-row"><button class="errand" onclick={() => onOpenItem(row.errand.list.id, row.errand.item.id)}><span>{row.errand.item.name}</span><small>{row.errand.list.name}</small>{#if isErrandPaused(row.errand, pausedTags)}<small>Paused by hashtag: {row.errand.tags.map(normalizeLocationTag).filter(tag => pausedTags.includes(tag)).map(tag => '#' + tag).join(', ')}</small>{/if}</button>{#if row.itemPaused}<button class="resume-task" disabled={commitState.isHistorical} onclick={() => pauseItem(row.errand.item.id, false)} aria-label={`Resume ${row.errand.item.name}`} title="Resume this errand"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4v16l14-8z" /></svg></button>{/if}</li>{/each}
                        {/snippet}
                        {@render errandGroup(group, errandRows)}
                    {:else}<li class="hint">No unfinished paused tasks.</li>{/each}</ul>
                </details>
            {/if}
            <section class="task-checklist" aria-labelledby="matched-tasks-heading">
                <div class="checklist-heading"><h2 id="matched-tasks-heading">Matched tasks ({checklistGroups.length})</h2>{#if completedChecklist.length}<button disabled={commitState.isHistorical} onclick={clearCompletedTasks}>Clear completed</button>{/if}</div>
                <HelpText label="Help with matched tasks"><p class="hint">Ticks update the original todos. Completed tasks stay until cleared. Dismissed notes and unchecked tasks return when edited; checked todos stay completed. Expand a grouped errand to manage its individual tasks. Tasks using inherited hashtags share an errand; tasks with their own errand hashtags stay separate. The group checkbox completes only its parent list and hides inherited tasks; individual task checkboxes stay unchanged. Tasks with their own errand hashtags remain visible. The count is the number of errands. This checklist syncs across devices. Use #bank for banking or #errand for general errands with no set location.</p></HelpText>
                <ul class="errand-groups">{#each checklistGroups as group (group.id)}
                    {#snippet errandRows()}
                        {#each group.rows as row (row.errand.item.id)}
                            <li class="checklist-row" class:completed={row.done}>
                                {#if row.errand.item.note}<span class="note-mark" aria-label="Note">📝</span>{:else}<input type="checkbox" checked={row.done} disabled={commitState.isHistorical} aria-label={`Completed: ${row.errand.item.name}`} onchange={(event) => setTaskDone(row.errand.item.id, event.currentTarget.checked)} />{/if}
                                <button class="errand" onclick={() => onOpenItem(row.errand.list.id, row.errand.item.id)}><span>{row.errand.item.name}</span><small>{row.errand.list.name}{row.errand.item.note ? ' · Note' : ''}</small>{#if !row.done && isLocationOptionalErrand(row.errand) && !locationIds.has(row.errand.item.id)}<small>{locationOptionalTag(row.errand) === 'bank' ? 'Choose a bank or ATM yourself' : 'Choose a location yourself'} · no saved location needed.</small>{:else if !row.done && origin && !nearbyIds.has(row.errand.item.id)}<small>{supportedIds.has(row.errand.item.id) ? `No match within ${radius} km.` : 'No matching location in the database.'}</small>{/if}</button>
                                {#if !row.done}<button class="pause-task" disabled={commitState.isHistorical} onclick={() => pauseItem(row.errand.item.id, true)} aria-label={`Pause ${row.errand.item.name}`} title="Pause this errand"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg></button>{/if}
                                <button class="dismiss-task" disabled={commitState.isHistorical} onclick={() => dismissTask(row.errand.item.id)} aria-label={`Dismiss from errands: ${row.errand.item.name}`} title="Dismiss from errands">×</button>
                            </li>
                        {/each}
                    {/snippet}
                    {@render errandGroup(group, errandRows)}
                {:else}<li class="hint">{pausedErrands.length ? 'Your remaining errands are paused. Expand Paused errands to resume them.' : 'No matched tasks. Add location hashtags to a todo, note or list name.'}</li>{/each}</ul>
            </section>
            <div class="filters" bind:this={radiusFilters}><label>Within <select bind:value={radius}>{#each [1, 2, 5, 10, 25, 50] as km}<option value={km}>{km} km</option>{/each}</select></label></div>
            {#if !origin}
                <p class="empty">Use your location or choose a starting suburb to see nearby errands.</p>
            {:else}
                <section class="suggestions" aria-labelledby="suggested-stops-heading">
                    <h2 id="suggested-stops-heading">Suggested stops</h2>
                    <p class="coverage" aria-live="polite">{coveredCount} of {locationGroups.length} errand{locationGroups.length === 1 ? '' : 's'} fully covered by {plan.suggested.length} stop{plan.suggested.length === 1 ? '' : 's'} within {radius} km.</p>
                    <HelpText label="Help with suggested stops"><p class="hint">A short set of shops covering all nearby matches, shown nearest first. Tasks using inherited hashtags are grouped by their parent list; tasks with their own errand hashtags stay separate. An errand is fully covered when every active task has a nearby match. Distances are straight-line distances.</p></HelpText>
                    {#if errands.length === 0}<p class="empty">{pausedErrands.length ? 'Your remaining errands are paused.' : 'Add location hashtags to an unchecked todo, note or list name to find places to go.'}</p>{/if}
                    {#each plan.suggested as stop (stop.location.id)}{@render stopCard(stop)}{/each}
                    {#if plan.unavailable.length}
                        <div class="unavailable">
                            <h3>Items without a nearby match ({groupErrands(plan.unavailable.map(errand => ({ errand }))).length})</h3>
                            <ul class="errand-groups">{#each groupErrands(plan.unavailable.map(errand => ({ errand }))) as group (group.id)}
                                {#snippet errandRows()}
                                    {#each group.rows as { errand } (errand.item.id)}<li>
                                        <button class="errand" onclick={() => onOpenItem(errand.list.id, errand.item.id)}><span>{errand.item.name}</span><small>{errand.list.name}{errand.item.note ? ' · Note' : ''}</small><small>{supportedIds.has(errand.item.id) ? `No match within ${radius} km. Try a larger radius.` : 'No matching location in the database. Add a place in Locations.'}</small></button>
                                    </li>{/each}
                                {/snippet}
                                {@render errandGroup(group, errandRows)}
                            {/each}</ul>
                        </div>
                    {/if}
                </section>
                {#if plan.alternatives.length}
                    <details class="alternatives" bind:open={showAlternatives}>
                        <summary>Alternatives ({plan.alternatives.length} other locations)</summary>
                        <HelpText label="Help with alternative stops"><p class="hint">Other shops matching your items, nearest first. These offer alternatives to the suggested stops.</p></HelpText>
                        {#if showAlternatives}{#each plan.alternatives as stop (stop.location.id)}{@render stopCard(stop)}{/each}{/if}
                    </details>
                {/if}
            {/if}
        {/if}
        <details class="available-tags">
            <summary>Available location hashtags</summary>
            <HelpText label="Help with location hashtags"><p class="hint">Add these hashtags to a list name to match its todos and notes, or tag individual items. Item errand hashtags take precedence over list hashtags. Unrelated hashtags such as #urgent still inherit the list’s errand hashtags. #bank and #errand keep tasks nearby without a saved location. Counts cover all locations in the database, including your saved places. #supermarket matches Coles, Woolworths and Aldi.</p></HelpText>
            <HelpText label="Help with suburb hashtags"><p class="hint">Melbourne suburbs are also available: #brunswick, #richmond or #brunswickeast. Suburb hashtags point to approximate suburb centres; remove spaces from multi-word names.</p></HelpText>
            <label class="tag-search">Find a location hashtag<input type="search" bind:value={tagQuery} placeholder="e.g. bunnings, brunswick or st kilda" /></label>
            {#if selectedTag}
                <section class="tag-locations" bind:this={tagLocationsPanel} aria-label={`Locations matching #${selectedTag}`}>
                    <div class="checklist-heading"><h2>#{selectedTag} · {selectedTagLocations.length} locations</h2><button aria-label="Close location list" onclick={() => selectedTag = null}>×</button></div>
                    <button disabled={commitState.isHistorical} onclick={() => { if (selectedTag) pauseTag(selectedTag, !pausedTags.includes(selectedTag)); }}>{pausedTags.includes(selectedTag) ? 'Resume all' : 'Pause all'} #{selectedTag} errands</button>
                    <ul class="tag-location-list">
                        {#each selectedTagLocations as location (location.id)}
                            <li><div><strong>{location.name}</strong>{#if location.address}<p>{location.address}</p>{/if}</div><a href={directions(location)} target="_blank" rel="noopener noreferrer" aria-label={`Directions to ${location.name}`}>Directions ↗</a></li>
                        {:else}<li class="hint">{LOCATION_OPTIONAL_TAGS.includes(selectedTag) ? 'Choose the destination yourself. These tasks appear nearby without saved locations.' : 'No locations for this hashtag.'}</li>{/each}
                    </ul>
                </section>
            {/if}
            <ul class="tag-list">
                {#each visibleTags as entry (entry.tag)}
                    <li><button class:chosen={selectedTag === entry.tag} aria-pressed={selectedTag === entry.tag} onclick={() => selectTag(entry.tag)}><strong>#{entry.tag}</strong><span>{#if LOCATION_OPTIONAL_TAGS.includes(entry.tag) && entry.count === 0}No location needed{:else}{entry.count} location{entry.count === 1 ? '' : 's'}{/if}</span></button></li>
                {:else}<li>{availableTags.length ? 'No matching hashtags.' : 'No location hashtags yet. Add a place in Locations.'}</li>{/each}
            </ul>
            {#if !tagQuery.trim() && availableTags.length > 12}<button onclick={() => showAllTags = !showAllTags}>{showAllTags ? 'Show fewer hashtags' : `Show all ${availableTags.length} hashtags`}</button>{/if}
            <HelpText label="Help with tagging tasks and lists"><p class="hint">For example: name a list “Shopping #supermarket”, or tag one item “Buy milk #coles”. New location hashtags appear here automatically.</p></HelpText>
        </details>
        <footer>{catalogue.locations.length} pre-recorded Melbourne locations · <a href={catalogue.source} target="_blank" rel="noopener noreferrer">{catalogue.attribution}</a> · <a href={catalogue.licenseUrl} target="_blank" rel="noopener noreferrer">{catalogue.license}</a><p>Catalogue retrieved: {catalogue.retrievedAt}. Store openings and closures may need manual updates.</p><p>{suburbLocations.length} suburb centres · <a href={suburbCatalogue.source} target="_blank" rel="noopener noreferrer">{suburbCatalogue.attribution}</a> · <a href={suburbCatalogue.licenseUrl} target="_blank" rel="noopener noreferrer">{suburbCatalogue.license}</a></p></footer>
    </main>
</div>
{#if deleteTarget}<ConfirmDialog message={`Delete “${deleteTarget.name}”?`} confirmLabel="Delete" isDanger={true} onConfirm={removeLocation} onCancel={() => deleteTarget = null} />{/if}

{/if}

<style>
    .nearby-screen { position: fixed; inset: 0; display: flex; flex-direction: column; background: var(--bg); color: var(--text); }
    header { display: flex; align-items: center; gap: .75rem; padding: .65rem .8rem; border-bottom: 1px solid var(--border); flex-shrink: 0; }
    h1 { font-size: 1.15rem; margin: 0; flex: 1; } h2 { font-size: 1rem; margin: 0 0 .4rem; }
    main { overflow-y: auto; padding: 1rem; padding-bottom: max(1rem, env(safe-area-inset-bottom)); flex: 1; }
    main > * { max-width: 760px; margin-left: auto; margin-right: auto; }
    .location-shortcuts { display: flex; flex-wrap: wrap; align-items: center; gap: .4rem; }
    .location-details-controls { position: relative; display: flow-root; }
    .location-details-toggle { position: absolute; top: .4rem; left: 44px; display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; padding: 0; border-radius: 50%; background: #000; color: var(--text2); }
    .location-details-toggle:hover { color: var(--accent); border-color: var(--accent); }
    .location-icon { display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 44px; }
    .suburb-shortcut { border-radius: 999px; background: #000; padding: .45rem .75rem; }
    .suburb-shortcut.active { border-color: var(--accent); color: var(--accent); }
    .nearby-strip { display: flex; flex-wrap: wrap; align-items: center; gap: .4rem; margin-bottom: .8rem; padding-bottom: .2rem; }
    .nearby-strip h2 { margin: 0; flex-shrink: 0; }
    .nearby-strip .preview-limit { width: auto; flex-shrink: 0; padding: .35rem; }
    .nearby-heading { border: 0; background: transparent; padding: 0; font: inherit; color: inherit; }
    .nearby-pill { display: inline-flex; align-items: center; gap: .35rem; max-width: 100%; min-width: 0; background: #000; border: 1px solid var(--border); border-radius: 999px; padding: .35rem .65rem; white-space: nowrap; }
    .nearby-pill-link { display: inline-flex; align-items: center; gap: .35rem; min-width: 0; padding: 0; border: 0; background: transparent; }
    .nearby-pill-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .nearby-pill-tag { color: var(--accent); flex-shrink: 0; max-width: 45%; overflow: hidden; text-overflow: ellipsis; }
    button, select, input { font: inherit; color: var(--text); border: 1px solid var(--border); background: var(--bg2); border-radius: 6px; padding: .65rem; }
    button, select { cursor: pointer; } button:disabled { opacity: .5; cursor: default; }
    .back { border: 0; font-size: 1.35rem; padding: .3rem .6rem; } .primary { background: var(--accent); color: #fff; border-color: var(--accent); }
    label { display: flex; flex-direction: column; gap: .4rem; margin: .7rem 0; } select, input { width: 100%; min-width: 0; }
    .hint, .origin, footer, small { font-size: .85rem; color: var(--text2); line-height: 1.5; }
    .error { color: #dc2626; } .notice, .empty { padding: 1rem; border-radius: 6px; background: var(--bg2); }
    .filters, .stop-heading, .saved { display: flex; align-items: center; justify-content: space-between; gap: .8rem; }
    .filters { flex-wrap: wrap; }
    .filters label { flex-direction: row; align-items: center; } .filters select { width: auto; }
    .group-row { display: flex; align-items: flex-start; gap: .5rem; }
    .group-row .errand-group { flex: 1; min-width: 0; }
    .group-checkbox { width: 22px; height: 22px; flex-shrink: 0; margin: 0; padding: 0; accent-color: var(--accent); cursor: pointer; }
    .group-row > .group-checkbox { margin: .85rem 8px 0; }
    .errand-group > summary { display: flex; align-items: center; gap: .5rem; min-width: 0; }
    .errand-group > summary::before { content: "▸"; flex-shrink: 0; }
    .errand-group[open] > summary::before { content: "▾"; }
    .errand-group > summary::-webkit-details-marker { display: none; }
    .errand-group > summary strong { flex-shrink: 0; max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .errand-group > summary span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: normal; }
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
    .pause-task, .dismiss-task { width: 44px; height: 44px; flex-shrink: 0; font-size: 1.4rem; border: 0; background: transparent; }
    .resume-task { display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 44px; flex-shrink: 0; padding: 0; background: #000; }
    .pause-task { display: flex; align-items: center; justify-content: center; }
    .completed .errand > span { text-decoration: line-through; color: var(--text2); }
    .pause-actions { display: flex; flex-wrap: wrap; gap: .5rem; }
    .paused-errands { margin: 1rem auto; border: 1px solid var(--border); border-radius: 8px; padding: 0 .8rem .8rem; }
    .available-tags, .alternatives { margin-top: 1.2rem; }
    summary { cursor: pointer; padding: .75rem 0; font-weight: 600; }
    .coverage { font-weight: 600; line-height: 1.5; }
    .match-count { color: var(--accent); font-size: .85rem; margin: .6rem 0 0; }
    .unavailable { border: 1px solid var(--border); border-radius: 8px; background: #000; padding: .8rem; margin: .8rem 0; }
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
