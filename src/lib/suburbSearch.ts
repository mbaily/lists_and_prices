import type { Coordinates } from './retailLocations';

export interface Suburb extends Coordinates { id: string; name: string }

function normalize(value: string): string {
    return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
        .replace(/\bmt\.?\s+/g, 'mount ').replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Edit distance to the closest substring, including adjacent transposed letters. */
function fuzzyDistance(query: string, name: string): number {
    let previous = Array<number>(name.length + 1).fill(0);
    let beforePrevious = previous;
    for (let i = 1; i <= query.length; i++) {
        const row = [i];
        for (let j = 1; j <= name.length; j++) {
            row[j] = Math.min(row[j - 1] + 1, previous[j] + 1,
                previous[j - 1] + (query[i - 1] === name[j - 1] ? 0 : 1));
            if (i > 1 && j > 1 && query[i - 1] === name[j - 2] && query[i - 2] === name[j - 1]) {
                row[j] = Math.min(row[j], beforePrevious[j - 2] + 1);
            }
        }
        beforePrevious = previous;
        previous = row;
    }
    return Math.min(...previous);
}

/** Prefer exact names, then prefixes and substrings, then spelling approximations. */
export function searchSuburbs(suburbs: readonly Suburb[], input: string, limit = 8): Suburb[] {
    const query = normalize(input);
    if (!query || limit <= 0) return [];
    const tolerance = query.length < 3 ? 0 : Math.min(3, Math.floor(query.length / 4) || 1);
    return suburbs.flatMap(suburb => {
        const name = normalize(suburb.name);
        let score: number;
        if (name === query) score = 0;
        else if (name.startsWith(query)) score = 1;
        else if (name.includes(query)) score = 2;
        else {
            if (!tolerance) return [];
            const distance = fuzzyDistance(query, name);
            if (distance > tolerance) return [];
            score = 3 + distance;
        }
        return [{ suburb, score }];
    }).sort((a, b) => a.score - b.score || a.suburb.name.length - b.suburb.name.length ||
        a.suburb.name.localeCompare(b.suburb.name) || a.suburb.id.localeCompare(b.suburb.id))
        .slice(0, limit).map(result => result.suburb);
}
