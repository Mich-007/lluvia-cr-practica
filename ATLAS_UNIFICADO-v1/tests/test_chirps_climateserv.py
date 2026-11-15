# -*- coding: utf-8 -*-
"""Pruebas sin red del conector CHIRPS/ClimateSERV (datos ARTIFICIALES)."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import chirps_climateserv as cs  # noqa: E402
import backend  # noqa: E402


class ChirpsTests(unittest.TestCase):
    def test_cell_polygon_contains_point_and_is_005deg(self):
        poly, (clat, clon) = cs.cell_polygon(9.43, -84.16)
        ring = poly['coordinates'][0]
        xs = [p[0] for p in ring]; ys = [p[1] for p in ring]
        self.assertTrue(min(xs) <= -84.16 <= max(xs))
        self.assertTrue(min(ys) <= 9.43 <= max(ys))
        self.assertAlmostEqual(max(xs) - min(xs), 0.05, places=3)
        self.assertAlmostEqual(clat, 9.425, places=3)
        self.assertAlmostEqual(clon, -84.175, places=3)

    def test_parse_rows_dates_and_missing(self):
        payload = {'data': [
            {'date': '10/05/2017', 'value': {'avg': 87.5}},
            {'date': '10/06/2017', 'value': {'avg': -9999}},
            {'date': '10/07/2017', 'value': {'avg': None}},
            {'date': 'malo', 'value': {'avg': 1}},
        ]}
        rows = cs.parse_rows(payload)
        self.assertEqual(rows['2017-10-05'], 87.5)
        self.assertIsNone(rows['2017-10-06'])
        self.assertIsNone(rows['2017-10-07'])
        self.assertEqual(len(rows), 3)

    def test_source_registered_with_grid(self):
        self.assertIn('chirps_auto', backend.SOURCES)
        cell = backend.grid_cell('chirps_auto', 9.93, -84.08)
        self.assertTrue(cell['available'])
        self.assertAlmostEqual(cell['dlat_deg'], 0.05)


    def test_product_agreement_warning(self):
        a = [{'total': 4400.0}] * 5
        b = [{'total': 1700.0}] * 5
        w = backend.product_agreement(a, b, 'gpm', 'chirps_auto')
        self.assertIn('difieren mucho', w['warning'])
        self.assertIn('IMERG', w['warning'])
        close = backend.product_agreement(a, [{'total': 4000.0}] * 5, 'gpm', 'chirps_auto')
        self.assertIsNone(close['warning'])
        self.assertFalse(backend.product_agreement(a, b, 'gpm', 'noaa')['applicable'])
        self.assertIsNone(backend.product_agreement(a[:2], b[:2], 'gpm', 'chirps_auto')['warning'])


if __name__ == '__main__':
    unittest.main()
