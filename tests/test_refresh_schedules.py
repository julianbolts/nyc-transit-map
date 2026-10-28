import copy
import csv
import datetime as dt
import importlib.util
import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

spec = importlib.util.spec_from_file_location('refresh', Path(__file__).resolve().parents[1]/'scripts/refresh-schedules.py')
refresh = importlib.util.module_from_spec(spec)
spec.loader.exec_module(refresh)
DAY = dt.date(2026, 10, 27)
STAMP = '2026-10-27T12:00:00Z'
KNOWN = {'subway:s': [1], 'ferry:s': [1]}
NETWORK = {'shapes': KNOWN, 'edges': []}


def tables():
    return {
        'stops': [['stop_id','stop_name','stop_lon','stop_lat'],['a','A','-74','40.7'],['b','B','-73.99','40.71']],
        'routes': [['route_id','route_short_name','route_long_name','route_type'],['1','1','One','4']],
        'calendar': [['service_id','start_date','end_date',*refresh.WEEKDAYS],['regular','20260101','20261231','1','1','1','1','1','0','0'],['sat','20260101','20261231','0','0','0','0','0','1','0'],['sun','20260101','20261231','0','0','0','0','0','0','1']],
        'calendar_dates': [['service_id','date','exception_type'],['regular','20261027','2'],['special','20261027','1']],
        'trips': [['route_id','service_id','trip_id','trip_headsign','shape_id'],['1','regular','weekday','B','s'],['1','sat','saturday','B','s'],['1','sun','sunday','B','s'],['1','special','holiday','B','unverified-holiday']],
        'stop_times': [['trip_id','stop_id','arrival_time','departure_time','stop_sequence']] + [row for trip, hour in [('weekday','12'),('saturday','13'),('sunday','14'),('holiday','15')] for row in [[trip,'a',hour+':00:00',hour+':00:00','1'],[trip,'b',hour+':20:00',hour+':20:00','2']]],
        'shapes': [['shape_id','shape_pt_sequence','shape_pt_lon','shape_pt_lat'],['s','1','-74','40.7'],['s','2','-73.99','40.71']],
    }


def content(data=None):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w') as z:
        for name, rows in (data or tables()).items():
            text = io.StringIO()
            csv.writer(text).writerows(rows)
            z.writestr(name+'.txt', text.getvalue())
    return stream.getvalue()


def generate(data=None, mode='subway', registry=None, day=DAY):
    if registry is None:
        registry = bindings(data, mode)
    with zipfile.ZipFile(io.BytesIO(content(data))) as z:
        return refresh.generate(mode, z, day, STAMP, KNOWN, registry)[0]


def bindings(data=None, mode='subway'):
    with zipfile.ZipFile(io.BytesIO(content(data))) as z:
        return refresh.seed_registry([refresh.read_feed(mode, z)], NETWORK)['bindings']


class RefreshTests(unittest.TestCase):
    def test_weekday_variants_ignore_holidays_and_absolute_dates(self):
        data = generate()
        self.assertEqual(data['kind'], 'weekly-template')
        self.assertEqual(len(data['variants']), 3)
        self.assertEqual(len(set(data['fallbackWeek'][:5])), 1)
        self.assertNotEqual(data['fallbackWeek'][5], data['fallbackWeek'][6])
        self.assertEqual({t[0] for t in data['trips']}, {'subway:weekday','subway:saturday','subway:sunday'})
        self.assertTrue(all(len(t) == 6 for t in data['trips']))
        self.assertNotIn('validUntil', data)
        self.assertEqual(dt.datetime.fromtimestamp(data['refreshAfter'], dt.timezone.utc).isoformat(), '2026-11-01T06:15:00+00:00')

    def test_active_unverified_geometry_is_rejected(self):
        data = tables(); data['trips'][1][-1] = 'new'
        with self.assertRaisesRegex(ValueError, 'unverified geometry'):
            generate(data)

    def test_future_unverified_geometry_does_not_block_current_templates_or_metadata(self):
        data = tables()
        data['calendar'].append(['special','20261102','20261231','1','1','1','1','1','0','0'])
        result = generate(data)
        self.assertTrue(any('unverified-holiday' in note for note in result['quality']['notes']))
        self.assertTrue(all(t[3] in KNOWN for t in result['trips']))
        self.assertEqual(result['periods'][-1]['through'], '2026-11-01')
        metadata = refresh.route_metadata([refresh.metadata_feed(result)])
        self.assertNotIn('subway:unverified-holiday', metadata['shapes'])

    def test_fingerprint_allows_renamed_equivalent_shape(self):
        registry = bindings(); data = tables()
        for trip in data['trips'][1:]:
            if trip[-1] == 's': trip[-1] = 'renamed'
        for shape in data['shapes'][1:]: shape[0] = 'renamed'
        self.assertTrue(all(t[3] == 'subway:s' for t in generate(data, registry=registry)['trips']))

    def test_fingerprint_detects_changed_geometry_under_reused_id(self):
        registry = bindings(); data = tables(); data['shapes'][2][2] = '-73.98'
        with self.assertRaisesRegex(ValueError, 'unverified geometry'):
            generate(data, registry=registry)

    def test_fingerprint_detects_changed_stop_location(self):
        registry = bindings(); data = tables(); data['stops'][2][2] = '-73.98'
        with self.assertRaisesRegex(ValueError, 'unverified geometry'):
            generate(data, registry=registry)

    def test_disjoint_seasons_are_not_merged(self):
        data = tables(); data['calendar'][1][2] = '20261031'
        data['calendar'].append(['winter','20261101','20271231','1','1','1','1','1','0','0'])
        data['trips'].append(['1','winter','winter','B','s'])
        data['stop_times'] += [['winter','a','15:00:00','15:00:00','1'],['winter','b','15:30:00','15:30:00','2']]
        result = generate(data)
        old, new = result['periods'][:2]
        def ids(p): return {result['trips'][i][0] for i in result['variants'][p['week'][0]]}
        self.assertEqual(ids(old), {'subway:weekday'})
        self.assertEqual(ids(new), {'subway:winter'})
        self.assertEqual(old['through'], '2026-10-31')
        self.assertEqual(new['from'], '2026-11-01')

    def test_expired_feed_produces_a_reusable_fallback_week(self):
        data = tables()
        for row in data['calendar'][1:]: row[2] = '20261001'
        result = generate(data)
        self.assertEqual(len(result['fallbackWeek']), 7)
        self.assertTrue(any('coverage ends' in note for note in result['quality']['notes']))

    def test_no_sunday_service_is_an_explicit_empty_variant(self):
        data = tables(); data['calendar'][3][9] = '0'
        result = generate(data)
        self.assertEqual(result['variants'][result['fallbackWeek'][6]], [])

    def test_calendar_dates_only_infers_regular_week_and_records_dates(self):
        data = tables(); data.pop('calendar')
        data['calendar_dates'] = [['service_id','date','exception_type']]
        for offset in range(21):
            day = dt.date(2026,10,5)+dt.timedelta(days=offset)
            service = 'regular' if day.weekday()<5 else 'sat' if day.weekday()==5 else 'sun'
            data['calendar_dates'].append([service, day.strftime('%Y%m%d'), '1'])
        result = generate(data)
        self.assertEqual(len(data['calendar_dates']), 22)
        self.assertEqual(len(result['variants']), 3)
        self.assertTrue(any('monday inferred' in note for note in result['quality']['notes']))

    def test_one_failed_mode_retains_previous_templates_and_updates_healthy_mode(self):
        previous = {mode: generate(mode=mode) for mode in refresh.URLS}
        registry = bindings() | bindings(mode='ferry')
        def fetch(mode):
            if mode == 'ferry': raise OSError('upstream unavailable')
            return content()
        bundle, report, updated = refresh.refresh(DAY, '2026-10-28T00:00:00Z', NETWORK, registry, previous, fetch)
        self.assertTrue(updated)
        self.assertIs(bundle['schedules']['ferry'], previous['ferry'])
        self.assertNotEqual(bundle['schedules']['subway']['generatedAt'], previous['subway']['generatedAt'])
        self.assertTrue(any('ferry: retained' in note for note in report))
        self.assertIn('ferry:s', bundle['assets']['metadata']['shapes'])

    def test_failed_refresh_cannot_replace_previous_templates_with_invalid_candidates(self):
        previous = {mode: generate(mode=mode) for mode in refresh.URLS}
        before = copy.deepcopy(previous)
        def fetch(mode): raise OSError('offline')
        bundle, report, updated = refresh.refresh(DAY, STAMP, NETWORK, {}, previous, fetch)
        self.assertFalse(updated)
        self.assertEqual(bundle['schedules'], before)
        self.assertEqual(previous, before)
        self.assertEqual(len(report), 2)

    def test_initial_import_requires_usable_data_for_both_modes(self):
        def fetch(mode): raise OSError('offline')
        with self.assertRaisesRegex(ValueError, 'initial templates'):
            refresh.refresh(DAY, STAMP, NETWORK, {}, {}, fetch)

    def test_bad_stop_times_are_rejected(self):
        data = tables(); data['stop_times'][2][2] = '11:00:00'
        with self.assertRaisesRegex(ValueError, 'Nonmonotonic'):
            generate(data)

    def test_overnight_offsets_remain_greater_than_24_hours(self):
        data = tables(); data['stop_times'][1][2:4] = ['23:50:00']*2
        data['stop_times'][2][2:4] = ['25:00:00']*2
        result = generate(data)
        trip = next(t for t in result['trips'] if t[0]=='subway:weekday')
        self.assertEqual(trip[5] + result['patterns'][trip[4]][-1][2], 25*3600)

    def test_refresh_after_crosses_year_boundary(self):
        self.assertEqual(dt.datetime.fromtimestamp(refresh.next_refresh(dt.date(2026,12,15)), dt.timezone.utc).isoformat(), '2027-01-01T06:15:00+00:00')

    def test_gtfs_clock_during_dst_transition(self):
        for day, expected in [(dt.date(2026,3,8),'2026-03-08T12:00:00-04:00'),(dt.date(2026,11,1),'2026-11-01T12:00:00-05:00')]:
            self.assertEqual(dt.datetime.fromtimestamp(refresh.service_base(day)+43200,refresh.NY).isoformat(), expected)

    def test_staged_output_is_parseable(self):
        with tempfile.TemporaryDirectory() as directory:
            refresh.write_outputs(Path(directory), {'a.json': {'x': 1}, 'b.json': {'x': 2}})
            self.assertEqual(json.loads((Path(directory)/'b.json').read_text()), {'x': 2})
            self.assertEqual(len(list(Path(directory).iterdir())), 2)


if __name__ == '__main__':
    unittest.main()
