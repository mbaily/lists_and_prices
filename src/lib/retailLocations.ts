import brandAliases from './locations/brand-aliases.json';

export interface Coordinates { latitude: number; longitude: number }
export interface RetailLocation extends Coordinates {
    id: string;
    name: string;
    tags: string[];
    /** Opt in a custom location to the starting-point pills. */
    startingPoint?: boolean;
    address?: string;
    source?: string;
    coordinateAccuracy?: 'store' | 'shopping-centre' | 'suburb';
    centre?: string;
}

export const LOCATION_ALIASES: Record<string, string> = { ...brandAliases, wooloworths: 'woolworths', woolworth: 'woolworths', woolies: 'woolworths' };

export function normalizeLocationTag(tag: string): string {
    const normalized = tag.trim().replace(/^#/, '').toLowerCase();
    return Object.hasOwn(LOCATION_ALIASES, normalized) ? LOCATION_ALIASES[normalized] : normalized;
}

export function validCoordinates(value: Coordinates): boolean {
    return Number.isFinite(value.latitude) && Math.abs(value.latitude) <= 90 &&
        Number.isFinite(value.longitude) && Math.abs(value.longitude) <= 180;
}

export function validateLocations(value: unknown): asserts value is RetailLocation[] {
    if (!Array.isArray(value)) throw new Error('Locations must be an array.');
    const ids = new Set<string>();
    for (const location of value) {
        if (!location || typeof location !== 'object' || typeof location.id !== 'string' || !location.id.trim() || ids.has(location.id) ||
            typeof location.name !== 'string' || !location.name.trim() || !validCoordinates(location) ||
            !Array.isArray(location.tags) || location.tags.length === 0 || location.tags.some((tag: unknown) => typeof tag !== 'string' || !/^#?\w+$/.test(tag)) ||
            (location.address !== undefined && typeof location.address !== 'string') ||
            (location.source !== undefined && typeof location.source !== 'string') ||
            (location.centre !== undefined && typeof location.centre !== 'string') ||
            (location.startingPoint !== undefined && typeof location.startingPoint !== 'boolean') ||
            (location.coordinateAccuracy !== undefined && !['store', 'shopping-centre', 'suburb'].includes(location.coordinateAccuracy))) {
            throw new Error('Each location needs a unique id, name, tags and valid latitude/longitude.');
        }
        ids.add(location.id);
    }
}

/** Great-circle distance, not driving/walking distance. */
export function distanceKm(a: Coordinates, b: Coordinates): number {
    const radians = (degrees: number) => degrees * Math.PI / 180;
    const dLat = radians(b.latitude - a.latitude), dLon = radians(b.longitude - a.longitude);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(dLon / 2) ** 2;
    return 6371.0088 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}

function supportedLocationTags(location: RetailLocation): Set<string> {
    const available = new Set(location.tags.map(normalizeLocationTag));
    if (available.has('coles') || available.has('woolworths') || available.has('aldi')) available.add('supermarket');
    if (available.has('bunnings') || available.has('mitre10') || available.has('homehardware')) available.add('hardware');
    if (['scorptec', 'centrecom', 'cpl', 'msy'].some(tag => available.has(tag))) available.add('pcparts');
    return available;
}

/** All supported hashtags, including derived supermarket matches, across the database. */
export function availableLocationTags(locations: readonly RetailLocation[]): { tag: string; count: number }[] {
    const matches = new Map<string, Set<string>>();
    for (const location of locations) {
        for (const tag of supportedLocationTags(location)) {
            if (!matches.has(tag)) matches.set(tag, new Set());
            matches.get(tag)!.add(location.id);
        }
    }
    return [...matches].map(([tag, ids]) => ({ tag, count: ids.size }))
        .sort((a, b) => a.tag.localeCompare(b.tag));
}

export function matchingLocationTags(itemTags: string[], location: RetailLocation): string[] {
    const available = supportedLocationTags(location);
    return [...new Set(itemTags.map(normalizeLocationTag))].filter(tag => available.has(tag));
}
