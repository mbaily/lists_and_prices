#!/usr/bin/env python3
"""Refresh offline suburb centres. Requires requests and shapely (collection only)."""
import datetime
import json
from pathlib import Path

import requests
from shapely.geometry import shape
from shapely.ops import unary_union

SERVICE = 'https://services-ap1.arcgis.com/P744lA0wf4LlBZ84/ArcGIS/rest/services/Vicmap_Admin/FeatureServer'
COUNCILS = sorted('BANYULE,BAYSIDE,BOROONDARA,BRIMBANK,CARDINIA,CASEY,DAREBIN,FRANKSTON,GLEN EIRA,GREATER DANDENONG,HOBSONS BAY,HUME,KINGSTON,KNOX,MANNINGHAM,MARIBYRNONG,MAROONDAH,MELBOURNE,MELTON,MERRI-BEK,MONASH,MOONEE VALLEY,MORNINGTON PENINSULA,NILLUMBIK,PORT PHILLIP,STONNINGTON,WHITEHORSE,WHITTLESEA,WYNDHAM,YARRA,YARRA RANGES'.split(','))


def features(layer, **params):
    result = []
    while True:
        response = requests.get(f'{SERVICE}/{layer}/query', params={
            'f': 'geojson', 'outFields': '*', 'outSR': 4326,
            'resultRecordCount': 200, 'resultOffset': len(result),
            'orderByFields': 'OBJECTID', **params
        }, timeout=120)
        response.raise_for_status()
        data = response.json()
        if 'error' in data:
            raise RuntimeError(data['error'])
        page = data['features']
        result.extend(page)
        if len(page) < 200:
            return result


def main():
    quoted = ','.join(f"'{name}'" for name in COUNCILS)
    councils = features(9, where=f'lga_name IN ({quoted})')
    assert {f['properties']['lga_name'] for f in councils} == set(COUNCILS)
    metro = unary_union([shape(f['geometry']) for f in councils])
    west, south, east, north = metro.bounds
    localities = features(11, where='1=1', geometry=f'{west},{south},{east},{north}',
                          geometryType='esriGeometryEnvelope', inSR=4326,
                          spatialRel='esriSpatialRelIntersects')
    suburbs = []
    for feature in localities:
        polygon = shape(feature['geometry'])
        intersection = polygon.intersection(metro)
        # Shared boundary lines are not suburbs inside Melbourne. Ignore numerical slivers.
        if intersection.area < 1e-8:
            continue
        centre = polygon.centroid
        if not polygon.covers(centre):
            centre = polygon.representative_point()
        props = feature['properties']
        suburbs.append({'id': props['pfi'], 'name': props['locality_name'].title(),
                        'latitude': round(centre.y, 6), 'longitude': round(centre.x, 6)})
    suburbs.sort(key=lambda suburb: (suburb['name'], suburb['id']))
    assert len(suburbs) > 500 and len({s['id'] for s in suburbs}) == len(suburbs)
    output = {
        'source': 'https://discover.data.vic.gov.au/dataset/vicmap-admin-locality-polygon-aligned-to-property',
        'boundarySource': f'{SERVICE}/9', 'localitySource': f'{SERVICE}/11',
        'attribution': 'Derived from Vicmap Admin, © State of Victoria (Department of Transport and Planning)',
        'license': 'CC BY 4.0', 'licenseUrl': 'https://creativecommons.org/licenses/by/4.0/',
        'retrievedAt': datetime.date.today().isoformat(),
        'coverage': 'Official bounded localities with land inside the 31 metropolitan Melbourne councils.',
        'coordinates': 'Approximate polygon centres; an interior point is used if the centre falls outside the locality.',
        'councils': COUNCILS, 'suburbs': suburbs
    }
    target = Path(__file__).resolve().parents[1] / 'src/lib/locations/melbourne-suburbs.json'
    target.write_text(json.dumps(output, indent=2, ensure_ascii=False) + '\n')
    print(f'Wrote {len(suburbs)} suburbs to {target}')


if __name__ == '__main__':
    main()
