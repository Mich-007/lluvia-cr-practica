"""v6.2 · Pruebas de validación con estaciones, índices ETCCDI, bootstrap y caché.

Todas usan series construidas EN MEMORIA con respuesta conocida (no hay datos
sintéticos en el paquete) y no necesitan Internet.
"""
import json
import math
import random
import tempfile
import unittest
import urllib.request
from datetime import date, timedelta
from http.server import ThreadingHTTPServer
from pathlib import Path
from threading import Thread
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import backend
import estaciones


def dias(y0=2010, y1=2014):
    d = date(y0, 1, 1)
    while d <= date(y1, 12, 31):
        yield d.isoformat()
        d += timedelta(days=1)


def lluvia(seed=7):
    """Serie diaria con días secos y aguaceros, reproducible."""
    rng = random.Random(seed)
    out = {}
    for k in dias():
        out[k] = 0.0 if rng.random() < 0.45 else round(rng.expovariate(1 / 12), 2)
    return out


class TestGHCNParsing(unittest.TestCase):
    def test_blank_flag_and_implausible_are_dropped_not_zeroed(self):
        csv_text = ('"STATION","DATE","PRCP","PRCP_ATTRIBUTES"\n'
                    '"CS000081003","2005-06-01","0.3",",,S"\n'
                    '"CS000081003","2005-06-02",,\n'                 # faltante: NO es cero
                    '"CS000081003","2005-06-03","25.0",",X,S"\n'     # bandera de calidad
                    '"CS000081003","2005-06-04","1500.0",",,S"\n'    # inverosímil
                    '"CS000081003","2005-06-05","19.3",",,S"\n')
        data, qc = estaciones.parse_ghcn_csv(csv_text)
        self.assertEqual(data, {'2005-06-01': 0.3, '2005-06-05': 19.3})
        self.assertNotIn('2005-06-02', data)
        self.assertEqual(qc['descartados_bandera_calidad'], 1)
        self.assertEqual(qc['descartados_inverosimiles'], 1)

    def test_only_whitelisted_stations_can_be_requested(self):
        with tempfile.TemporaryDirectory() as tmp:
            for bad in ('XX123', '../../etc', 'CS000000000', 'https://evil.example'):
                with self.assertRaises(ValueError):
                    estaciones.fetch_ghcn(bad, 2001, 2002, tmp)

    def test_cached_station_is_read_without_network(self):
        with tempfile.TemporaryDirectory() as tmp:
            sid = 'CS000081003'
            Path(tmp, f'ghcn_{sid}_2010_2011.json').write_text(
                json.dumps({'data': {'2010-01-01': 4.0}, 'qc': {}, 'url': 'cache'}), encoding='utf-8')
            data, qc, url = estaciones.fetch_ghcn(sid, 2010, 2011, tmp)
            self.assertEqual(data, {'2010-01-01': 4.0})


class TestMetrics(unittest.TestCase):
    def test_identical_series_are_perfect(self):
        s = lluvia()
        c = estaciones.compare_series(s, dict(s))
        m = c['continuas']
        self.assertAlmostEqual(m['pearson_r'], 1.0, places=6)
        self.assertAlmostEqual(m['pbias_pct'], 0.0, places=6)
        self.assertAlmostEqual(m['kge'], 1.0, places=6)
        self.assertEqual(c['desfase_aplicado'], 0)
        cat1 = c['categoricas'][0]
        self.assertEqual((cat1['pod'], cat1['far'], cat1['csi']), (1.0, 0.0, 1.0))

    def test_contingency_by_hand(self):
        sat = [5, 5, 0, 0, 5]
        obs = [5, 0, 5, 0, 5]
        c = estaciones.categorical_metrics(sat, obs, 1)
        # aciertos 2, fallos 1, falsas alarmas 1, negativos 1
        self.assertEqual((c['aciertos'], c['fallos'], c['falsas_alarmas'], c['negativos_correctos']), (2, 1, 1, 1))
        self.assertAlmostEqual(c['pod'], 2 / 3, places=3)
        self.assertAlmostEqual(c['far'], 1 / 3, places=3)
        self.assertAlmostEqual(c['csi'], 0.5, places=3)
        self.assertAlmostEqual(c['fbi'], 1.0, places=3)

    def test_pbias_sign(self):
        s = lluvia()
        sat = {k: v * 1.2 for k, v in s.items()}
        m = estaciones.compare_series(sat, s)['continuas']
        self.assertAlmostEqual(m['pbias_pct'], 20.0, places=1)

    def test_day_definition_lag_is_detected_and_aligned(self):
        """La estación anota el día d la lluvia que el satélite pone en d − 1."""
        sat = lluvia(3)
        obs = {}
        for k, v in sat.items():
            nxt = (date.fromisoformat(k) + timedelta(days=1)).isoformat()
            obs[nxt] = v
        c = estaciones.compare_series(sat, obs)
        self.assertEqual(c['mejor_desfase'], -1)
        self.assertEqual(c['desfase_aplicado'], -1)
        self.assertGreater(c['continuas']['pearson_r'], 0.99)
        self.assertLess(c['sin_alinear']['continuas']['pearson_r'], 0.3)

    def test_missing_station_days_are_never_compared(self):
        s = lluvia()
        obs = {k: v for i, (k, v) in enumerate(s.items()) if i % 2 == 0}
        c = estaciones.compare_series(s, obs)
        self.assertEqual(c['n_pareados'], len(obs))

    def test_too_few_pairs(self):
        c = estaciones.compare_series({'2010-01-01': 1.0}, {'2010-01-01': 1.0})
        self.assertFalse(c['suficiente'])


class TestValidationRequest(unittest.TestCase):
    def test_rejects_unknown_station_and_outside_country(self):
        with self.assertRaises(ValueError):
            backend.validate_validation_request({'source': 'gpm', 'stations': ['CS999999999']})
        csv = 'fecha,precipitacion_mm\n' + '\n'.join(f'{k},1.0' for k in list(dias())[:100])
        with self.assertRaises(ValueError):   # Interior de México, fuera de Centroamérica
            backend.validate_validation_request({'source': 'gpm', 'stations': [],
                                                 'custom_station': {'lat': 19.2, 'lon': -90.9, 'csv': csv}})
        self.assertEqual(backend.validate_validation_request({'source':'gpm','stations':[],
            'custom_station':{'lat':12.13,'lon':-86.25,'csv':csv}})[4]['lat'],12.13)
        with self.assertRaises(ValueError):
            backend.validate_validation_request({'source': 'csv', 'stations': ['CS000081003']})

    def test_accepts_custom_station_csv(self):
        csv = 'fecha;precipitacion_mm\n' + '\n'.join(f'{k};2,5' for k in list(dias())[:100])
        src, y0, y1, ids, cst, wet = backend.validate_validation_request(
            {'source': 'gpm', 'start_year': 2010, 'end_year': 2014, 'stations': [],
             'custom_station': {'name': 'Prueba', 'lat': 9.88, 'lon': -83.63, 'csv': csv}})
        self.assertEqual(len(cst['data']), 100)
        self.assertEqual(cst['data']['2010-01-01'], 2.5)


class TestIndicesAndBootstrap(unittest.TestCase):
    def test_cwd_r10_r20_in_annual(self):
        data = {}
        for k in dias(2001, 2012):
            d = date.fromisoformat(k)
            # Cada año: 5 días seguidos de 25 mm en marzo; resto seco
            data[k] = 25.0 if (d.month == 3 and 1 <= d.day <= 5) else 0.0
        r = backend.aggregate(data, 2001, 2012, 2001, 2010)
        row = r['annual'][0]
        self.assertEqual(row['cwd'], 5)
        self.assertEqual(row['r10mm'], 5)
        self.assertEqual(row['r20mm'], 5)
        adv = backend.advanced_statistics(r, 2001, 2012, 1.0, 'gpm')
        self.assertIn('PRCPTOT', adv['etccdi']['indices'])
        self.assertIn('CWD', adv['etccdi']['indices'])

    def test_bootstrap_contains_true_slope_and_is_reproducible(self):
        rng = random.Random(1)
        years = list(range(2001, 2025))
        vals = [100 + 3 * (y - 2001) + rng.gauss(0, 4) for y in years]
        a = backend.bootstrap_slope_ci(years, vals)
        b = backend.bootstrap_slope_ci(years, vals)
        self.assertEqual(a, b)
        self.assertLess(a['boot_ci_low_per_decade'], 30)
        self.assertGreater(a['boot_ci_high_per_decade'], 30)
        self.assertIsNone(backend.bootstrap_slope_ci(years[:5], vals[:5]))


class TestStaticCache(unittest.TestCase):
    def test_app_js_is_revalidated(self):
        server = ThreadingHTTPServer(('127.0.0.1', 0), backend.Handler)
        Thread(target=server.serve_forever, daemon=True).start()
        try:
            base = f'http://127.0.0.1:{server.server_address[1]}'
            with urllib.request.urlopen(base + '/atlas/app.js', timeout=8) as r:
                self.assertEqual(r.headers['Cache-Control'], 'no-cache')
            with urllib.request.urlopen(base + '/atlas/validacion.js', timeout=8) as r:
                self.assertEqual(r.status, 200)
            with urllib.request.urlopen(base + '/api/stations?pts=9.93,-84.08', timeout=8) as r:
                d = json.loads(r.read())
                self.assertEqual(len(d['stations']), len(estaciones.STATIONS))
                self.assertEqual(len(d['stations'][0]['dist_km']), 1)
        finally:
            server.shutdown(); server.server_close()


if __name__ == '__main__':
    unittest.main()
