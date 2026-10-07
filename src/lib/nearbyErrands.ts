import { isItemDone, isListEffectivelyArchived, readCustomLocations, type Item, type ListMeta, type Folder } from './data';
import { extractTags } from './tags';
import { availableLocationTags, distanceKm, matchingLocationTags, normalizeLocationTag, validCoordinates, type Coordinates, type RetailLocation } from './retailLocations';
import catalogue from './locations/melbourne.json';
import { suburbLocations } from './suburbLocations';
import { buildItemTreeOrder } from './hierarchy';

export interface Errand { item: Item; list: ListMeta; tags: string[]; inheritsListTags?: boolean }
export interface NearbyStop { location: RetailLocation; distanceKm: number | null; errands: Errand[] }
export interface SuggestedStops { suggested: NearbyStop[]; alternatives: NearbyStop[]; unavailable: Errand[] }

export const LOCATION_OPTIONAL_TAGS = ['bank', 'errand'];

export function locationOptionalTag(errand: Errand): string | undefined {
    return errand.tags.map(normalizeLocationTag).find(tag => LOCATION_OPTIONAL_TAGS.includes(tag));
}

/** General and banking errands work without a saved destination. */
export function isLocationOptionalErrand(errand: Errand): boolean {
    return locationOptionalTag(errand) !== undefined;
}

/** Individual pauses and hashtag-wide pauses are independent. */
export function isErrandPaused(errand: Errand, pausedTags: readonly string[], pausedItemIds: readonly string[] = []): boolean {
    if (pausedItemIds.length > 0 && pausedItemIds.includes(errand.item.id)) return true;
    const paused = new Set(pausedTags.map(normalizeLocationTag));
    return errand.tags.some(tag => paused.has(normalizeLocationTag(tag)));
}

function compareStops(a: NearbyStop, b: NearbyStop): number {
    if (a.distanceKm !== null || b.distanceKm !== null) {
        return (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity) || a.location.id.localeCompare(b.location.id);
    }
    return a.location.name.localeCompare(b.location.name) || a.location.id.localeCompare(b.location.id);
}

/** Greedy item coverage, then distance (or name without an origin). */
export function suggestStops(stops: NearbyStop[], errands: Errand[]): SuggestedStops {
    const reachable = new Set(stops.flatMap(stop => stop.errands.map(errand => errand.item.id)));
    const uncovered = new Set(reachable);
    const selected: NearbyStop[] = [];
    while (uncovered.size) {
        let best: NearbyStop | undefined;
        let bestCount = 0;
        for (const stop of stops) {
            const count = new Set(stop.errands.filter(errand => uncovered.has(errand.item.id)).map(errand => errand.item.id)).size;
            if (count > bestCount || (count === bestCount && count > 0 && best && compareStops(stop, best) < 0)) {
                best = stop;
                bestCount = count;
            }
        }
        if (!best) break;
        selected.push(best);
        for (const errand of best.errands) uncovered.delete(errand.item.id);
    }
    // Later choices can make an earlier stop unnecessary. Keep coverage while removing it.
    for (let i = selected.length - 1; i >= 0; i--) {
        const others = new Set(selected.filter((_, index) => index !== i).flatMap(stop => stop.errands.map(errand => errand.item.id)));
        if (selected[i].errands.every(errand => others.has(errand.item.id))) selected.splice(i, 1);
    }
    const assigned = new Set<string>();
    const suggested = [...selected].sort(compareStops).map(stop => ({
        ...stop,
        errands: stop.errands.filter(errand => {
            if (assigned.has(errand.item.id)) return false;
            assigned.add(errand.item.id);
            return true;
        })
    }));
    const selectedIds = new Set(selected.map(stop => stop.location.id));
    return {
        suggested,
        alternatives: stops.filter(stop => !selectedIds.has(stop.location.id)).sort(compareStops),
        unavailable: errands.filter(errand => !reachable.has(errand.item.id))
    };
}

const defaultLocations: RetailLocation[] = [...catalogue.locations, ...suburbLocations];

/** Item errand tags take precedence; unrelated tags still inherit list tags. */
export function collectErrands(items: Item[], lists: ListMeta[], folders: Folder[], includeCompleted = false, locations: readonly RetailLocation[] = [...defaultLocations, ...readCustomLocations()]): Errand[] {
    const errandTags = new Set([...LOCATION_OPTIONAL_TAGS, ...availableLocationTags(locations).map(entry => entry.tag)]);
    const availableLists = new Map(lists.filter(list => list.type !== 'divider' && !isListEffectivelyArchived(list, folders)).map(list => [list.id, list]));
    const folderMap = new Map(folders.map(folder => [folder.id, folder]));
    const itemsByList = new Map<string, Item[]>();
    for (const item of items) {
        const siblings = itemsByList.get(item.listId) ?? [];
        siblings.push(item);
        itemsByList.set(item.listId, siblings);
    }
    // Use the full tree before removing headings or completed parents, so
    // surviving children retain their position in the source list.
    const orderedItems = [...itemsByList.values()].flatMap(listItems => buildItemTreeOrder(listItems).map(row => row.item));
    return orderedItems.flatMap(item => {
        const list = availableLists.get(item.listId);
        if (!list || item.heading || (!includeCompleted && !item.note && isItemDone(item, folderMap.get(list.folderId)))) return [];
        const itemTags = extractTags(item.name);
        const inheritsListTags = !itemTags.some(tag => errandTags.has(normalizeLocationTag(tag)));
        // Completing a parent list hides its inherited errand, not explicitly tagged tasks.
        if (list.done && inheritsListTags) return [];
        const tags = inheritsListTags ? [...new Set([...itemTags, ...extractTags(list.name)])] : itemTags;
        return tags.length ? [{ item, list, tags, inheritsListTags }] : [];
    });
}

/** A null origin matches destinations without any location or radius filter. */
export function nearbyStops(locations: RetailLocation[], origin: Coordinates | null, radiusKm: number, errands: Errand[]): NearbyStop[] {
    if (origin !== null && (!validCoordinates(origin) || !Number.isFinite(radiusKm) || radiusKm <= 0)) return [];
    return locations.flatMap(location => {
        if (!validCoordinates(location)) return [];
        const distance = origin === null ? null : distanceKm(origin, location);
        if (distance !== null && distance > radiusKm) return [];
        const matches = errands.filter(errand => matchingLocationTags(errand.tags, location).length > 0);
        return matches.length ? [{ location, distanceKm: distance, errands: matches }] : [];
    }).sort(compareStops);
}
