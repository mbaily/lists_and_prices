import type { Errand, NearbyStop } from './nearbyErrands';
import { locationOptionalTag } from './nearbyErrands';
import { matchingLocationTags } from './retailLocations';
import { errandPreview, groupErrandsByList } from './errandGroups';

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
        const tag = locationOptionalTag(errand);
        if (!tag) continue;
        const name = errand.item.name.replace(/(^|\s)#\w+/g, '$1').replace(/\s+/g, ' ').trim();
        pills.set(errand.item.id, { errand, name, tag });
    }
    return [...pills.values()];
}

/** A nearby list is one errand, with a preview of its active todos and notes. */
export function nearbyListPills(stops: readonly NearbyStop[], errands: readonly Errand[], limit: number) {
    const matches = nearbyTaskPills(stops, errands);
    const tagsByList = new Map<string, Set<string>>();
    for (const match of matches) {
        if (!tagsByList.has(match.errand.list.id)) tagsByList.set(match.errand.list.id, new Set());
        tagsByList.get(match.errand.list.id)!.add(match.tag);
    }
    return groupErrandsByList(errands.filter(errand => tagsByList.has(errand.list.id)).map(errand => ({ errand })))
        .map(group => ({
            list: group.list,
            errands: group.rows.map(row => row.errand),
            name: errandPreview(group.rows.map(row => row.errand), limit),
            tags: [...tagsByList.get(group.list.id)!]
        }));
}
