import type { Errand, NearbyStop } from './nearbyErrands';
import { locationOptionalTag } from './nearbyErrands';
import { matchingLocationTags, normalizeLocationTag } from './retailLocations';
import { errandPreview, errandGroupId, groupErrands } from './errandGroups';

/** Keep matching tags in place; append labels only for tags absent from the preview. */
export function nearbyPillSegments(name: string, tags: readonly string[]): { text: string; matched: boolean }[] {
    const matching = new Set(tags.map(normalizeLocationTag));
    const inline = new Set<string>();
    const segments: { text: string; matched: boolean }[] = [];
    let last = 0;
    for (const match of name.matchAll(/(?<=^|\s)#\w+/g)) {
        const tag = normalizeLocationTag(match[0]);
        if (!matching.has(tag)) continue;
        if (match.index > last) segments.push({ text: name.slice(last, match.index), matched: false });
        segments.push({ text: match[0], matched: true });
        inline.add(tag);
        last = match.index + match[0].length;
    }
    if (last < name.length) segments.push({ text: name.slice(last), matched: false });
    for (const tag of matching) {
        if (inline.has(tag)) continue;
        if (segments.length) segments.push({ text: ' ', matched: false });
        segments.push({ text: '#' + tag, matched: true });
    }
    return segments;
}

/** One pill per task, labelled with its first tag at a matching stop. */
export function nearbyTaskPills(stops: readonly NearbyStop[], errands: readonly Errand[] = []): { errand: Errand; name: string; tag: string }[] {
    const pills = new Map<string, { errand: Errand; name: string; tag: string }>();
    for (const stop of stops) {
        for (const errand of stop.errands) {
            if (pills.has(errand.item.id)) continue;
            const tag = matchingLocationTags(errand.tags, stop.location)[0];
            if (!tag) continue;
            const name = errand.item.name.replace(/\s+/g, ' ').trim();
            pills.set(errand.item.id, { errand, name, tag });
        }
    }
    for (const errand of errands) {
        const tag = locationOptionalTag(errand);
        if (!tag) continue;
        const name = errand.item.name.replace(/\s+/g, ' ').trim();
        pills.set(errand.item.id, { errand, name, tag });
    }
    return [...pills.values()];
}

/** Inherited tags share a pill; explicitly tagged tasks each have their own. */
export function nearbyListPills(stops: readonly NearbyStop[], errands: readonly Errand[], limit: number, recentlyModifiedFirst = false) {
    const matches = nearbyTaskPills(stops, errands);
    const tagsByGroup = new Map<string, Set<string>>();
    for (const match of matches) {
        const id = errandGroupId(match.errand);
        if (!tagsByGroup.has(id)) tagsByGroup.set(id, new Set());
        tagsByGroup.get(id)!.add(match.tag);
    }
    for (const stop of stops) {
        for (const errand of stop.errands) {
            const tags = tagsByGroup.get(errandGroupId(errand));
            for (const tag of matchingLocationTags(errand.tags, stop.location)) tags?.add(tag);
        }
    }
    const pills = groupErrands(errands.filter(errand => tagsByGroup.has(errandGroupId(errand))).map(errand => ({ errand })))
        .map(group => ({
            id: group.id,
            list: group.list,
            errands: group.rows.map(row => row.errand),
            name: errandPreview(group.rows.map(row => row.errand), limit),
            tags: [...tagsByGroup.get(group.id)!]
        }));
    if (!recentlyModifiedFirst) return pills;
    // Move whole source lists so their pills and previews retain source order.
    const sourceLists = new Map<string, { pills: typeof pills; modifiedAt: number }>();
    for (const pill of pills) {
        let source = sourceLists.get(pill.list.id);
        if (!source) {
            source = { pills: [], modifiedAt: -Infinity };
            sourceLists.set(pill.list.id, source);
        }
        source.pills.push(pill);
        source.modifiedAt = pill.errands.reduce((latest, errand) => {
            const timestamp = Date.parse(errand.item.updatedAt ?? '');
            return Number.isFinite(timestamp) ? Math.max(latest, timestamp) : latest;
        }, source.modifiedAt);
    }
    const orderedLists = [...sourceLists.values()].sort((a, b) => b.modifiedAt - a.modifiedAt || 0);
    return orderedLists.flatMap(source => source.pills);
}
