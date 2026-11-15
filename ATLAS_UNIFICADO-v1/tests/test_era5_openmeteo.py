# -*- coding: utf-8 -*-
"""Conector ERA5/Open-Meteo sin red (datos ARTIFICIALES)."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import era5_openmeteo as e5  # noqa: E402
import backend  # noqa: E402


class Era5Tests(unittest.TestCase):
    def test_grid_point(self):
        self.assertEqual(e5.grid_point(9.93, -84.08), (10.0, -84.0))
        self.assertEqual(e5.grid_point(10.6, -85.53), (10.5, -85.5))

    def test_parse_daily_and_unit_guard(self):
        rows = e5.parse_daily({'daily': {'time': ['2017-10-05', '2017-10-06', 'malo'],
                                         'precipitation_sum': [87.2, None, 1]},
                               'daily_units': {'precipitation_sum': 'mm'}})
        self.assertEqual(rows, {'2017-10-05': 87.2, '2017-10-06': None})
        with self.assertRaises(RuntimeError):
            e5.parse_daily({'daily': {'time': [], 'precipitation_sum': []}, 'daily_units': {'precipitation_sum': 'inch'}})

    def test_registered(self):
        self.assertIn('era5', backend.SOURCES)
        self.assertIn('era5', backend.ROBUSTNESS_MODES['fast'])
        cell = backend.grid_cell('era5', 9.93, -84.08)
        self.assertAlmostEqual(cell['center_lat'], 10.0)
        self.assertAlmostEqual(cell['center_lon'], -84.0)


if __name__ == '__main__':
    unittest.main()
