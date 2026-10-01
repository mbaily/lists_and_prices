import catalogue from './locations/melbourne-suburbs.json';
import type { RetailLocation } from './retailLocations';

/** Suburb hashtags point to approximate centres, independently of retailers. */
export const suburbLocations: RetailLocation[] = catalogue.suburbs.map(suburb => ({
    id: `suburb-${suburb.id}`,
    name: `${suburb.name} (suburb centre)`,
    tags: [suburb.name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')],
    latitude: suburb.latitude,
    longitude: suburb.longitude,
    coordinateAccuracy: 'suburb',
    source: catalogue.source
}));
