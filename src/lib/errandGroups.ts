import type { Errand } from './nearbyErrands';
import type { ListMeta } from './data';

export function groupErrandsByList<T extends { errand: Errand }>(rows: readonly T[]): { list: ListMeta; rows: T[] }[] {
    const groups = new Map<string, { list: ListMeta; rows: T[] }>();
    for (const row of rows) {
        let group = groups.get(row.errand.list.id);
        if (!group) {
            group = { list: row.errand.list, rows: [] };
            groups.set(group.list.id, group);
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
