import catalogue from './locations/melbourne-suburbs.json';

export const suburbById = new Map(catalogue.suburbs.map(suburb => [suburb.id, suburb]));
export const defaultHotSuburbIds = ['Melbourne', 'Brunswick', 'Richmond'].map(name =>
    catalogue.suburbs.find(suburb => suburb.name === name)!.id);

export function isHotSuburbIds(value: unknown): value is string[] {
    return Array.isArray(value) && value.every(id => typeof id === 'string' && suburbById.has(id)) &&
        new Set(value).size === value.length;
}
