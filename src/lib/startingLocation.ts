import { validCoordinates, type Coordinates } from './retailLocations';

export interface StartingLocation extends Coordinates {
    source: 'gps' | 'suburb' | 'custom';
    /** Stable reference to a saved place when source is custom. */
    customLocationId?: string;
    label: string;
    updatedAt: string;
    accuracy: number | null;
}

export function isStartingLocation(value: unknown): value is StartingLocation {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const location = value as StartingLocation;
    return validCoordinates(location) && (location.source === 'gps' || location.source === 'suburb' || location.source === 'custom') &&
        (location.source !== 'custom' || (typeof location.customLocationId === 'string' && location.customLocationId.startsWith('custom-') && location.customLocationId.length > 7)) &&
        typeof location.label === 'string' && !!location.label.trim() &&
        typeof location.updatedAt === 'string' && Number.isFinite(Date.parse(location.updatedAt)) &&
        (location.accuracy === null || (typeof location.accuracy === 'number' && Number.isFinite(location.accuracy) && location.accuracy >= 0));
}
