#!/usr/bin/env python3
"""Refresh mock API JSON from official GTFS. Standard library only; no runtime server.

The checked-in geometry is water-clipped. Fail on unknown shapes instead of silently
regenerating unverified ferry geometry. --feed-dir allows reproducible local imports.
"""
import argparse
import csv
import datetime as dt
import io
import json
import tempfile
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


def service_base(day):
    # GTFS time is measured from local noon minus 12 elapsed hours (also on DST days).
    return int(dt.datetime.combine(day, dt.time(12), NY).timestamp()) - 43200


def seconds(value):
    h, m, s = map(int, value.split(':'))
    return h * 3600 + m * 60 + s


def generate(mode, archive, day, downloaded, known_shapes):
    def rows(name):
        try:
            with io.TextIOWrapper(archive.open(name + '.txt'), encoding='utf-8-sig') as f:
                return list(csv.DictReader(f))
        except KeyError:
            return []

    prefix = mode + ':'
    stops = {prefix+s['stop_id']: [s['stop_name'], float(s['stop_lon']), float(s['stop_lat'])] for s in rows('stops')}
    routes = {prefix+r['route_id']: [r.get('route_short_name') or r['route_long_name'], r['route_long_name'], mode] for r in rows('routes') if mode != 'ferry' or int(r['route_type']) != 3}
    calendars = {c['service_id']: c for c in rows('calendar')}
    exceptions = {(c['service_id'], c['date']): int(c['exception_type']) for c in rows('calendar_dates')}
    weekdays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']

    def active(service, date):
        key = date.strftime('%Y%m%d')
        exception = exceptions.get((service, key))
        if exception is not None:
            return exception == 1
        c = calendars.get(service)
        return bool(c and c['start_date'] <= key <= c['end_date'] and c[weekdays[date.weekday()]] == '1')

    stop_times = {}
    for s in rows('stop_times'):
        stop_times.setdefault(s['trip_id'], []).append([prefix+s['stop_id'], seconds(s['arrival_time']), seconds(s['departure_time']), int(s['stop_sequence'])])
    patterns, trips, indexes, metadata_trips = [], [], {}, []
    unknown = set()
    today_start = int(dt.datetime.combine(day, dt.time(), NY).timestamp())
    for t in rows('trips'):
        route, shape = prefix+t['route_id'], prefix+t['shape_id']
        if route not in routes:
            continue
        times = sorted(stop_times.get(t['trip_id'], []), key=lambda s: s[3])
        if len(times) < 2:
            continue
        if shape not in known_shapes:
            unknown.add(shape)
        if any(s[0] not in stops for s in times):
            raise ValueError('Missing stop in ' + t['trip_id'])
        metadata_trips.append((route, shape, times))
        start = times[0][1]
        pattern = tuple((s[0], s[1]-start, s[2]-start, s[3]) for s in times)
        for offset in [0, -1, 1]:
            date = day + dt.timedelta(days=offset)
            if not active(t['service_id'], date):
                continue
            base = service_base(date)
            if offset == -1 and base + times[-1][2] < today_start:
                continue
            if pattern not in indexes:
                indexes[pattern] = len(patterns)
                patterns.append(pattern)
            trips.append([prefix+t['trip_id']+':'+str(offset), route, t.get('trip_headsign', ''), shape, indexes[pattern], start, base])
    if unknown:
        raise ValueError(f'{mode}: {len(unknown)} new shapes require geometry verification: {sorted(unknown)[:5]}')
    if not any(t[-1] == service_base(day) for t in trips):
        raise ValueError(f'{mode}: feed has no service for {day}; retaining previous files')
    used_routes = {t[1] for t in trips}
    used_stops = {s[0] for pattern in patterns for s in pattern}
    schedule = {
        'version': f'{mode}-{day}-{downloaded}', 'date': day.isoformat(),
        'sources': {mode: {'downloaded': downloaded, 'url': URLS[mode]}},
        'validUntil': int(dt.datetime.combine(day+dt.timedelta(days=2), dt.time(), NY).timestamp()),
        'stops': {k:v for k,v in stops.items() if k in used_stops},
        'routes': {k:v for k,v in routes.items() if k in used_routes},
        'patterns': patterns, 'trips': trips,
    }
    return schedule, (stops, routes, metadata_trips)


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
                    stations.setdefault(parent, {'id':parent, 'name':name, 'lng':lng, 'lat':lat})
                else:
                    name, lng, lat = stops[stop]
                    key = next((k for k,v in terminals.items() if ((v['lng']-lng)*.76)**2+(v['lat']-lat)**2 < (60/111000)**2), stop)
                    terminal = terminals.setdefault(key, {'id':stop, 'name':name, 'lng':lng, 'lat':lat, 'routes':[]})
                    if code not in terminal['routes']:
                        terminal['routes'].append(code)
    for terminal in terminals.values():
        terminal['routes'].sort()
    return {'shapes':shapes, 'stations':list(stations.values()), 'terminals':list(terminals.values())}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--date', type=dt.date.fromisoformat, default=dt.datetime.now(NY).date())
    parser.add_argument('--feed-dir', type=Path)
    args = parser.parse_args()
    known_shapes = json.loads((ROOT/'public/data/network.json').read_text())['shapes']
    downloaded = dt.datetime.now(dt.timezone.utc).isoformat()
    outputs, feeds = {}, []
    for mode, url in URLS.items():
        if args.feed_dir:
            content = (args.feed_dir/(mode+'.zip')).read_bytes()
        else:
            request = urllib.request.Request(url, headers={'User-Agent':'nyc-transit-map-schedule-import/0.2'})
            with urllib.request.urlopen(request, timeout=60) as response:
                content = response.read()
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            schedule, feed = generate(mode, archive, args.date, downloaded, known_shapes)
        outputs[mode+'-schedule.json'] = schedule
        feeds.append(feed)
        print(f'{mode}: {len(schedule["trips"])} trips for {args.date}, {len(schedule["patterns"])} timing patterns')
    outputs['route-meta.json'] = route_metadata(feeds)
    # Both feeds must pass before replacing any checked-in data.
    for name, value in outputs.items():
        destination = ROOT/'public/data'/name
        with tempfile.NamedTemporaryFile(mode='w', dir=destination.parent, delete=False) as f:
            json.dump(value, f, separators=(',', ':'))
            temporary = Path(f.name)
        temporary.replace(destination)


if __name__ == '__main__':
    main()
