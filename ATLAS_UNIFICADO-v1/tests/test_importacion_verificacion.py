"""Casos controlados artificiales: solo pruebas, nunca datos del visor."""
import json
import math
import sys
import tempfile
import time
import unittest
from datetime import date, datetime, timedelta
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import backend
from precip_tools import import_precip, inspect_csv, quality_audit, compare_series
from precip_sources import parse_dly, get_noaa


class Importacion(unittest.TestCase):
    def test_giovanni_header_and_decimal_comma(self):
        csv='Title: precipitation\nUnits: mm/day\nTime;Rainf_f_tavg\n2020-01-01;1,5\n2020-01-02;2,5\n'
        self.assertEqual(inspect_csv(csv)['skipped_header_lines'],2)
        s,m=import_precip(csv,{'unit':'mm_day'})
        self.assertEqual(s,{'2020-01-01':1.5,'2020-01-02':2.5})
        self.assertEqual(len(m['input_sha256']),64)

    def test_units_and_no_double_integration(self):
        for u,v,expected in [('inch','2',50.8),('tenths_mm','125',12.5),('mm_hour','2',48),('kg_m2_s','0.0001',8.64),('mm','50.8',50.8)]:
            with self.subTest(unit=u):
                s,m=import_precip('date,prcp\n2020-01-01,'+v,{'unit':u})
                self.assertAlmostEqual(s['2020-01-01'],expected)

    def test_gldas_daily_integration_and_missing_slots(self):
        times=[datetime(2020,1,1)+timedelta(hours=3*i) for i in range(16)]
        csv='time,Rainf_f_tavg\n'+'\n'.join(f'{t.isoformat()},0.0001' for i,t in enumerate(times) if i!=10)
        s,m=import_precip(csv,{'unit':'kg_m2_s','temporal':'subdaily','interval_hours':3})
        self.assertAlmostEqual(s['2020-01-01'],8.64)
        self.assertIsNone(s['2020-01-02'])
        self.assertEqual(m['counts']['incomplete_subdaily_days'],1)

    def test_end_of_interval_and_local_day(self):
        # Ocho intervalos UTC 06–06: lluvia acumulada al fin de cada intervalo.
        times=[datetime(2020,1,1,9)+timedelta(hours=3*i) for i in range(8)]
        csv='time,mm\n'+'\n'.join(f'{t.isoformat()}Z,3' for t in times)
        s,m=import_precip(csv,{'unit':'mm','temporal':'subdaily','interval_hours':3,'stamp_position':'end','utc_offset':-6})
        self.assertEqual(s,{'2020-01-01':24})
        with self.assertRaisesRegex(ValueError,'no se alinean'):
            import_precip(csv,{'unit':'mm','temporal':'subdaily','interval_hours':3,'day_start':1})

    def test_duplicate_conflict_cannot_be_restored(self):
        csv='fecha,mm\n2020-01-01,4\n2020-01-01,4\n2020-01-02,2\n2020-01-02,3\n2020-01-02,2\n2020-01-03,-2\n2020-01-04,T\n2020-01-05,nan\n2020-02-30,8\n'
        s,m=import_precip(csv)
        self.assertEqual(s['2020-01-01'],4)
        self.assertIsNone(s['2020-01-02'])
        self.assertIsNone(s['2020-01-03'])
        self.assertEqual(s['2020-01-04'],0)
        self.assertIsNone(s['2020-01-05'])
        self.assertEqual(m['counts']['duplicates_identical'],1)
        self.assertEqual(m['counts']['invalid_dates'],1)

    def test_mixed_stations_require_filter(self):
        csv='DATE,STATION,PRCP\n2020-01-01,A,1\n2020-01-01,B,9\n'
        with self.assertRaisesRegex(ValueError,'varios puntos'):import_precip(csv)
        s,_=import_precip(csv,{'group_column':'STATION','group_value':'B'})
        self.assertEqual(s['2020-01-01'],9)

    def test_monthly_non_precip_and_instantaneous_rejected(self):
        for csv,opt in [('date,prcp\n'+'\n'.join(f'2020-{m:02d}-01,200' for m in range(1,8)),{}),
                        ('date,NDVI\n2020-01-01,0.4',{'value_column':'NDVI','confirm_precipitation':True}),
                        ('date,Rainf_f_inst\n2020-01-01,0.001',{'unit':'kg_m2_s'}),
                        ('date,MDPR\n2020-01-01,150',{'value_column':'MDPR','confirm_precipitation':True})]:
            with self.subTest(csv=csv[:25]),self.assertRaises(ValueError):import_precip(csv,opt)

    def test_daily_multiple_hours_rejected(self):
        with self.assertRaisesRegex(ValueError,'varias horas'):
            import_precip('time,prcp\n2020-01-01T00:00:00,1\n2020-01-01T03:00:00,2')

    def test_cdo_flags_and_partial_accumulations(self):
        csv='DATE,PRCP,PRCP_ATTRIBUTES\n2020-01-01,125," , ,S"\n2020-01-02,400," ,X,S"\n2020-01-03,0,"P, ,S"\n2020-01-04,80,"A, ,S"\n2020-01-05,0,"I, ,S"'
        s,m=import_precip(csv,{'unit':'tenths_mm'})
        self.assertEqual(s['2020-01-01'],12.5)
        self.assertTrue(all(s[f'2020-01-{d:02d}'] is None for d in range(2,6)))
        self.assertEqual(m['counts']['faltante_presunto_cero'],1)


class CalidadYComparacion(unittest.TestCase):
    def test_extreme_retained_and_leap_coverage(self):
        d=date(2020,1,1);s={}
        while d.year==2020:s[d.isoformat()]=0;d+=timedelta(days=1)
        s['2020-02-29']=600;s['2020-03-01']=None;s.pop('2020-03-02')
        q=quality_audit(s,2020,2020,2020,2020)
        self.assertEqual(q['valid_days'],364)
        self.assertEqual(q['longest_gap_days'],2)
        self.assertEqual(q['complete_years'],0)
        self.assertEqual(q['suspicious_count'],1)
        self.assertEqual(s['2020-02-29'],600)

    def test_alignment_gate_and_insufficient_pairs(self):
        p={'2020-01-01':1}
        self.assertEqual(compare_series(p,p,[])['status'],'pending_alignment')
        self.assertEqual(compare_series(p,p,[],True)['status'],'insufficient_pairs')

    def test_metrics_and_event_denominators(self):
        p={};r={}
        for i in range(40):
            day=(date(2020,1,1)+timedelta(days=i)).isoformat()
            p[day]=[0,4,2,6][i%4];r[day]=[0,2,4,6][i%4]
        v=compare_series(p,r,[('>= 3',3,False),('> 6',6,True)],True)
        self.assertEqual(v['metrics']['bias_mm'],0)
        self.assertEqual(v['metrics']['mae_mm'],1)
        self.assertAlmostEqual(v['metrics']['rmse_mm'],math.sqrt(2),places=5)
        self.assertEqual(v['metrics']['pbias_pct'],0)
        e=v['events'][0];self.assertEqual((e['hits'],e['misses'],e['false_alarms'],e['correct_negatives']),(10,10,10,10))
        self.assertEqual(e['pod'],.5);self.assertEqual(e['far'],.5);self.assertAlmostEqual(e['csi'],1/3)
        self.assertIsNone(v['events'][1]['pod'])
        z={d:0 for d in r};m=compare_series(z,z,[],True)['metrics']
        self.assertIsNone(m['pbias_pct']);self.assertIsNone(m['pearson_r'])

    def test_reference_lag_is_declared_diagnosed_and_applied(self):
        # Datos ARTIFICIALES: la referencia fecha cada tormenta un día después (estilo GSOD 12 UTC).
        p={};r={}
        for i in range(120):
            day=date(2020,1,1)+timedelta(days=i)
            p[day.isoformat()]=float((i*37)%23)
            r[(day+timedelta(days=1)).isoformat()]=p[day.isoformat()]
        same=compare_series(p,r,[('>= 10',10,False)],True,0)
        self.assertEqual(same['lag']['best_lag_days'],-1)
        self.assertIn('Aviso',same['note'])
        self.assertLess(same['metrics']['pearson_r'],0.5)
        fixed=compare_series(p,r,[('>= 10',10,False)],True,-1)
        self.assertEqual(fixed['metrics']['mae_mm'],0)
        self.assertEqual(fixed['metrics']['pearson_r'],1)
        self.assertEqual(fixed['pairs'][0]['product_date'],'2020-01-01')
        self.assertEqual(fixed['pairs'][0]['date'],'2020-01-02')
        self.assertEqual(fixed['events'][0]['misses'],0)
        auto=compare_series(p,r,[],True,'auto')
        self.assertEqual(auto['lag']['applied_lag_days'],-1);self.assertEqual(auto['lag']['mode'],'auto')
        with self.assertRaises(ValueError):compare_series(p,r,[],True,3)

    def test_central_america_free_points(self):
        for lat,lon in [(17.5049,-88.196),(14.635,-90.506),(8.432,-82.433),(12.11,-86.24)]:
            args={'source':'csv','start_year':2020,'end_year':2020,'ref_start':2020,'ref_end':2020,'points':[{'name':'Libre','lat':lat,'lon':lon}]}
            self.assertEqual(backend.validate_request(args)[5][0]['lat'],lat)
        with self.assertRaises(ValueError):get_noaa('USW00094728',2020,2020,'.')

    def test_noaa_fixed_width_units_flags_and_element(self):
        station='CSM00078762'
        values=[(125,' ',' '),(99,' ','X'),(0,'T',' '),(0,'P',' '),(90,'A',' '),(80,'C',' '),(70,'E',' '),(0,'I',' '),(240,'G',' ')]+[(-9999,' ',' ')]*22
        line=station+'202001PRCP'+''.join(f'{v:5d}{m}{q}S' for v,m,q in values)
        s,m=parse_dly(line,station,2020,2020)
        self.assertEqual(s['2020-01-01'],12.5);self.assertEqual(s['2020-01-03'],0);self.assertEqual(s['2020-01-09'],24)
        self.assertTrue(all(s[f'2020-01-{d:02d}'] is None for d in [2,4,5,6,7,8]))
        self.assertEqual(m['counts']['acumulacion_menor_24h'],3)

    def test_complete_import_reference_export_workflow(self):
        def csv(delta):
            d=date(2019,1,1);rows=['date,precipitacion_mm']
            while d<=date(2021,12,31):
                rows.append(f'{d.isoformat()},{(d.day%10)*3+delta}')
                d+=timedelta(days=1)
            return '\n'.join(rows)
        args={'source':'csv','start_year':2020,'end_year':2020,'ref_start':2020,'ref_end':2020,
              'points':[{'name':'Punto libre Guatemala','lat':14.63391,'lon':-90.51234}],
              'csv_by_point':{'0':csv(2)},'import_options':{'0':{'product':'PRUEBA ARTIFICIAL','unit':'mm'}},
              'reference_source':'csv','reference_csv_by_point':{'0':csv(0)},
              'reference_import_options':{'0':{'product':'PRUEBA ARTIFICIAL referencia','unit':'mm'}},'aligned_days':True}
        with tempfile.TemporaryDirectory() as tmp,patch.object(backend,'REPORTS',Path(tmp)):
            jid=backend.start_job(args)
            for _ in range(400):
                state=backend.JOBS[jid]
                if state['state'] in ('done','error'):break
                time.sleep(.01)
            self.assertEqual(state['state'],'done',state['error'])
            out=state['result'];v=out['points'][0]['verification']
            self.assertEqual(v['n'],366) # No usa los años del CSV fuera de 2020.
            self.assertEqual(v['metrics']['bias_mm'],2)
            self.assertEqual(out['points'][0]['quality']['complete_years'],1)
            self.assertIsNone(out['points'][0]['summary']['annual_trend']['relative_change_pct'])
            names=[p['name'] for p in out['exports']]
            self.assertIn('analisis_estadistico.json',names)
            self.assertTrue(any(x.endswith('_verificacion_diaria.txt') for x in names))
            stored=json.loads((Path(out['saved_to'])/'analisis_estadistico.json').read_text())
            self.assertEqual(stored['version'],'7.0')


if __name__=='__main__':unittest.main()
