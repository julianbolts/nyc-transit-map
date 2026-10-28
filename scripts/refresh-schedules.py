#!/usr/bin/env python3
"""Build recurring static timetables from official GTFS; retain usable data on failure.

Standard library only. Agency geometry is resolved through a separately reviewed
fingerprint registry; ordinary timetable refreshes never modify the verified network.
"""
import argparse
import collections
import csv
import datetime as dt
import hashlib
import io
import json
import os
import tempfile
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
NY = ZoneInfo('America/New_York')
URLS = {
    'subway': 'https://rrgtfsfeeds.s3.amazonaws.com/gtfs_subway.zip',
    'ferry': 'https://nycferry.connexionz.net/rtt/public/resource/gtfs.zip',
}
WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']


def compact(value):
    return json.dumps(value, separators=(',', ':'), sort_keys=True)


def digest(value):
    return hashlib.sha256(compact(value).encode()).hexdigest()


def service_base(day):
    return int(dt.datetime.combine(day, dt.time(12), NY).timestamp()) - 43200


def next_refresh(day):
    following = (day.replace(day=28) + dt.timedelta(days=4)).replace(day=1)
    return int(dt.datetime.combine(following, dt.time(6, 15), dt.timezone.utc).timestamp())


def seconds(value):
    h, m, s = map(int, value.split(':'))
    if h < 0 or not 0 <= m < 60 or not 0 <= s < 60:
        raise ValueError('Invalid GTFS time: ' + value)
    return h * 3600 + m * 60 + s


def read_feed(mode, archive):
    def rows(name):
        try:
            with io.TextIOWrapper(archive.open(name + '.txt'), encoding='utf-8-sig') as f:
                return list(csv.DictReader(f))
        except KeyError:
            return []

    prefix = mode + ':'
    stops = {prefix+s['stop_id']: [s['stop_name'], float(s['stop_lon']), float(s['stop_lat'])] for s in rows('stops')}
    routes = {prefix+r['route_id']: [r.get('route_short_name') or r['route_long_name'], r['route_long_name'], mode]
              for r in rows('routes') if mode != 'ferry' or int(r['route_type']) == 4}
    stop_times = collections.defaultdict(list)
    for s in rows('stop_times'):
        stop_times[s['trip_id']].append([prefix+s['stop_id'], seconds(s['arrival_time']), seconds(s['departure_time']), int(s['stop_sequence'])])
    trips = {}
    for row in rows('trips'):
        route = prefix + row['route_id']
        if route not in routes:
            continue
        times = sorted(stop_times.get(row['trip_id'], []), key=lambda s: s[3])
        if len(times) < 2:
            continue
        trips[row['trip_id']] = {'id': prefix+row['trip_id'], 'route': route,
                                'shape': prefix+row.get('shape_id', ''), 'headsign': row.get('trip_headsign', ''),
                                'service': row['service_id'], 'times': times}
    shapes = collections.defaultdict(list)
    for s in rows('shapes'):
        shapes[prefix+s['shape_id']].append((int(s['shape_pt_sequence']), round(float(s['shape_pt_lon']), 6), round(float(s['shape_pt_lat']), 6)))
    hashes = {shape: digest([(lon, lat) for _, lon, lat in sorted(points)]) for shape, points in shapes.items()}
    if rows('frequencies'):
        raise ValueError(f'{mode}: frequency-based service needs expansion before import')
    return {'mode': mode, 'stops': stops, 'routes': routes, 'trips': trips, 'shapeHashes': hashes,
            'calendars': rows('calendar'), 'exceptions': rows('calendar_dates'), 'info': next(iter(rows('feed_info')), {})}


def geometry_key(feed, trip):
    # Raw geometry plus route and ordered stop locations. IDs may change; paths may not.
    return digest([feed['shapeHashes'].get(trip['shape']), trip['route'],
                   [(stop, feed['stops'][stop][1:]) for stop, *_ in trip['times']]])


def seed_registry(feeds, network):
    """One-time authoring baseline for source IDs already in the curated network.

    This is explicitly invoked, never part of a monthly refresh. Inspect the source
    paths against the verified network before accepting this file into version control.
    """
    bindings = {}
    for feed in feeds:
        for trip in feed['trips'].values():
            if trip['shape'] in network['shapes'] and trip['shape'] in feed['shapeHashes']:
                bindings[geometry_key(feed, trip)] = trip['shape']
    return {'schemaVersion': 1, 'networkHash': digest(network), 'bindings': bindings,
            'sources': {feed['mode']: {'url': URLS[feed['mode']], 'feedVersion': feed['info'].get('feed_version', '')} for feed in feeds}}


def service_windows(feed, day):
    trips = feed['trips']
    by_service = collections.defaultdict(set)
    for trip_id, trip in trips.items():
        by_service[trip['service']].add(trip_id)
    calendars = [c for c in feed['calendars'] if c['service_id'] in by_service]
    if calendars:
        boundaries = sorted({dt.datetime.strptime(c[key], '%Y%m%d').date() + dt.timedelta(days=key == 'end_date')
                             for c in calendars for key in ['start_date', 'end_date']})
        windows = []
        for start, end in zip(boundaries, boundaries[1:]):
            services = [c for c in calendars if c['start_date'] <= start.strftime('%Y%m%d') <= c['end_date']]
            week = [set().union(*(by_service[c['service_id']] for c in services if c[weekday] == '1')) for weekday in WEEKDAYS]
            windows.append((start, end-dt.timedelta(days=1), week))
        return windows, []

    # Some GTFS feeds express all service as dated additions, with no calendar.txt.
    dated = collections.defaultdict(set)
    for row in feed['exceptions']:
        date = dt.datetime.strptime(row['date'], '%Y%m%d').date()
        if row['exception_type'] == '1':
            dated[date].update(by_service[row['service_id']])
    if not dated:
        raise ValueError(f'{feed["mode"]}: no recurring or dated service')
    start, end = min(dated), max(dated)
    if (end-start).days < 6:
        raise ValueError(f'{feed["mode"]}: dated-only feed needs at least a representative week')
    candidates = [[] for _ in WEEKDAYS]
    date = start
    while date <= end:
        ids = dated[date]
        # Different service/trip IDs can encode the same daily timetable.
        signature = digest(sorted(compact([trips[i]['route'], trips[i]['shape'], trips[i]['headsign'], trips[i]['times']]) for i in ids))
        candidates[date.weekday()].append((signature, date, ids))
        date += dt.timedelta(days=1)
    week, notes = [], []
    for weekday, values in enumerate(candidates):
        counts = collections.Counter(v[0] for v in values)
        chosen = max(values, key=lambda v: (counts[v[0]], -abs((v[1]-day).days), v[1]))
        week.append(chosen[2])
        notes.append(f'{WEEKDAYS[weekday]} inferred from dated service on {chosen[1]}')
    return [(start, end, week)], notes


def generate(mode, archive, day, downloaded, known_shapes, registry):
    feed = read_feed(mode, archive)
    windows, notes = service_windows(feed, day)
    # Ignore obsolete periods, except the final past week when a feed has expired.
    past = [w for w in windows if w[1] < day]
    latest_past = past[-1] if past else None
    horizon = dt.datetime.fromtimestamp(next_refresh(day), NY).date() + dt.timedelta(days=7)
    recent = day-dt.timedelta(days=7)
    selected = [w for w in windows if w[0] <= horizon and w[1] >= recent]
    windows = selected or ([latest_past] if latest_past else [])
    patterns, pattern_indexes, trips, trip_indexes, variants, variant_indexes, periods = [], {}, [], {}, {}, {}, []
    unresolved_now = []
    for start, end, week in windows:
        ids = set().union(*week)
        resolved, unknown = {}, set()
        for trip_id in sorted(ids):
            trip = feed['trips'][trip_id]
            times = trip['times']
            if any(s[0] not in feed['stops'] for s in times):
                raise ValueError('Missing stop in ' + trip['id'])
            if any(a > d for _, a, d, _ in times) or any(a[2] > b[1] or a[3] >= b[3] for a, b in zip(times, times[1:])):
                raise ValueError('Nonmonotonic stop times in ' + trip['id'])
            shape = registry.get(geometry_key(feed, trip))
            if not shape or shape not in known_shapes or not shape.startswith(mode+':'):
                unknown.add(trip['shape'])
            else:
                resolved[trip_id] = shape
        if unknown:
            message = f'{mode}: {start}–{end}: unverified geometry {", ".join(sorted(unknown))}; keeping the last usable week'
            notes.append(message)
            if start <= day <= end:
                unresolved_now.append(message)
            continue
        selectors = []
        for daily_ids in week:
            indexes = set()
            for trip_id in sorted(daily_ids):
                trip = feed['trips'][trip_id]
                first = trip['times'][0][1]
                pattern = tuple((stop, a-first, d-first, seq) for stop, a, d, seq in trip['times'])
                if pattern not in pattern_indexes:
                    pattern_indexes[pattern] = len(patterns)
                    patterns.append(pattern)
                row = [trip['id'], trip['route'], trip['headsign'], resolved[trip_id], pattern_indexes[pattern], first]
                key = tuple(row[1:])
                if key not in trip_indexes:
                    trip_indexes[key] = len(trips)
                    trips.append(row)
                indexes.add(trip_indexes[key])
            key = tuple(sorted(indexes))
            if key not in variant_indexes:
                name = f'v{len(variants)}'
                variant_indexes[key] = name
                variants[name] = list(key)
            selectors.append(variant_indexes[key])
        periods.append({'from': start.isoformat(), 'through': end.isoformat(), 'week': selectors})
    if unresolved_now:
        raise ValueError('; '.join(unresolved_now))
    if not periods or not trips:
        raise ValueError(f'{mode}: no usable weekly templates; ' + '; '.join(notes))
    usable = [p for p in periods if any(variants[v] for v in p['week'])]
    fallback = next((p for p in reversed(usable) if p['from'] <= day.isoformat()), usable[0])['week']
    used_stops = {stop for pattern in patterns for stop, *_ in pattern}
    # Keep parent station names available for metadata grouping.
    used_stops |= {s[:-1] for s in list(used_stops) if s[-1:] in ['N', 'S'] and s[:-1] in feed['stops']}
    used_routes = {t[1] for t in trips}
    info = feed['info']
    source = {'downloaded': downloaded, 'url': URLS[mode], 'feedVersion': info.get('feed_version', ''),
              'startDate': info.get('feed_start_date', ''), 'endDate': info.get('feed_end_date', '')}
    if periods[-1]['through'] < dt.datetime.fromtimestamp(next_refresh(day), NY).date().isoformat():
        notes.append(f'{mode}: source coverage ends {periods[-1]["through"]}; typical week continues beyond coverage')
    schedule = {'schemaVersion': 2, 'kind': 'weekly-template', 'timezone': 'America/New_York',
                'version': f'{mode}-{downloaded}', 'generatedAt': downloaded, 'refreshAfter': next_refresh(day),
                'sources': {mode: source}, 'stops': {s: feed['stops'][s] for s in sorted(used_stops)},
                'routes': {r: feed['routes'][r] for r in sorted(used_routes)}, 'patterns': patterns,
                'trips': trips, 'variants': variants, 'periods': periods, 'fallbackWeek': fallback,
                'quality': {'notes': notes}}
    validate_schedule(mode, schedule, known_shapes)
    return schedule, metadata_feed(schedule)


def validate_schedule(mode, schedule, known_shapes):
    if schedule.get('kind') != 'weekly-template' or schedule.get('schemaVersion') != 2 or schedule.get('timezone') != 'America/New_York':
        raise ValueError(f'{mode}: missing usable recurring schedule; bootstrap templates first')
    if not schedule['trips'] or not schedule['periods']:
        raise ValueError(f'{mode}: empty recurring schedule')
    if not 0 < schedule['refreshAfter'] or not schedule['generatedAt']:
        raise ValueError(f'{mode}: missing schedule provenance')
    for row in schedule['trips']:
        _, route, _, shape, pattern, start = row
        if shape not in known_shapes or not shape.startswith(mode+':') or schedule['routes'][route][2] != mode or start < 0:
            raise ValueError(f'{mode}: invalid route or verified geometry reference')
        times = schedule['patterns'][pattern]
        if len(times) < 2 or any(stop not in schedule['stops'] or a > d for stop, a, d, _ in times):
            raise ValueError(f'{mode}: invalid timing pattern')
        if any(a[2] > b[1] or a[3] >= b[3] for a, b in zip(times, times[1:])):
            raise ValueError(f'{mode}: nonmonotonic timing pattern')
    for variant in schedule['variants'].values():
        if any(not isinstance(i, int) or not 0 <= i < len(schedule['trips']) for i in variant):
            raise ValueError(f'{mode}: invalid trip variant reference')
    for week in [schedule['fallbackWeek']] + [p['week'] for p in schedule['periods']]:
        if len(week) != 7 or any(v not in schedule['variants'] for v in week):
            raise ValueError(f'{mode}: incomplete weekly selector')
    previous = ''
    for period in schedule['periods']:
        if period['from'] > period['through'] or period['from'] <= previous:
            raise ValueError(f'{mode}: overlapping or invalid periods')
        previous = period['through']


def metadata_feed(schedule):
    return schedule['stops'], schedule['routes'], [(row[1], row[3], schedule['patterns'][row[4]]) for row in schedule['trips']]


def route_metadata(feeds):
    shapes, stations, terminals = {}, {}, {}
    for stops, routes, trips in feeds:
        for route, shape, times in trips:
            code, _, mode = routes[route]
            shapes.setdefault(shape, {'mode': mode, 'route': code})
            for stop, *_ in times:
                if mode == 'subway':
                    parent = stop[:-1] if stop[-1:] in ['N', 'S'] else stop
                    name, lng, lat = stops.get(parent, stops[stop])
                    stations.setdefault(parent, {'id': parent, 'name': name, 'lng': lng, 'lat': lat})
                else:
                    name, lng, lat = stops[stop]
                    key = next((k for k, v in terminals.items() if ((v['lng']-lng)*.76)**2+(v['lat']-lat)**2 < (60/111000)**2), stop)
                    terminal = terminals.setdefault(key, {'id': stop, 'name': name, 'lng': lng, 'lat': lat, 'routes': []})
                    if code not in terminal['routes']:
                        terminal['routes'].append(code)
    for terminal in terminals.values():
        terminal['routes'].sort()
    return {'shapes': shapes, 'stations': list(stations.values()), 'terminals': list(terminals.values())}


def download(url):
    request = urllib.request.Request(url, headers={'User-Agent': 'nyc-transit-map-monthly-import/0.3'})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                return response.read()
        except (urllib.error.URLError, TimeoutError, OSError):
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)


def refresh(day, downloaded, network, registry, previous, fetch):
    schedules, report, updated = {}, [], False
    for mode in URLS:
        try:
            with zipfile.ZipFile(io.BytesIO(fetch(mode))) as archive:
                schedule, _ = generate(mode, archive, day, downloaded, network['shapes'], registry)
            schedules[mode] = schedule
            report.append(f'{mode}: refreshed {len(schedule["trips"])} template trips, {len(schedule["variants"])} variants')
            report.extend(schedule['quality']['notes'])
            updated = True
        except Exception as error:
            old = previous.get(mode)
            if old is None:
                raise ValueError(f'{mode}: initial templates could not be generated: {error}') from error
            validate_schedule(mode, old, network['shapes'])
            schedules[mode] = old
            report.append(f'{mode}: retained templates imported {old["generatedAt"]}: {error}')
    metadata = route_metadata([metadata_feed(schedules[mode]) for mode in URLS])
    version = digest([schedules, network, metadata])[:20]
    bundle = {'schemaVersion': 1, 'version': version, 'schedules': schedules,
              'assets': {'version': version, 'network': network, 'metadata': metadata}}
    return bundle, report, updated


def write_outputs(directory, outputs):
    # Prepare every file before replacing any. CI only commits after all checks pass.
    staged = []
    try:
        for name, value in outputs.items():
            with tempfile.NamedTemporaryFile(mode='w', dir=directory, delete=False) as file:
                file.write(compact(value))
                Path(file.name).chmod(0o644)
                staged.append((Path(file.name), directory/name))
        for source, destination in staged:
            source.replace(destination)
    finally:
        for source, _ in staged:
            source.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--date', type=dt.date.fromisoformat, default=dt.datetime.now(NY).date())
    parser.add_argument('--feed-dir', type=Path)
    parser.add_argument('--seed-geometry', action='store_true', help='Authoring only: record reviewed source fingerprints for existing canonical shape IDs')
    args = parser.parse_args()
    directory = ROOT/'public/data'
    network = json.loads((directory/'network.json').read_text())
    def fetch(mode):
        return (args.feed_dir/(mode+'.zip')).read_bytes() if args.feed_dir else download(URLS[mode])
    registry_path = directory/'geometry-sources.json'
    if args.seed_geometry:
        feeds = []
        for mode in URLS:
            with zipfile.ZipFile(io.BytesIO(fetch(mode))) as archive:
                feeds.append(read_feed(mode, archive))
        write_outputs(directory, {'geometry-sources.json': seed_registry(feeds, network)})
        print('Recorded source fingerprints for existing curated shapes. Review geometry-sources.json before committing.')
        return
    registry = json.loads(registry_path.read_text())
    if registry['networkHash'] != digest(network):
        raise ValueError('Verified network changed: review/update the source geometry registry before importing')
    previous = {}
    for mode in URLS:
        path = directory/(mode+'-schedule.json')
        if path.exists():
            value = json.loads(path.read_text())
            if value.get('kind') == 'weekly-template':
                previous[mode] = value
    downloaded = dt.datetime.now(dt.timezone.utc).isoformat()
    bundle, report, updated = refresh(args.date, downloaded, network, registry['bindings'], previous, fetch)
    lines = ['Monthly transit templates', ''] + report
    print('\n'.join(lines))
    summary = os.environ.get('GITHUB_STEP_SUMMARY')
    if summary:
        with open(summary, 'a') as file:
            file.write('\n'.join(lines)+'\n')
    for message in report:
        if 'retained' in message or 'unverified' in message:
            print('::warning::'+message.replace('\n', ' '))
    if updated:
        outputs = {mode+'-schedule.json': bundle['schedules'][mode] for mode in URLS}
        outputs.update({'route-meta.json': bundle['assets']['metadata'], 'transit-bundle.json': bundle})
        write_outputs(directory, outputs)
    else:
        print('No candidates passed: all previously published files remain unchanged.')


if __name__ == '__main__':
    main()
