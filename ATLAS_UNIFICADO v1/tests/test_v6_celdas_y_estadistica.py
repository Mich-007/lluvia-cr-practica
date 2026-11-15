"""Pruebas de la v6. Lluvia artificial SOLO en memoria, nunca en el paquete.

Cada prueba compara contra algo que se sabe por otra vía: un cálculo a mano,
una propiedad matemática o una serie construida con respuesta conocida.
Ejecutar desde la carpeta del visor:   python -m unittest discover -s tests -v
"""
import json
import math
import random
import tempfile
import time
import unittest
import urllib.request
from datetime import date, timedelta
from http.server import ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from unittest.mock import patch
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import backend


def serie_diaria(y0=2001, y1=2024, tendencia=0.0, seed=7):
    """Lluvia diaria artificial: intermitente y con cola larga (gamma)."""
    rnd = random.Random(seed)
    out = {}
    d = date(y0, 1, 1)
    while d <= date(y1, 12, 31):
        f = 1 + tendencia * (d.year - y0) / 10
        out[d.isoformat()] = round(rnd.gammavariate(0.75, 16 * f), 2) if rnd.random() < 0.5 else 0.0
        d += timedelta(days=1)
    return out


class TestTerritorioYCeldas(unittest.TestCase):
    def test_puntos_conocidos(self):
        """Tierra, mar, países vecinos e Isla del Coco."""
        self.assertTrue(backend.in_country(9.932, -84.079))          # San José
        self.assertTrue(backend.in_country(5.535, -87.09))           # centro de la Isla del Coco
        # La coordenada del catálogo cae en la orilla, fuera del polígono de 10
        # vértices, pero dentro de la tolerancia costera: se acepta.
        self.assertFalse(backend.in_country(5.528, -87.071))
        self.assertLessEqual(backend.distance_to_country_km(5.528, -87.071), backend.COAST_TOLERANCE_KM)
        self.assertTrue(backend.cell_report('gpm', 5.528, -87.071)['accepted'])
        self.assertFalse(backend.in_country(9.3, -85.4))             # Pacífico
        self.assertEqual(backend.country_at(12.13, -86.25), 'Nicaragua')
        self.assertEqual(backend.country_at(8.43, -82.43), 'Panama')

    def test_celda_imerg_tamano_y_centro(self):
        """IMERG 0,1°: centro en x,x5 y lado ≈ 11 km (111,2 km por grado)."""
        c = backend.grid_cell('gpm', 9.932, -84.079)
        self.assertAlmostEqual(c['center_lat'], 9.95, places=5)
        self.assertAlmostEqual(c['center_lon'], -84.05, places=5)
        self.assertAlmostEqual(c['height_km'], 11.12, places=2)
        self.assertAlmostEqual(c['width_km'], 0.1 * 111.2 * math.cos(math.radians(9.95)), places=2)
        self.assertTrue(c['lat_min'] <= 9.932 <= c['lat_max'] and c['lon_min'] <= -84.079 <= c['lon_max'])

    def test_celda_merra2_y_bloque3(self):
        m = backend.grid_cell('merra2', 9.932, -84.079)
        self.assertAlmostEqual(m['height_km'], 0.5 * 111.2, places=1)     # ≈ 55,6 km
        self.assertGreater(m['width_km'], 60)                              # ⅝° ≈ 68 km
        b = backend.grid_cell('gpm', 9.932, -84.079, 'block3')
        self.assertAlmostEqual(b['height_km'], 3 * 11.12, places=1)
        self.assertEqual(b['cell_id'], backend.grid_cell('gpm', 9.932, -84.079)['cell_id'])

    def test_mismo_punto_misma_celda(self):
        """Dos clics a 300 m dentro de la misma celda deben dar la misma celda."""
        a = backend.grid_cell('gpm', 9.932, -84.079)['cell_id']
        b = backend.grid_cell('gpm', 9.935, -84.082)['cell_id']
        self.assertEqual(a, b)

    def test_veredictos(self):
        self.assertEqual(backend.cell_report('gpm', 9.932, -84.079)['verdict'], 'apta')
        self.assertEqual(backend.cell_report('gpm', 9.977, -84.834)['verdict'], 'no_recomendada')  # Puntarenas, lengua de arena
        self.assertEqual(backend.cell_report('gpm', 9.3, -85.4)['verdict'], 'fuera')
        self.assertEqual(backend.cell_report('gpm', 5.528, -87.071)['verdict'], 'reservas')        # isla oceánica
        fr = backend.cell_report('gpm', 9.932, -84.079)['land_fraction']
        self.assertAlmostEqual(fr['costa_rica'] + fr['mar'] + fr['otro_pais'], 1.0, places=2)

    def test_validacion_rechaza_fuera_del_pais(self):
        base = {'source': 'csv', 'start_year': 2001, 'end_year': 2024, 'ref_start': 2001, 'ref_end': 2020}
        with self.assertRaises(ValueError):
            backend.validate_request({**base, 'points': [{'name': 'Mar', 'lat': 9.3, 'lon': -85.4}]})
        with self.assertRaises(ValueError):   # 3x3 solo IMERG
            backend.validate_request({**base, 'area_mode': 'block3', 'points': [{'name': 'SJ', 'lat': 9.93, 'lon': -84.08}]})
        r = backend.validate_request({**base, 'source': 'gpm', 'area_mode': 'block3',
                                      'points': [{'name': 'SJ', 'lat': 9.93, 'lon': -84.08}]})
        self.assertEqual(len(r), 8)                     # la tupla de la v5 no cambia de forma
        self.assertEqual(r[5][0]['area_mode'], 'block3')


class TestEstadistica(unittest.TestCase):
    def test_holm_a_mano(self):
        """p = [0,01; 0,04; 0,03] → ordenados ×3, ×2, ×1 → 0,03; 0,06; 0,06 (monótono)."""
        self.assertEqual(backend.holm([0.01, 0.04, 0.03]), [0.03, 0.06, 0.06])
        self.assertEqual(backend.holm([0.02, None]), [0.02, None])   # None no cuenta

    def test_rangos_con_empates(self):
        self.assertEqual(backend.rankdata([10, 20, 20, 30]), [1, 2.5, 2.5, 4])

    def test_ic_contiene_pendiente_y_coincide_con_p(self):
        """Coherencia: si p < 0,05 el IC no cruza el cero, y viceversa."""
        rnd = random.Random(3)
        years = list(range(2001, 2025))
        for slope in (0.0, 0.3, 1.5):
            for k in range(5):
                vals = [slope * (y - 2001) + rnd.gauss(0, 3) for y in years]
                t = backend.trend(years, vals)
                lo, hi = t['ci_low_per_decade'], t['ci_high_per_decade']
                self.assertLessEqual(lo, t['slope_per_decade'])
                self.assertGreaterEqual(hi, t['slope_per_decade'])
                cruza = lo <= 0 <= hi
                if t['kendall_p_hr'] < 0.05:
                    self.assertFalse(cruza, (slope, k, t))
                elif t['kendall_p_hr'] > 0.06:
                    self.assertTrue(cruza, (slope, k, t))

    def test_hamed_rao_nunca_relaja(self):
        """Decisión del proyecto: la corrección solo vuelve la prueba MÁS exigente."""
        rnd = random.Random(11)
        years = list(range(2001, 2031))
        for _ in range(30):
            x = 0.0
            vals = []
            for _y in years:
                x = 0.7 * x + rnd.gauss(0, 1)
                vals.append(x)
            t = backend.trend(years, vals)
            self.assertGreaterEqual(t['kendall_p_hr'] + 1e-12, t['kendall_p'])

    def test_no_inventa_tendencia(self):
        """Ruido puro: con α = 0,05 deben salir «significativas» ≈ 5 %, no 30 %."""
        rnd = random.Random(5)
        years = list(range(2001, 2026))
        sig = sum(backend.trend(years, [rnd.gauss(0, 1) for _ in years])['kendall_p_hr'] < 0.05 for _ in range(200))
        self.assertLess(sig / 200, 0.12)

    def test_porcentaje_v5_intacto(self):
        """El % del círculo sigue siendo 100·(final − inicial)/inicial de la recta."""
        years = list(range(2001, 2021))
        t = backend.trend(years, [10 + (y - 2001) for y in years])
        self.assertAlmostEqual(t['relative_change_pct'], 190)
        self.assertAlmostEqual(t['pivot_value'], t['intercept'] + t['slope_per_decade'] / 10 * t['pivot_year'], places=4)

    def test_estado(self):
        self.assertEqual(backend.classify_trend({'slope_per_decade': 2, 'kendall_p_hr': 0.01}), 'creciente')
        self.assertEqual(backend.classify_trend({'slope_per_decade': -2, 'kendall_p_hr': 0.01}), 'decreciente')
        self.assertEqual(backend.classify_trend({'slope_per_decade': 2, 'kendall_p_hr': 0.2}), 'no_concluyente')
        self.assertEqual(backend.classify_trend({'slope_per_decade': None}), 'datos_insuficientes')
        self.assertEqual(backend.classify_trend({'slope_per_decade': 2, 'kendall_p_hr': 0.01}, 0.09), 'no_concluyente')

    def test_salto_vs_tendencia(self):
        """BIC distingue un escalón de una rampa; Pettitt ubica el escalón."""
        rnd = random.Random(2)
        years = list(range(2001, 2025))
        salto = [5 + (8 if y >= 2013 else 0) + rnd.gauss(0, 1) for y in years]
        rampa = [5 + 0.5 * (y - 2001) + rnd.gauss(0, 1) for y in years]
        ms = backend.compare_models(years, salto)
        self.assertIn(ms['modelo_preferido'], ('salto', 'ambos'))
        self.assertLessEqual(abs(ms['anio_corte'] - 2013), 1)
        self.assertIn(backend.compare_models(years, rampa)['modelo_preferido'], ('tendencia', 'ambos'))
        idx, _, p = backend.pettitt(salto)
        self.assertLess(p, 0.01)
        self.assertLessEqual(abs(years[idx + 1] - 2013), 1)

    def test_aviso_instrumental_2014(self):
        years = list(range(2001, 2025))
        vals = [5 + (9 if y >= 2014 else 0) + 0.1 * (y % 3) for y in years]
        cp = backend.change_point_analysis(years, vals, 'gpm')
        self.assertTrue(cp['instrumental_flag'])
        self.assertIn('TRMM', cp['texto'])
        self.assertFalse(backend.change_point_analysis(years, vals, 'merra2')['instrumental_flag'])

    def test_cusum_termina_en_cero(self):
        cp = backend.change_point_analysis(list(range(2001, 2025)), [random.Random(1).random() * 10 + i for i in range(24)], 'gpm')
        self.assertAlmostEqual(cp['cusum'][-1], 0.0, places=6)

    def test_gumbel_a_mano(self):
        """x_T = u − α·ln(−ln(1−1/T)), con α = √6·s/π y u = media − 0,5772·α."""
        xs = [50, 60, 55, 70, 80, 65, 58, 62, 90, 75, 68, 72]
        annual = [{'rx1day': v} for v in xs]
        r = backend.return_levels(annual)
        import statistics
        a = math.sqrt(6) * statistics.stdev(xs) / math.pi
        u = statistics.mean(xs) - 0.5772156649 * a
        x10 = u - a * math.log(-math.log(1 - 1 / 10))
        self.assertAlmostEqual(next(l['mm'] for l in r['levels'] if l['T'] == 10), round(x10, 2), places=2)
        self.assertTrue(all(r['levels'][k]['mm'] < r['levels'][k + 1]['mm'] for k in range(4)))

    def test_cuantiles_detectan_cola_mas_intensa(self):
        """Si la segunda mitad tiene más lluvia, todos los cuantiles suben."""
        agg = backend.aggregate(serie_diaria(tendencia=0.4), 2001, 2024, 2001, 2020)
        q = backend.quantile_shift(agg['daily'], 2001, 2024, 1.0)
        self.assertTrue(all(r['ratio_pct'] > 0 for r in q['rows']))

    def test_temporadas_suman_el_anio(self):
        """Seca (dic-abr) + lluviosa (may-nov) = total anual, mismo año calendario."""
        agg = backend.aggregate(serie_diaria(), 2001, 2024, 2001, 2020)
        s = backend.seasonal_analysis(agg['monthly'], 2001, 2024)
        for k, y in enumerate(s['years']):
            tot = next(r['total'] for r in agg['annual'] if r['year'] == y)
            self.assertAlmostEqual(s['dry'][k] + s['rainy'][k], tot, places=2)


class TestFlujoCompleto(unittest.TestCase):
    def _run(self, args, fake):
        with tempfile.TemporaryDirectory() as tmp, patch.object(backend, 'REPORTS', Path(tmp)), \
                patch.object(backend, 'get_nasa_data', side_effect=fake):
            jid = backend.start_job(args)
            for _ in range(400):
                if backend.JOBS[jid]['state'] in ('done', 'error'):
                    break
                time.sleep(.05)
            job = backend.JOBS[jid]
            self.assertEqual(job['state'], 'done', job['error'])
            return jid, job['result']

    def test_resultado_v6_completo_y_json_valido(self):
        args = {'source': 'gpm', 'start_year': 2001, 'end_year': 2024, 'ref_start': 2001, 'ref_end': 2020,
                'points': [{'name': 'San José', 'lat': 9.932, 'lon': -84.079},
                           {'name': 'Mismo píxel', 'lat': 9.935, 'lon': -84.082},
                           {'name': 'Liberia', 'lat': 10.634, 'lon': -85.44}]}
        _, out = self._run(args, lambda *a: (serie_diaria(tendencia=0.2, seed=int(abs(a[1] * 100))), ['PRUEBA']))
        json.dumps(out, allow_nan=False)                     # sin NaN: la web no se rompe
        p = out['points'][0]
        # Nombres de la v5 intactos
        for k in ('annual_trend', 'fixed_threshold_trends', 'fixed_threshold_mean_days', 'extreme_count_trends'):
            self.assertIn(k, p['summary'])
        self.assertIn('relative_change_pct', p['summary']['fixed_threshold_trends']['50.8'])
        # Lo nuevo
        for k in ('change_points', 'quantile_shift', 'seasonal', 'climatology_halves', 'concentration', 'return_levels'):
            self.assertIn(k, p['advanced'])
        tr = p['summary']['annual_trend']
        self.assertGreaterEqual(tr['kendall_p_holm'], tr['kendall_p_hr'])
        self.assertIn(tr['estado'], backend.STATE_NAMES if hasattr(backend, 'STATE_NAMES') else
                      ('creciente', 'decreciente', 'no_concluyente', 'datos_insuficientes'))
        self.assertEqual(tr['holm_family_size'], 3)
        # Los dos puntos en la misma celda quedan avisados
        ids = [c['id'] for c in out['points'][1]['validity']['checks']]
        self.assertIn('celda_compartida', ids)
        self.assertNotIn('celda_compartida', [c['id'] for c in out['points'][2]['validity']['checks']])
        names = [e['name'] for e in out['exports']]
        self.assertTrue(any(n.endswith('_tendencias_avanzadas.txt') for n in names))
        self.assertTrue(any(n.endswith('_celda_y_validez.txt') for n in names))

    def test_bloque3_promedia_nueve_celdas(self):
        """Cada celda devuelve un valor constante distinto: el promedio es exacto.
        Si falta una celda un día, ese día queda vacío (no se promedian 8)."""
        calls = []

        def fake(src, lat, lon, y0, y1, prog):
            calls.append((lat, lon))
            k = len(calls)
            d = {}
            day = date(y0, 1, 1)
            while day <= date(y1, 12, 31):
                d[day.isoformat()] = float(k)
                day += timedelta(days=1)
            if k == 5:
                d['2005-06-01'] = None
            return d, [f'celda {k}']
        with patch.object(backend, 'get_nasa_data', side_effect=fake):
            data, urls = backend.get_area_data('gpm', 9.932, -84.079, 2001, 2010, lambda m: None, 3)
        self.assertEqual(len(calls), 9)
        self.assertAlmostEqual(data['2005-05-31'], 5.0)          # (1+…+9)/9
        self.assertIsNone(data['2005-06-01'])
        lats = sorted({round(c[0], 2) for c in calls})
        self.assertEqual(lats, [9.85, 9.95, 10.05])               # celdas vecinas reales, 0,1° aparte

    def test_endpoint_celda(self):
        server = ThreadingHTTPServer(('127.0.0.1', 0), backend.Handler)
        th = Thread(target=server.serve_forever, daemon=True)
        th.start()
        try:
            url = f'http://127.0.0.1:{server.server_port}/api/cell?lat=9.932&lon=-84.079&source=gpm&area=cell'
            with urllib.request.urlopen(url, timeout=8) as r:
                d = json.loads(r.read())
            self.assertTrue(d['accepted'])
            self.assertEqual(d['cell']['grid_label'], 'GPM IMERG 0,1° × 0,1°')
            self.assertGreater(d['cell']['width_m'], 10000)
        finally:
            server.shutdown()
            server.server_close()


if __name__ == '__main__':
    unittest.main()
