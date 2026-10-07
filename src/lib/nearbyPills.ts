import type { Errand, NearbyStop } from './nearbyErrands';
import { locationOptionalTag } from './nearbyErrands';
import { matchingLocationTags } from './retailLocations';
import { errandPreview, errandGroupId, groupErrands } from './errandGroups';

/** One pill per task, labelled with its first tag at a matching stop. */
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

/** Inherited tags share a pill; explicitly tagged tasks each have their own. */
export function nearbyListPills(stops: readonly NearbyStop[], errands: readonly Errand[], limit: number) {
    const matches = nearbyTaskPills(stops, errands);
    const tagsByGroup = new Map<string, Set<string>>();
    for (const match of matches) {
        const id = errandGroupId(match.errand);
        if (!tagsByGroup.has(id)) tagsByGroup.set(id, new Set());
        tagsByGroup.get(id)!.add(match.tag);
    }
    return groupErrands(errands.filter(errand => tagsByGroup.has(errandGroupId(errand))).map(errand => ({ errand })))
        .map(group => ({
            id: group.id,
            list: group.list,
            errands: group.rows.map(row => row.errand),
            name: errandPreview(group.rows.map(row => row.errand), limit),
            tags: [...tagsByGroup.get(group.id)!]
        }));
}
