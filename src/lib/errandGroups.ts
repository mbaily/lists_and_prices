import type { Errand } from './nearbyErrands';
import type { ListMeta } from './data';
import { extractTags } from './tags';

/** Only tasks using inherited tags share their parent list's errand. */
export function errandGroupId(errand: Errand): string {
    return extractTags(errand.item.name).length ? `item:${errand.item.id}` : `list:${errand.list.id}`;
}

export function groupErrands<T extends { errand: Errand }>(rows: readonly T[]): { id: string; list: ListMeta; rows: T[] }[] {
    const groups = new Map<string, { id: string; list: ListMeta; rows: T[] }>();
    for (const row of rows) {
        const id = errandGroupId(row.errand);
        let group = groups.get(id);
        if (!group) {
            group = { id, list: row.errand.list, rows: [] };
            groups.set(id, group);
        }
        group.rows.push(row);
    }
    return [...groups.values()];
}

export function errandPreview(errands: readonly Errand[], limit: number): string {
    const names = errands.slice(0, limit).map(errand => errand.item.name
        .replace(/(^|\s)#\w+/g, '$1').replace(/\s+/g, ' ').trim()).filter(Boolean);
    const remaining = errands.length - Math.min(errands.length, limit);
    return names.join(' · ') + (remaining > 0 ? ` · +${remaining} more` : '');
}
