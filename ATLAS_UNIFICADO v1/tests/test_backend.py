# Datos sintéticos solo en pruebas. No se incluyen en las salidas de usuario.
import unittest
from unittest.mock import patch
from datetime import date,timedelta
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import backend

class TestScientificCalculations(unittest.TestCase):
    def make_series(self):
        observations={}
        d=date(2001,1,1)
        while d<=date(2024,12,31):
            observations[d.isoformat()]=2.0 if d.day%2==0 else 0.0
            d+=timedelta(days=1)
        return observations
    def test_percentiles_wet_vs_all(self):
        s=self.make_series()
        wet=backend.aggregate(s,2001,2024,2001,2020,1.0,'wet')
        all_=backend.aggregate(s,2001,2024,2001,2020,1.0,'all')
        self.assertEqual(wet['thresholds']['95'],2.0)
        self.assertEqual(all_['thresholds']['80'],2.0)
        self.assertEqual(len(wet['annual']),24)
        self.assertEqual(wet['summary']['complete_years'],24)
    def test_incomplete_year_not_inflated(self):
        s=self.make_series();s.pop('2001-03-13')
        out=backend.aggregate(s,2001,2024,2001,2020)
        self.assertIsNone(out['annual'][0]['total'])
        self.assertIsNone(out['monthly'][2]['total'])
        self.assertEqual(out['summary']['complete_years'],23)
    def test_percentile_numeric(self):
        self.assertEqual(backend.pct([0,10,20,30,40],80),32)
    def test_trend_monotonic(self):
        t=backend.trend(list(range(2001,2025)),list(range(24)))
        self.assertAlmostEqual(t['slope_per_decade'],10)
        self.assertLess(t['kendall_p'],.05)
    def test_power_payload_mock_and_cache(self):
        sample={'properties':{'parameter':{'IMERG_PRECTOT':{'20010101':1.2,'20010102':-999}}},'parameters':{'IMERG_PRECTOT':{'units':'mm'}}}
        with patch.object(backend,'request_json',return_value=sample):
            with patch.object(backend,'CACHE',Path(__file__).resolve().parent / '_tmp_cache'):
                rows,url=backend.power_block('gpm',9.932,-84.079,2001,2001)
                self.assertEqual(rows['2001-01-01'],1.2)
                self.assertIsNone(rows['2001-01-02'])
        import shutil
        shutil.rmtree(Path(__file__).resolve().parent / '_tmp_cache',ignore_errors=True)
    def test_csv_import(self):
        o=backend.parse_user_csv('fecha;precipitacion_mm\n2024-01-01;2.5\n2024-01-02;0\n')
        self.assertEqual(o['2024-01-01'],2.5)

if __name__=='__main__':unittest.main()
