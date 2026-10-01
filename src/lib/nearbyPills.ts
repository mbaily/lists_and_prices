import type { Errand, NearbyStop } from './nearbyErrands';
import { isLocationOptionalErrand } from './nearbyErrands';
import { matchingLocationTags } from './retailLocations';

/** One pill per task, labelled with its first matching tag at the nearest stop. */
export function nearbyTaskPills(stops: readonly NearbyStop[], errands: readonly Errand[] = []): { errand: Errand; name: string; tag: string }[] {
    const pills = new Map<string, { errand: Errand; name: string; tag: string }>();
    for (const stop of stops) {
        for (const errand of stop.errands) {
            if (pills.has(errand.item.id)) continue;
            const tag = matchingLocationTags(errand.tags, stop.location)[0];
            if (!tag) continue;
            const name = errand.item.name.replace(/(^|\s)#\w+/g, '$1').replace(/\s+/g, ' ').trim();
            pills.set(errand.item.id, { errand, name, tag });
        }
    }
    for (const errand of errands) {
        if (!isLocationOptionalErrand(errand)) continue;
        const name = errand.item.name.replace(/(^|\s)#\w+/g, '$1').replace(/\s+/g, ' ').trim();
        pills.set(errand.item.id, { errand, name, tag: 'bank' });
    }
    return [...pills.values()];
}
