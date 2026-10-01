import { isItemDone, isListEffectivelyArchived, type Item, type ListMeta, type Folder } from './data';
import { extractTags } from './tags';
import { distanceKm, matchingLocationTags, normalizeLocationTag, validCoordinates, type Coordinates, type RetailLocation } from './retailLocations';

export interface Errand { item: Item; list: ListMeta; tags: string[] }
export interface NearbyStop { location: RetailLocation; distanceKm: number; errands: Errand[] }
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

/** Greedy item coverage, then distance. Every reachable item gets one suggested stop. */
export function suggestStops(stops: NearbyStop[], errands: Errand[]): SuggestedStops {
    const reachable = new Set(stops.flatMap(stop => stop.errands.map(errand => errand.item.id)));
    const uncovered = new Set(reachable);
    const selected: NearbyStop[] = [];
    const nearestFirst = (a: NearbyStop, b: NearbyStop) => a.distanceKm - b.distanceKm || a.location.id.localeCompare(b.location.id);
    while (uncovered.size) {
        let best: NearbyStop | undefined;
        let bestCount = 0;
        for (const stop of stops) {
            const count = new Set(stop.errands.filter(errand => uncovered.has(errand.item.id)).map(errand => errand.item.id)).size;
            if (count > bestCount || (count === bestCount && count > 0 && best && nearestFirst(stop, best) < 0)) {
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
    const suggested = [...selected].sort(nearestFirst).map(stop => ({
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
        alternatives: stops.filter(stop => !selectedIds.has(stop.location.id)).sort(nearestFirst),
        unavailable: errands.filter(errand => !reachable.has(errand.item.id))
    };
}

/** Item tags take precedence; otherwise inherit the list's tags. */
export function collectErrands(items: Item[], lists: ListMeta[], folders: Folder[], includeCompleted = false): Errand[] {
    const availableLists = new Map(lists.filter(list => !list.done && list.type !== 'divider' && !isListEffectivelyArchived(list, folders)).map(list => [list.id, list]));
    const folderMap = new Map(folders.map(folder => [folder.id, folder]));
    return items.flatMap(item => {
        const list = availableLists.get(item.listId);
        if (!list || item.heading || (!includeCompleted && !item.note && isItemDone(item, folderMap.get(list.folderId)))) return [];
        const itemTags = extractTags(item.name);
        const tags = itemTags.length ? itemTags : extractTags(list.name);
        return tags.length ? [{ item, list, tags }] : [];
    });
}

export function nearbyStops(locations: RetailLocation[], origin: Coordinates, radiusKm: number, errands: Errand[]): NearbyStop[] {
    if (!validCoordinates(origin) || !Number.isFinite(radiusKm) || radiusKm <= 0) return [];
    return locations.flatMap(location => {
        if (!validCoordinates(location)) return [];
        const distance = distanceKm(origin, location);
        if (distance > radiusKm) return [];
        const matches = errands.filter(errand => matchingLocationTags(errand.tags, location).length > 0);
        return matches.length ? [{ location, distanceKm: distance, errands: matches }] : [];
    }).sort((a, b) => a.distanceKm - b.distanceKm || a.location.id.localeCompare(b.location.id));
}
