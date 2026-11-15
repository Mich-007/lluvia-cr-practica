"""Pruebas con lluvia artificial exclusivamente en memoria, no en el paquete de datos."""
import io
import json
import tempfile
import time
import unittest
import urllib.error
import urllib.request
import zipfile
from datetime import date, timedelta
from http.server import ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from unittest.mock import patch
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import backend


def serie_prueba():
    d=date(2001,1,1)
    result={}
    while d<=date(2024,12,31):
        result[d.isoformat()]=round((d.timetuple().tm_yday%39)/2.0+1,2)
        d+=timedelta(days=1)
    result['2012-05-09']=None
    for x,v in [('2008-10-11',110),('2008-10-12',125),('2008-10-14',135),
                ('2023-11-04',140),('2023-11-05',170),('2024-04-01',230)]:
        result[x]=v
    return result


class TestExtremeWorkflow(unittest.TestCase):
    def test_percentiles_daily_episode_grouping(self):
        s=serie_prueba()
        r=backend.aggregate(s,2001,2024,2001,2020,1.0,'wet')
        self.assertLess(r['thresholds']['90'],r['thresholds']['95'])
        self.assertLess(r['thresholds']['95'],r['thresholds']['99'])
        dates=[row['fecha'] for row in r['extreme_days']['99']]
        self.assertIn('2008-10-11',dates)
        self.assertIn('2008-10-12',dates)
        e=next(e for e in r['extreme_events']['99'] if e['fecha_inicio']=='2008-10-11')
        self.assertEqual(e['duracion_dias'],2)
        self.assertEqual(e['acumulado_mm'],235)
        self.assertEqual(r['annual'][11]['year'],2012)
        self.assertIsNone(r['annual'][11]['event_counts']['99'])
        self.assertEqual(r['summary']['complete_years'],23)
        self.assertEqual(r['summary']['extreme_days_full_series']['99'],len(r['extreme_days']['99']))
        self.assertEqual(r['extreme_events']['99'][-1]['fecha_pico'],'2024-04-01')

    def test_txt_zip_http_download(self):
        with tempfile.TemporaryDirectory() as tmp:
            base=Path(tmp)
            with patch.object(backend,'REPORTS',base):
                with patch.object(backend,'get_nasa_data',side_effect=lambda *a:(serie_prueba(),['PRUEBA - NO NASA'])):
                    jid=backend.start_job({'source':'gpm','start_year':2001,'end_year':2024,
                     'ref_start':2001,'ref_end':2020,'population':'wet','wet_min':1,
                     'points':[{'name':'Prueba local','lat':9.9,'lon':-84.1}]})
                    for _ in range(200):
                        if backend.JOBS[jid]['state'] in ('done','error'):break
                        time.sleep(.05)
                    result=backend.JOBS[jid]
                    self.assertEqual(result['state'],'done',result['error'])
                    info=result['result']
                    folder=Path(info['saved_to'])
                    z=folder/'DATOS_TXT_COMPLETOS.zip'
                    self.assertTrue(z.is_file())
                    names=[x['name'] for x in info['exports']]
                    self.assertIn('TODOS_LOS_PUNTOS_DIAS_EXTREMOS.txt',names)
                    self.assertTrue(any('_tendencias_umbrales_fijos.txt' in x for x in names))
                    self.assertTrue(any('_P99_episodios.txt' in x for x in names))
                    self.assertTrue(any('SOLO_EVENTOS_EXTREMOS.txt' in x for x in names))
                    with zipfile.ZipFile(z,'r') as zf:
                        self.assertTrue(all(name.endswith('.txt') for name in zf.namelist()))
                        data=zf.read('TODOS_LOS_PUNTOS_DIAS_EXTREMOS.txt').decode('utf-8-sig')
                        self.assertIn('2008-10-11',data)
                        self.assertIn('GPM IMERG',data)
                        fixed=zf.read('01_prueba_local_tendencias_umbrales_fijos.txt').decode('utf-8-sig')
                        self.assertIn('cambio_porcentual',fixed)
                        self.assertIn('50.8',fixed)
                    server=ThreadingHTTPServer(('127.0.0.1',0),backend.Handler)
                    thread=Thread(target=server.serve_forever,daemon=True);thread.start()
                    try:
                        endpoint=f'http://127.0.0.1:{server.server_port}/api/download?id={jid}&name=DATOS_TXT_COMPLETOS.zip'
                        with urllib.request.urlopen(endpoint,timeout=8) as resp:
                            self.assertEqual(resp.status,200)
                            self.assertEqual(resp.headers.get_content_type(),'application/zip')
                            self.assertTrue(resp.read(2).startswith(b'PK'))
                        blocked=f'http://127.0.0.1:{server.server_port}/api/download?id={jid}&name=../backend.py'
                        with self.assertRaises(urllib.error.HTTPError) as err:
                            urllib.request.urlopen(blocked,timeout=8)
                        self.assertEqual(err.exception.code,404)
                    finally:
                        server.shutdown();server.server_close();thread.join(timeout=5)

    def test_fixed_thresholds_complete_years_and_relative_change(self):
        s=serie_prueba()
        r=backend.aggregate(s,2001,2024,2001,2020)
        self.assertEqual(r['annual'][7]['fixed_days']['50.8'],3)
        self.assertIsNone(r['annual'][11]['fixed_days']['50.8'])
        self.assertEqual(r['annual'][-1]['fixed_days']['127'],1)
        self.assertEqual(r['summary']['fixed_threshold_trends']['50.8']['n'],23)
        self.assertEqual(r['summary']['fixed_threshold_mean_days']['50.8'],round(6/23,2))
        annual_csv=backend.generate_csv({'annual':r['annual']},'annual')
        self.assertIn('dias_desde_127_0_mm',annual_csv.splitlines()[0])
        # La variación porcentual procede de los extremos de la recta ajustada.
        years=list(range(2001,2021))
        tr=backend.trend(years,[10+(y-2001) for y in years])
        self.assertEqual(tr['slope_per_decade'],10)
        self.assertAlmostEqual(tr['relative_change_pct'],190)
        self.assertEqual(tr['first_year'],2001)
        self.assertEqual(tr['last_year'],2020)
        self.assertIsNone(backend.trend(years,[0]*20)['relative_change_pct'])
        self.assertIsNone(backend.trend(years[:9],[1]*9)['relative_change_pct'])
        self.assertIsNone(backend.trend(years,[20-(y-2001)*2 for y in years])['relative_change_pct'])

    def test_unlisted_coordinates_accepted(self):
        _,_,_,_,_,pts,_,_=backend.validate_request({'source':'csv','start_year':2001,'end_year':2024,
          'ref_start':2001,'ref_end':2020,'points':[{'name':'Punto libre','lat':9.93523,'lon':-84.09058}]})
        self.assertEqual(pts[0]['lat'],9.93523)
        self.assertEqual(pts[0]['lon'],-84.09058)

if __name__=='__main__':unittest.main()
