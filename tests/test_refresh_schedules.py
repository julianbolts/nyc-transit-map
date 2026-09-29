import csv
import datetime as dt
import importlib.util
import io
import unittest
import zipfile
from pathlib import Path

spec = importlib.util.spec_from_file_location('refresh', Path(__file__).resolve().parents[1]/'scripts/refresh-schedules.py')
refresh = importlib.util.module_from_spec(spec)
spec.loader.exec_module(refresh)


def archive():
    tables = {
        'stops': [['stop_id','stop_name','stop_lon','stop_lat'],['a','A','-74','40.7'],['b','B','-73.99','40.71']],
        'routes': [['route_id','route_short_name','route_long_name','route_type'],['1','1','One','1']],
        'calendar': [['service_id','start_date','end_date','monday','tuesday','wednesday','thursday','friday','saturday','sunday'],['regular','20260101','20261231','1','1','1','1','1','1','1']],
        'calendar_dates': [['service_id','date','exception_type'],['regular','20260929','2'],['special','20260929','1']],
        'trips': [['route_id','service_id','trip_id','trip_headsign','shape_id'],['1','regular','overnight','B','s'],['1','special','holiday','B','s']],
        'stop_times': [['trip_id','stop_id','arrival_time','departure_time','stop_sequence'],['overnight','a','23:50:00','23:50:00','1'],['overnight','b','25:00:00','25:00:00','2'],['holiday','a','12:00:00','12:00:00','1'],['holiday','b','12:20:00','12:20:00','2']],
    }
    stream = io.BytesIO()
    with zipfile.ZipFile(stream,'w') as z:
        for name, rows in tables.items():
            f = io.StringIO();csv.writer(f).writerows(rows);z.writestr(name+'.txt',f.getvalue())
    stream.seek(0)
    return zipfile.ZipFile(stream)


class RefreshTests(unittest.TestCase):
    def test_calendar_exceptions_and_overnight_carryover(self):
        with archive() as z:
            data,_ = refresh.generate('subway',z,dt.date(2026,9,29),'2026-09-29T00:00:00Z',{'subway:s'})
        ids = {t[0] for t in data['trips']}
        self.assertIn('subway:holiday:0',ids)
        self.assertNotIn('subway:overnight:0',ids)
        self.assertIn('subway:overnight:-1',ids)
        self.assertIn('subway:overnight:1',ids)
        self.assertEqual(dt.datetime.fromtimestamp(data['validUntil'],refresh.NY).isoformat(),'2026-10-01T00:00:00-04:00')

    def test_new_geometry_blocks_import(self):
        with archive() as z, self.assertRaisesRegex(ValueError,'new shapes'):
            refresh.generate('subway',z,dt.date(2026,9,29),'2026-09-29T00:00:00Z',{})

    def test_gtfs_clock_during_dst_transition(self):
        spring = refresh.service_base(dt.date(2026,3,8))
        fall = refresh.service_base(dt.date(2026,11,1))
        self.assertEqual(dt.datetime.fromtimestamp(spring+12*3600,refresh.NY).isoformat(),'2026-03-08T12:00:00-04:00')
        self.assertEqual(dt.datetime.fromtimestamp(fall+12*3600,refresh.NY).isoformat(),'2026-11-01T12:00:00-05:00')


if __name__ == '__main__':
    unittest.main()
