#!/usr/bin/env python3
"""Add centre directories and hardware stores. Requires requests and shapely."""
import argparse
import datetime
import importlib.util
import json
import math
import re
import unicodedata
from pathlib import Path
from html.parser import HTMLParser

import requests
from shapely.geometry import Point, shape
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / 'src/lib/locations/melbourne.json'
CENTRES = {'northland': 'https://www.northlandsc.com.au', 'emporium': 'https://www.emporiummelbourne.com.au'}
CHAINS = {'bunnings': 'bunnings', 'mitre10': 'mitre_10_au'}
BRAND_TAGS = {'peteralexandersleepwear': 'peteralexander', 'anguscoote': 'angusandcoote',
              'surfdivenski': 'surfdiveandski', '1001optometry': '1001optical'}
SOURCE_CACHE = None


class DirectoryLinks(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = set()

    def handle_starttag(self, tag, attributes):
        href = dict(attributes).get('href', '')
        if tag == 'a' and href.startswith('/stores/'):
            self.links.add(href)


def brand_tag(name):
    plain = unicodedata.normalize('NFKD', name).encode('ascii', 'ignore').decode().lower()
    tag = re.sub(r'[^a-z0-9]', '', plain)
    return BRAND_TAGS.get(tag, tag)


def download(url):
    if SOURCE_CACHE:
        from urllib.parse import urlparse
        parsed = urlparse(url)
        filename = Path(parsed.path).name if parsed.path.endswith('.geojson') else parsed.netloc + '-shopping.html'
        path = SOURCE_CACHE / filename
        if path.exists():
            response = requests.Response()
            response.status_code = 200
            response._content = path.read_bytes()
            response.encoding = 'utf-8'
            return response
    response = requests.get(url, timeout=90)
    response.raise_for_status()
    return response


def close(a, b):
    # Deduplicate existing chain branches inside the same shopping centre (within 500 m).
    return math.hypot((a['latitude'] - b['latitude']) * 111.2,
                      (a['longitude'] - b['longitude']) * 88) < .5


def main():
    global SOURCE_CACHE
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-cache', type=Path, help='Optional directory of downloaded source snapshots')
    SOURCE_CACHE = parser.parse_args().source_cache
    catalogue = json.loads(TARGET.read_text())
    # Replace only this collector's records; preserve manually recorded locations.
    locations = [location for location in catalogue['locations'] if location.get('collection') != 'retail-expansion']
    for location in locations:
        managed_tags = location.pop('directoryTags', [])
        location['tags'] = [tag for tag in location['tags'] if tag not in managed_tags]
    counts = {}
    for key, base in CENTRES.items():
        url = base + '/shopping'
        html = download(url).text
        match = re.search(r'window\.__data=(.*?);?</script>', html)
        if not match:
            raise RuntimeError(f'Directory format changed: {url}')
        data = json.loads(match[1].rstrip(';'))['websiteData']
        centre = data['centre']
        # Embedded data also contains unpublished/retired stores. Import only public directory links.
        directory = DirectoryLinks()
        directory.feed(html)
        stores = [store for store in data['stores'] if store['link'] in directory.links]
        if len(stores) < 50:
            raise RuntimeError(f'Unexpectedly incomplete directory: {url}')
        counts[key] = 0
        for store in stores:
            name = store['title'].strip()
            if not name or 'management' in name.lower() or 'closed' in store.get('status', '').lower():
                continue
            tag = brand_tag(name)
            if not tag:
                raise RuntimeError(f'Cannot generate hashtag for {name}')
            tags = [tag, key]
            if tag == 'aldi':
                tags.append('supermarket')
            if tag in ['amcal', 'chemistwarehouse', 'priceline', 'pricelinepharmacy']:
                tags.append('pharmacy')
            if tag == 'australiapost':
                tags.append('postoffice')
            location = {'id': f'{key}-{store["_uid"]}', 'name': f'{name} — {centre["name"]}',
                        'tags': tags, 'latitude': centre['latitude'], 'longitude': centre['longitude'],
                        'address': centre['streetAddress'], 'source': base + store['link'],
                        'coordinateAccuracy': 'shopping-centre', 'centre': centre['name'],
                        'collection': 'retail-expansion'}
            existing = next((record for record in locations if record['tags'][0] == tag and close(record, location)), None)
            if existing:
                existing['tags'] = list(dict.fromkeys(existing['tags'] + tags))
                existing['directoryTags'] = list(dict.fromkeys(existing.get('directoryTags', []) + [key]))
            else:
                locations.append(location)
            counts[key] += 1

    spec = importlib.util.spec_from_file_location('suburb_collector', Path(__file__).with_name('update-melbourne-suburbs.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    quoted = ','.join(f"'{name}'" for name in module.COUNCILS)
    councils = module.features(9, where=f'lga_name IN ({quoted})')
    if len(councils) != 31:
        raise RuntimeError('Incomplete Melbourne council boundaries')
    metro = unary_union([shape(feature['geometry']) for feature in councils])
    for tag, spider in CHAINS.items():
        url = f'https://data.alltheplaces.xyz/runs/latest/output/{spider}.geojson'
        features = download(url).json()['features']
        counts[tag] = 0
        for feature in features:
            geometry = feature.get('geometry')
            if not geometry or geometry.get('type') != 'Point':
                continue
            longitude, latitude = geometry['coordinates'][:2]
            if not metro.covers(Point(longitude, latitude)):
                continue
            props = feature['properties']
            branch = props.get('branch') or props.get('addr:city') or props['name']
            source = props.get('website') or props['@source_uri']
            address = props.get('addr:full') or ', '.join(str(props[field]) for field in ['addr:street_address', 'addr:city', 'addr:state', 'addr:postcode'] if props.get(field))
            locations.append({'id': f'{tag}-{props.get("ref") or feature["id"]}',
                              'name': f'{props["name"]} — {branch}', 'tags': [tag, 'hardware'],
                              'latitude': latitude, 'longitude': longitude, 'address': address,
                              'source': source, 'coordinateAccuracy': 'store',
                              'collection': 'retail-expansion'})
            counts[tag] += 1
        if not counts[tag]:
            raise RuntimeError(f'No Melbourne stores returned for {tag}; catalogue left unchanged')
        catalogue['datasets'][tag] = url
    ids = [record['id'] for record in locations]
    if len(ids) != len(set(ids)):
        raise RuntimeError('Duplicate location IDs; catalogue left unchanged')
    catalogue['locations'] = sorted(locations, key=lambda record: (record['name'].casefold(), record['id']))
    catalogue['retrievedAt'] = datetime.date.today().isoformat()
    catalogue['datasets'].update({key: base + '/shopping' for key, base in CENTRES.items()})
    catalogue['attribution'] = 'AllThePlaces, Coles store locator, Northland and Emporium Melbourne directories'
    catalogue['coverage'] += ' Hardware stores use the 31 metropolitan council boundaries. Directory businesses are included at Northland and Emporium Melbourne; other listed brands are not complete Melbourne-wide coverage.' if 'Hardware stores use' not in catalogue['coverage'] else ''
    catalogue['coordinateNotes'] = 'Directory businesses share the published shopping-centre coordinates; hardware stores use individual store-locator coordinates. No suburb-centre fallbacks were needed.'
    catalogue['sourceLicenses'] = {'alltheplaces': 'CC0 1.0', 'directories': 'Public business names, addresses and centre coordinate facts from official directories; no descriptions, images or opening hours copied.'}
    TARGET.write_text(json.dumps(catalogue, indent=2, ensure_ascii=False) + '\n')
    print(json.dumps({'sourceCounts': counts, 'totalLocations': len(locations)}, indent=2))


if __name__ == '__main__':
    main()
