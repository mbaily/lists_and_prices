#!/usr/bin/env python3
"""Merge verified chain-source snapshots into the offline catalogue.

Requires requests and shapely. Source manifest: scripts/retail-chain-sources.json.
Use --source-cache to reuse GeoJSON snapshots and --additional-facts for separately
extracted official locator/directory facts. Every original brand gets a coverage row.
"""
import argparse
import collections
import datetime
import hashlib
import importlib.util
import json
import math
import re
import unicodedata
from pathlib import Path
from urllib.parse import quote, urljoin, urlparse, urlunparse

import requests
from shapely.geometry import Point, shape
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[1]
ALIASES = json.loads((ROOT / 'src/lib/locations/brand-aliases.json').read_text())


def normalize(name):
    plain = unicodedata.normalize('NFKD', str(name)).encode('ascii', 'ignore').decode().lower()
    tag = re.sub(r'[^a-z0-9]', '', plain)
    return ALIASES.get(tag, tag)


def distance(a, b):
    return math.hypot((a['latitude'] - b['latitude']) * 111.2,
                      (a['longitude'] - b['longitude']) * 88)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-cache', type=Path, required=True)
    parser.add_argument('--additional-facts', type=Path, default=ROOT / 'scripts/retail-chain-facts.json')
    args = parser.parse_args()
    manifest = json.loads((ROOT / 'scripts/retail-chain-sources.json').read_text())
    catalogue_path = ROOT / 'src/lib/locations/melbourne.json'
    catalogue = json.loads(catalogue_path.read_text())
    boundary = args.source_cache / 'metro-boundary.geojson'
    if boundary.exists():
        metro = shape(json.loads(boundary.read_text()))
    else:
        spec = importlib.util.spec_from_file_location('suburbs', Path(__file__).with_name('update-melbourne-suburbs.py'))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        quoted = ','.join(f"'{name}'" for name in module.COUNCILS)
        polygons = module.features(9, where=f'lga_name IN ({quoted})')
        if len(polygons) != 31:
            raise RuntimeError('Incomplete metropolitan council boundaries')
        metro = unary_union([shape(feature['geometry']) for feature in polygons])
        from shapely.geometry import mapping
        boundary.write_text(json.dumps(mapping(metro)))
    suburbs = json.loads((ROOT / 'src/lib/locations/melbourne-suburbs.json').read_text())['suburbs']
    suburb_by_name = {normalize(suburb['name']): suburb for suburb in suburbs}
    allowed = {normalize(brand['tag']) for brand in manifest['brands']}
    locations = []
    excluded_original = []
    for original in catalogue['locations']:
        if original.get('collection') == 'chain-expansion':
            continue
        location = dict(original)
        location['tags'] = list(dict.fromkeys(ALIASES.get(tag, tag) for tag in original['tags']))
        if not metro.covers(Point(location['longitude'], location['latitude'])):
            excluded_original.append({'id': location['id'], 'name': location['name']})
            continue
        locations.append(location)
    by_tag = collections.defaultdict(list)
    for location in locations:
        by_tag[location['tags'][0]].append(location)
    stats = collections.defaultdict(collections.Counter)
    source_results = {}
    supplementary_sources = collections.defaultdict(set)
    seen = set()

    def add(record):
        tag = normalize(record['tags'][0])
        if tag not in allowed:
            return
        record['tags'] = list(dict.fromkeys([tag] + [ALIASES.get(t, t) for t in record['tags'][1:]]))
        if tag in {'scorptec', 'centrecom', 'cpl', 'msy'} and 'pcparts' not in record['tags']:
            record['tags'].append('pcparts')
        if not metro.covers(Point(record['longitude'], record['latitude'])):
            stats[tag]['outsideMetro'] += 1
            return
        # Prefer an exact store identity; only use proximity when enriching a centre pin.
        source = record.get('source', '').rstrip('/')
        match = next((r for r in by_tag[tag] if source and source == r.get('source', '').rstrip('/')
                      and (distance(r, record) < .08 or (record.get('address') and record['address'] == r.get('address')))), None)
        if match is None:
            candidates = [r for r in by_tag[tag] if distance(r, record) < (.35 if r.get('coordinateAccuracy') == 'shopping-centre' or record.get('coordinateAccuracy') == 'shopping-centre' else .08)]
            if candidates:
                match = min(candidates, key=lambda r: distance(r, record))
        if match:
            match['tags'] = list(dict.fromkeys(match['tags'] + record['tags']))
            if not urlparse(match.get('source', '')).scheme and urlparse(source).scheme:
                match['source'] = source
            if record.get('centre') and not match.get('centre'):
                match['centre'] = record['centre']
            # Replace a centre/suburb approximation with the retailer's point, never the reverse.
            if record.get('coordinateAccuracy') == 'store' and match.get('coordinateAccuracy') in ['shopping-centre', 'suburb']:
                for key in ['latitude', 'longitude', 'address', 'source', 'sourceDataset', 'coordinateAccuracy']:
                    if key in record:
                        match[key] = record[key]
            stats[tag]['merged'] += 1
            return
        if record['id'] in seen:
            return
        seen.add(record['id'])
        locations.append(record)
        by_tag[tag].append(record)
        stats[tag]['added'] += 1
        if record.get('coordinateAccuracy') == 'suburb':
            stats[tag]['suburbFallbacks'] += 1

    for source in manifest['datasets']:
        spider = source['spider']
        path = args.source_cache / (spider + '.geojson')
        try:
            if not path.exists():
                response = requests.get(source['url'], timeout=30)
                response.raise_for_status()
                path.write_text(response.text)
            data = json.loads(path.read_text())
            features = data['features']
            source_results[spider] = {'url': source['url'], 'features': len(features), 'acceptedMetro': 0}
        except Exception as error:
            source_results[spider] = {'url': source['url'], 'error': type(error).__name__}
            continue
        for feature in features:
            props = feature.get('properties', {})
            # A multi-brand exporter (e.g. Coles or Cotton On Group) must retain actual brands.
            tag = normalize(props.get('brand') or props.get('name') or '')
            if tag not in allowed:
                matching = [normalize(t) for t in source['tags'] if normalize(props.get('name', '')) == normalize(t)]
                if not matching:
                    continue
                tag = matching[0]
            if props.get('amenity') == 'atm' and tag + 'atm' in allowed:
                tag += 'atm'
            if props.get('amenity') == 'parking':
                continue
            country = props.get('addr:country', '')
            if country and country.upper() not in ['AU', 'AUS', 'AUSTRALIA']:
                continue
            state = props.get('addr:state', '').upper()
            if state and state not in ['VIC', 'VICTORIA', 'AU-VIC']:
                continue
            address = props.get('addr:full') or ', '.join(str(props[key]) for key in ['addr:street_address', 'addr:street', 'addr:city', 'addr:state', 'addr:postcode'] if props.get(key))
            suburb = suburb_by_name.get(normalize(props.get('addr:city', '')))
            geometry = feature.get('geometry') or {}
            coords = geometry.get('coordinates', []) if geometry.get('type') == 'Point' else []
            point = None
            if len(coords) >= 2 and all(isinstance(value, (int, float)) and math.isfinite(value) for value in coords[:2]):
                point = {'longitude': coords[0], 'latitude': coords[1]}
            accuracy = 'store'
            if not point or not metro.covers(Point(point['longitude'], point['latitude'])) or (suburb and distance(point, suburb) > 30):
                # A verified Victorian/Australian address can rescue a missing/wrong map point.
                if suburb and address and (state in ['VIC', 'VICTORIA', 'AU-VIC'] or country.upper() == 'AU'):
                    point = {'latitude': suburb['latitude'], 'longitude': suburb['longitude']}
                    accuracy = 'suburb'
                else:
                    stats[tag]['outsideMetroOrInvalidPoint'] += 1
                    continue
            source_url = props.get('website') or props.get('@source_uri') or source['url']
            if not urlparse(source_url).scheme:
                retailer_roots = {'sportsgirl': 'https://www.sportsgirl.com.au',
                                  'sussan': 'https://www.sussan.com.au',
                                  'suzannegrae': 'https://www.suzannegrae.com.au'}
                source_url = urljoin(retailer_roots.get(tag) or props.get('@source_uri') or source['url'], source_url)
            parsed = urlparse(source_url)
            # Do not persist public integration tokens embedded in API query strings.
            source_url = urlunparse(parsed._replace(query='', fragment=''))
            reference = str(props.get('ref') or feature.get('id') or source_url + address)
            identity = hashlib.sha256((tag + ':' + reference).encode()).hexdigest()[:20]
            branch = props.get('branch') or props.get('addr:city') or address
            name = props.get('brand') or props.get('name') or tag
            if tag.endswith('atm') and 'atm' not in name.lower():
                name += ' ATM'
            tags = [tag]
            if tag in ['coles', 'woolworths', 'aldi']:
                tags.append('supermarket')
            if tag in ['bunnings', 'mitre10']:
                tags.append('hardware')
            if tag in ['amcal', 'chemistwarehouse', 'priceline']:
                tags.append('pharmacy')
            if tag == 'australiapost':
                tags.append('postoffice')
            record = {'id': 'chain-' + identity, 'name': name + (' — ' + branch if branch else ''),
                      'tags': tags, **point, 'address': address, 'source': source_url,
                      'sourceDataset': source['url'], 'coordinateAccuracy': accuracy,
                      'collection': 'chain-expansion'}
            if accuracy == 'suburb':
                record['suburb'] = suburb['name']
            add(record)
            source_results[spider]['acceptedMetro'] += 1
    for source in manifest.get('officialDatasets', []):
        if source['format'] != 'officeworks':
            raise ValueError('Unsupported official dataset format')
        path = args.source_cache / 'officeworks-official.json'
        try:
            if not path.exists():
                response = requests.get(source['url'], timeout=30)
                response.raise_for_status()
                stores = response.json()
                if not isinstance(stores, list) or not stores:
                    raise ValueError('Empty or invalid Officeworks locator response')
                path.write_text(json.dumps(stores))
            stores = json.loads(path.read_text())
            accepted = 0
            for store in stores:
                if store.get('status') != 'Active' or store['address']['state'] != 'VIC':
                    continue
                latitude = float(store['location']['latitude'])
                longitude = float(store['location']['longitude'])
                if not metro.covers(Point(longitude, latitude)):
                    continue
                address = store['address']
                url = quote('https://www.officeworks.com.au/shop/officeworks/storepage/' +
                            '/'.join([store['id'], address['state'], address['suburb']]), safe=':/')
                add({'id': 'chain-officeworks-' + store['id'], 'name': store['name'],
                     'tags': ['officeworks'], 'latitude': latitude, 'longitude': longitude,
                     'address': ', '.join([address['street'], address['suburb'], address['state'], address['postCode']]),
                     'source': url, 'sourceDataset': source['url'], 'coordinateAccuracy': 'store',
                     'collection': 'chain-expansion'})
                accepted += 1
            source_results['officeworks-official'] = {'url': source['url'], 'features': len(stores), 'acceptedMetro': accepted}
            supplementary_sources['officeworks'].add(source['url'])
        except Exception as error:
            source_results['officeworks-official'] = {'url': source['url'], 'error': type(error).__name__}
    if args.additional_facts and args.additional_facts.exists():
        for record in json.loads(args.additional_facts.read_text()):
            add(record)
            supplementary_sources[normalize(record['tags'][0])].add(record.get('sourceDataset') or record['source'])
    locations.sort(key=lambda location: (location['name'].casefold(), location['id']))
    if len({record['id'] for record in locations}) != len(locations):
        raise RuntimeError('Duplicate location ids; catalogue left unchanged')
    counts = collections.Counter(record['tags'][0] for record in locations)
    report_rows = []
    for brand in manifest['brands']:
        tag = normalize(brand['tag'])
        candidates = [source for source in manifest['datasets'] if tag in {normalize(t) for t in source['tags']}]
        useful = [source for source in candidates if source_results.get(source['spider'], {}).get('acceptedMetro', 0)]
        row = {'tag': brand['tag'], 'canonicalTag': tag, 'name': brand['name'], 'metroLocations': counts[tag],
               'status': 'expanded-source-snapshot' if stats[tag]['added'] or stats[tag]['merged'] else 'directory-only-needs-verification',
               'stats': dict(stats[tag]), 'datasets': [source['url'] for source in useful],
               'officialSources': sorted(supplementary_sources[tag]),
               'locatorCandidates': brand.get('locatorCandidates', []), 'attempts': brand.get('attempts', [])}
        report_rows.append(row)
    report = {'retrievedAt': datetime.date.today().isoformat(), 'inventoryCount': len(report_rows),
              'canonicalBrandCount': len(allowed), 'locations': len(locations),
              'coverageNote': 'Source snapshots and official directories; not a claim that every chain is exhaustive. Directory-only entries still need a complete official locator.',
              'excludedOutsideMetro': excluded_original, 'sources': source_results, 'brands': report_rows}
    catalogue['locations'] = locations
    catalogue['coverage'] = 'Locations inside the 31 metropolitan Melbourne council boundaries, including Mornington Peninsula and Yarra Ranges. Existing brand names were checked against chain exports and official directories; per-brand limitations are in docs/retail-chain-coverage.json.'
    catalogue['chainCoverageReport'] = 'docs/retail-chain-coverage.json'
    catalogue['coordinateNotes'] = 'Store coordinates are preferred. Shopping-centre and verified suburb-centre fallbacks are labelled explicitly; suburb directions use the recorded store address.'
    catalogue['attribution'] = 'AllThePlaces, official retailer locators and shopping-centre directories'
    catalogue['retrievedAt'] = report['retrievedAt']
    catalogue['datasets'].update({source['spider']: source['url'] for source in manifest['datasets']})
    catalogue_path.write_text(json.dumps(catalogue, indent=2, ensure_ascii=False) + '\n')
    (ROOT / 'docs/retail-chain-coverage.json').write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n')
    print(json.dumps({'locations': len(locations), 'inventory': len(report_rows),
                      'canonicalBrands': len(allowed), 'expandedBrands': sum(bool(stats[tag]['added'] or stats[tag]['merged']) for tag in allowed),
                      'suburbFallbacks': sum(value['suburbFallbacks'] for value in stats.values())}, indent=2))


if __name__ == '__main__':
    main()
