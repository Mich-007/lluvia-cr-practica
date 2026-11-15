# -*- coding: utf-8 -*-
"""Semáforo de confianza y robustez entre productos (datos ARTIFICIALES, sin red)."""
import sys
import unittest
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import backend  # noqa: E402


def series(y0, y1, base, slope_per_year):
    out = {}
    d = date(y0, 1, 1)
    while d <= date(y1, 12, 31):
        # lluvia diaria constante por año + ruido determinista pequeño
        out[d.isoformat()] = max(0.0, base + slope_per_year * (d.year - y0) + ((d.toordinal() * 7) % 5) * 0.1)
        d += timedelta(days=1)
    return out


class RobustnessTests(unittest.TestCase):
    def run_with(self, fake):
        orig = backend._product_series
        backend._product_series = lambda p, pt, a, b, prog, reuse=None: fake[p]
        try:
            return backend.trend_robustness({'lat': 9.9, 'lon': -84.0}, 'gpm', None, 2001, 2024, 1.0, 'wet', 'fast', lambda *a: None)
        finally:
            backend._product_series = orig

    def test_same_sign_significant(self):
        r = self.run_with({'gpm': series(2001, 2024, 5, 0.05), 'merra2': series(2001, 2024, 5.5, 0.04), 'era5': series(2001, 2024, 5.2, 0.03)})
        self.assertEqual(r['status'], 'ok')
        self.assertEqual(r['verdict'], 'robusta_significativa')
        self.assertEqual(r['period'], [2001, 2024])
        self.assertLess(r['mean_ratio'], 1.3)

    def test_contradictory_signs(self):
        r = self.run_with({'gpm': series(2001, 2024, 5, 0.05), 'merra2': series(2001, 2024, 6, -0.05), 'era5': series(2001, 2024, 5.5, 0.02)})
        self.assertEqual(r['verdict'], 'contradictoria')

    def test_off_and_short_period(self):
        self.assertEqual(backend.trend_robustness({}, 'gpm', None, 2001, 2024, 1, 'wet', 'off', print)['status'], 'off')
        r = backend.trend_robustness({}, 'gpm', None, 2018, 2024, 1, 'wet', 'fast', lambda *a: None)
        self.assertEqual(r['status'], 'insuficiente')


class TrafficLightTests(unittest.TestCase):
    def point(self, checks, rb=None, slope=100.0, estado='no_concluyente'):
        return {'validity': {'checks': checks}, 'robustness': rb or {'status': 'off'},
                'summary': {'annual_trend': {'slope_per_decade': slope, 'kendall_p_hr': 0.2, 'estado': estado}}}

    def test_green(self):
        rb = {'status': 'ok', 'mean_ratio': 1.1, 'verdict': 'mismo_signo_no_significativa', 'note': 'ok',
              'n_compared': 2, 'products': [{'slope_per_decade': 90}, {'slope_per_decade': 50}]}
        t = backend.traffic_light(self.point([{'status': 'ok', 'label': 'x', 'detail': 'y'}], rb))
        self.assertEqual(t['color'], 'verde')
        self.assertIn('mismo signo en 2 de 2', t['trend'])

    def test_yellow_ratio_and_red_double(self):
        base = [{'status': 'ok', 'label': 'x', 'detail': 'y'}]
        rb = {'status': 'ok', 'mean_ratio': 1.6, 'verdict': 'mismo_signo_parcial', 'note': 'n', 'n_compared': 2, 'products': []}
        self.assertEqual(backend.traffic_light(self.point(base, rb))['color'], 'amarillo')
        rb = dict(rb, mean_ratio=2.65)
        self.assertEqual(backend.traffic_light(self.point(base, rb))['color'], 'rojo')

    def test_red_from_validity(self):
        t = backend.traffic_light(self.point([{'status': 'no', 'label': 'Años', 'detail': '5 años'}]))
        self.assertEqual(t['color'], 'rojo')
        self.assertTrue(any('Años' in x for x in t['red']))


if __name__ == '__main__':
    unittest.main()
