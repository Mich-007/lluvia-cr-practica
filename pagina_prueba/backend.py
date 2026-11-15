# -*- coding: utf-8 -*-
"""Núcleo científico y servidor HTTP local de Phyllobytes (atlas de precipitación).

Sin bibliotecas Python externas: diseñado para Spyder 6. Los cálculos son
exclusivamente sobre datos devueltos por NASA POWER o CSV aportados por usuario.
"""
from __future__ import annotations

import calendar
import csv
import io
import json
import math
import os
import re
import statistics
import threading
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zipfile
from collections import defaultdict, Counter
from datetime import date, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Optional

ROOT = Path(__file__).resolve().parent
WEB = ROOT / 'web'
def _carpeta_datos():
    """Primera carpeta donde se pueda escribir: así funciona en cualquier computadora, idioma o sistema."""
    import os, tempfile
    candidatos = [Path(os.environ['PHYLLOBYTES_DATOS'])] if os.environ.get('PHYLLOBYTES_DATOS') else []
    try:
        casa = Path.home()
        candidatos += [casa / 'Downloads' / 'Phyllobytes_resultados', casa / 'Descargas' / 'Phyllobytes_resultados', casa / 'Phyllobytes_resultados']
    except RuntimeError:
        pass
    candidatos += [ROOT / 'datos_phyllobytes', Path(tempfile.gettempdir()) / 'Phyllobytes_resultados']
    for c in candidatos:
        try:
            c.mkdir(parents=True, exist_ok=True)
            prueba = c / '.prueba_escritura'; prueba.write_text('ok'); prueba.unlink()
            return c
        except OSError:
            continue
    raise SystemExit('No encuentro una carpeta donde guardar los resultados. Defina la variable PHYLLOBYTES_DATOS con una carpeta con permiso de escritura.')


def _comprobar_web():
    if not (WEB / 'index.html').exists():
        raise SystemExit('No encuentro web/index.html junto a backend.py.\nDescomprima TODA la carpeta del zip (no solo algunos archivos) y vuelva a abrir INICIAR_PHYLLOBYTES.py desde dentro de ella.\nBuscado en: ' + str(WEB))


DATA = _carpeta_datos()
CACHE = DATA / 'cache_nasa'
REPORTS = DATA / 'resultados'
POWER = 'https://power.larc.nasa.gov/api/temporal/daily/point'

SOURCES = {
    'gpm': {'label':'GPM IMERG (estimación satelital)', 'parameter':'IMERG_PRECTOT',
            'community':'AG', 'min_year':1998,
            'url':'https://power.larc.nasa.gov/docs/methodology/data/sources_meteorology/'},
    'merra2': {'label':'MERRA-2 (reanálisis corregido, no satélite)',
               'parameter':'PRECTOTCORR', 'community':'AG', 'min_year':1981,
               'url':'https://power.larc.nasa.gov/docs/methodology/data/sources_meteorology/'},
    'csv': {'label':'Otro producto satelital: CSV diario del usuario (p. ej., CHIRPS v3)',
            'parameter':'precipitacion_mm', 'community':None,'min_year':1981,
            'url':'https://www.chc.ucsb.edu/data/chirps3'},
}
MAX_POINTS = 8  # Phyllobytes: 7 provincias + 1 punto libre
PERCENTILES = (80, 90, 95, 98, 99)
EXTREME_PERCENTILES = (90, 95, 99)
# Equivalentes exactos de 2, 3, 4 y 5 pulgadas, expresados en mm.
FIXED_THRESHOLDS_MM = (50.8, 76.2, 101.6, 127)


def fixed_field(threshold):
    return 'dias_desde_' + f'{threshold:.1f}'.replace('.', '_') + '_mm'
JOBS = {}
JOBS_LOCK = threading.Lock()
GEO_LOCK = threading.Lock()
LAST_GEO = 0.0


def read_places():
    return json.loads((WEB / 'assets' / 'places.json').read_text('utf-8'))


def normalize(s):
    s = unicodedata.normalize('NFKD',str(s).casefold())
    return ''.join(c for c in s if not unicodedata.combining(c))


def slug(s):
    return re.sub(r'[^a-z0-9]+','_',normalize(s)).strip('_')[:64] or 'punto'


def finite(v):
    try:
        f = float(v)
        return f if math.isfinite(f) and f>=0 else None
    except (ValueError, TypeError, OverflowError):
        return None


def pct(values, p):
    vals = sorted(v for v in values if v is not None and math.isfinite(v))
    if not vals: return None
    k = (len(vals)-1)*float(p)/100
    lo=int(math.floor(k));hi=int(math.ceil(k))
    return vals[lo]+(vals[hi]-vals[lo])*(k-lo)


def trend(years, values):
    pairs=sorted((int(x), float(v)) for x,v in zip(years,values) if v is not None and math.isfinite(v))
    n=len(pairs)
    out={'n':n,'slope_per_decade':None,'kendall_tau':None,'kendall_p':None,'intercept':None,
         'first_year':pairs[0][0] if pairs else None,'last_year':pairs[-1][0] if pairs else None,
         'fitted_start':None,'fitted_end':None,'change_absolute':None,'relative_change_pct':None,
         'method':'Theil–Sen / Kendall tau-b'}
    if n<10: return out
    slopes=[(pairs[j][1]-pairs[i][1])/(pairs[j][0]-pairs[i][0]) for i in range(n) for j in range(i+1,n)]
    slope=statistics.median(slopes)
    intercept=statistics.median(v-slope*y for y,v in pairs)
    s=0
    for i in range(n):
        for j in range(i+1,n):
            d=pairs[j][1]-pairs[i][1]
            s += (d>0)-(d<0)
    ties=Counter(v for _,v in pairs)
    n0=n*(n-1)//2
    n1=sum(t*(t-1)//2 for t in ties.values())
    den=math.sqrt(n0*(n0-n1))
    tau=s/den if den else None
    var=(n*(n-1)*(2*n+5)-sum(t*(t-1)*(2*t+5) for t in ties.values()))/18
    if var>0:
        z=(s-1 if s>0 else s+1 if s<0 else 0)/math.sqrt(var)
        p=math.erfc(abs(z)/math.sqrt(2))
    else: p=None
    out.update(slope_per_decade=round(slope*10,5),intercept=round(intercept,5),
               kendall_tau=round(tau,5) if tau is not None else None,
               kendall_p=round(p,6) if p is not None else None)
    first=intercept+slope*pairs[0][0]
    last=intercept+slope*pairs[-1][0]
    out['fitted_start']=round(first,5)
    out['fitted_end']=round(last,5)
    out['change_absolute']=round(last-first,5)
    # Base cero o ajuste negativo no tienen porcentaje interpretable.
    if first>1e-9 and last>=0:
        out['relative_change_pct']=round(100*(last-first)/first,2)
    return out


def request_json(url, timeout=95, attempts=3):
    err=None
    for k in range(attempts):
        try:
            req=urllib.request.Request(url,headers={'User-Agent':'Phyllobytes/1.0 (educativo; escritorio)','Accept':'application/json'})
            with urllib.request.urlopen(req,timeout=timeout) as r:
                raw=r.read()
            return json.loads(raw.decode('utf-8-sig'))
        except urllib.error.HTTPError as e:
            msg=e.read(1500).decode('utf-8','replace')
            err=RuntimeError(f'NASA HTTP {e.code}: {msg}')
            if e.code not in (429,500,502,503,504): break
        except (OSError,ValueError,TimeoutError) as e:
            err=e
        if k<attempts-1: time.sleep(2+k*2)
    raise RuntimeError(str(err))


def power_block(source, lat, lon, y0, y1):
    cfg=SOURCES[source]
    CACHE.mkdir(parents=True,exist_ok=True)
    # Los nombres no determinan la cache. Los mismos puntos/regiones tienen claves independientes.
    filename=f'{source}_{lat:.5f}_{lon:.5f}_{y0}_{y1}.json'
    target=CACHE/filename
    if target.exists():
        payload=json.loads(target.read_text('utf-8'))
        url=payload.get('_query_url','Archivo de cache')
        response=payload
    else:
        params={'parameters':cfg['parameter'],'community':cfg['community'],
                'latitude':f'{lat:.6f}','longitude':f'{lon:.6f}',
                'start':f'{y0}0101','end':f'{y1}1231','format':'JSON','time-standard':'UTC'}
        qs=urllib.parse.urlencode(params)
        url=POWER+'?'+qs
        try:
            response=request_json(url)
        except RuntimeError as e:
            # No cambiar nunca de variable/fuente cuando hay un error.
            if source!='gpm' or '422' not in str(e): raise
            errors=[f'AG: {e}']
            response=None
            for community in ['RE','SB']:
                params['community']=community
                alt_url=POWER+'?'+urllib.parse.urlencode(params)
                try:
                    test=request_json(alt_url,attempts=1)
                    if cfg['parameter'] not in test.get('properties',{}).get('parameter',{}):
                        raise RuntimeError('El parámetro IMERG_PRECTOT no apareció en la respuesta.')
                    response=test;url=alt_url;break
                except RuntimeError as ex:
                    errors.append(f'{community}: {ex}')
            if response is None: raise RuntimeError('; '.join(errors))
        vals=response.get('properties',{}).get('parameter',{}).get(cfg['parameter'])
        if not isinstance(vals,dict):
            raise RuntimeError(f'NASA no entregó {cfg["parameter"]}; detalles: '+str(response.get('messages',''))[:500])
        units=str((response.get('parameters',{}).get(cfg['parameter']) or {}).get('units','')).strip()
        if units and units.lower().replace(' ','') not in ('mm','mm/day','mm/d','mmday-1','mm/day-1'):
            raise RuntimeError(f'Unidad inesperada en NASA POWER: {units}. No se aplicó conversión.')
        response['_query_url']=url
        # Evitar que un resultado vacío/incorrecto se vuelva una cache útil.
        target.write_text(json.dumps(response,ensure_ascii=False),encoding='utf-8')
    vals=response.get('properties',{}).get('parameter',{}).get(cfg['parameter'])
    if not isinstance(vals,dict): raise RuntimeError('La cache NASA no tiene el parámetro solicitado.')
    result={}
    for k,v in vals.items():
        if len(k)!=8 or not k.isdigit(): continue
        try: d=date(int(k[:4]),int(k[4:6]),int(k[6:8]))
        except ValueError: continue
        result[d.isoformat()]=finite(v)
    if not result: raise RuntimeError('Sin observaciones válidas en respuesta NASA.')
    return result,url


def get_nasa_data(source, lat, lon, y0,y1, progress):
    data={};urls=[]
    for start in range(y0,y1+1,4):
        end=min(start+3,y1)
        progress(f'Descargando {source}: {start}–{end} ({lat:.3f}, {lon:.3f})')
        rows,url=power_block(source,lat,lon,start,end)
        data.update(rows);urls.append(url)
    return data,urls


def parse_user_csv(content):
    """CSV diario: fecha, precipitacion_mm; admite NASA exportado, ';' y ','."""
    if not isinstance(content,str) or len(content)>10_000_000:
        raise ValueError('El CSV está ausente o supera 10 MB.')
    text=content.lstrip('\ufeff')
    try: dialect=csv.Sniffer().sniff(text[:4000],delimiters=';,\t')
    except csv.Error: dialect=csv.excel
    reader=csv.DictReader(io.StringIO(text),dialect=dialect)
    cols=reader.fieldnames or []
    def find(names):
        for c in cols:
            n=normalize(c).strip()
            if n in names: return c
        return None
    cdate=find({'fecha','date','time','dia','day'})
    cprec=find({'precipitacion_mm','precipitacion','precipitation','rainfall','rain','prcp','valor','mm'})
    if not cdate or not cprec:
        raise ValueError('CSV: se necesitan columnas fecha y precipitacion_mm (o date y rainfall).')
    data={}
    for i,row in enumerate(reader):
        s=str(row.get(cdate,'')).strip()[:10]
        try: d=date.fromisoformat(s)
        except ValueError: continue
        raw=str(row.get(cprec,'')).strip().replace(',','.')
        data[d.isoformat()]=finite(raw) if raw else None
    if not data: raise ValueError('CSV: no contiene fechas ISO AAAA-MM-DD con precipitaciones numéricas.')
    return data


def aggregate(data, start_year, end_year, reference_start, reference_end, wet_min=1.0, population='wet'):
    """Umbrales sobre periodo referencia. Anual/mensual solo cobertura 100%."""
    first=date(start_year,1,1);last=date(end_year,12,31)
    daily=[]; monthly=[];annual=[]
    cur=first
    while cur<=last:
        val=data.get(cur.isoformat())
        daily.append({'date':cur.isoformat(),'year':cur.year,'month':cur.month,'mm':finite(val)})
        cur+=timedelta(days=1)
    base=[r['mm'] for r in daily if reference_start<=r['year']<=reference_end and r['mm'] is not None and (population=='all' or r['mm']>=wet_min)]
    thresholds={str(p):pct(base,p) for p in PERCENTILES}
    yearly_day=defaultdict(list); monthly_day=defaultdict(list)
    for r in daily:
        yearly_day[r['year']].append(r)
        monthly_day[(r['year'],r['month'])].append(r)
    for y in range(start_year,end_year+1):
        year_days=yearly_day[y]
        valid=[r['mm'] for r in year_days if r['mm'] is not None]
        complete=len(valid)==len(year_days)
        wet=[v for v in valid if v>=wet_min]
        # CDD se calcula sobre días disponibles; solo reportar en año completo.
        spell=0; maxspell=0
        for r in year_days:
            if r['mm'] is None: spell=0
            elif r['mm']<wet_min:
                spell+=1;maxspell=max(maxspell,spell)
            else: spell=0
        exceed={str(p):(sum(v>t for v in valid) if complete and t is not None else None) for p,t in [(q,thresholds[str(q)]) for q in PERCENTILES]}
        fixed_days={str(t):(sum(v>=t for v in valid) if complete else None) for t in FIXED_THRESHOLDS_MM}
        rx5day=max((sum(valid[i:i+5]) for i in range(len(valid)-4)),default=None) if complete else None
        r95ptot=sum(v for v in valid if thresholds['95'] is not None and v>thresholds['95']) if complete and thresholds['95'] is not None else None
        r98ptot=sum(v for v in valid if thresholds['98'] is not None and v>thresholds['98']) if complete and thresholds['98'] is not None else None
        annual.append({'year':y,'total':round(sum(valid),3) if complete else None,
                       'coverage':round(len(valid)/len(year_days)*100,2),
                       'valid_days':len(valid),'days':len(year_days),
                       'wet_days':len(wet) if complete else None,
                       'rainy_mean':round(statistics.mean(wet),3) if complete and wet else None,
                       'rx1day':max(valid) if complete and valid else None,
                       'rx5day':round(rx5day,3) if rx5day is not None else None,
                       'r95ptot':round(r95ptot,3) if r95ptot is not None else None,
                       'r98ptot':round(r98ptot,3) if r98ptot is not None else None,
                       'r99ptot':round(sum(v for v in valid if thresholds['99'] is not None and v>thresholds['99']),3) if complete and thresholds['99'] is not None else None,
                       'cdd':maxspell if complete else None,'exceedances':exceed,
                       'fixed_days':fixed_days})
        for m in range(1,13):
            rows=monthly_day[(y,m)]
            nums=[r['mm'] for r in rows if r['mm'] is not None]
            ok=len(nums)==len(rows)
            monthly.append({'year':y,'month':m,'total':round(sum(nums),3) if ok else None,
                            'coverage':round(100*len(nums)/len(rows),2),'wet_days':sum(v>=wet_min for v in nums) if ok else None})
    good=[r for r in annual if r['total'] is not None]
    years=[r['year'] for r in good];totals=[r['total'] for r in good]
    climatology=[]
    for m in range(1,13):
        sub=[r['total'] for r in monthly if r['month']==m and r['total'] is not None]
        climatology.append({'month':m,'mean':round(statistics.mean(sub),3) if sub else None,'n':len(sub)})
    mean_ref=[r['total'] for r in good if reference_start<=r['year']<=reference_end]
    refannual=statistics.mean(mean_ref) if len(mean_ref)>=10 else None
    for row in annual:
        row['anomaly']=round(row['total']-refannual,3) if refannual is not None and row['total'] is not None else None
    # Criterio de eventos: el valor diario debe ser ESTRICTAMENTE mayor al
    # percentil fijo calculado en el periodo de referencia. Las ausencias no
    # se tratan como cero: terminan un episodio, sin añadir observaciones.
    event_days = {}
    event_groups = {}
    for pp in EXTREME_PERCENTILES:
        key = str(pp)
        threshold = thresholds[key]
        events, days_at_threshold = [], []
        active = []

        def close_event():
            if not active:
                return
            peak = max(active, key=lambda r: r['mm'])
            eid = len(events) + 1
            values = [r['mm'] for r in active]
            episode = {
                'id_evento': eid, 'percentil': pp,
                'fecha_inicio': active[0]['date'],
                'fecha_fin': active[-1]['date'],
                'anio_inicio': active[0]['year'],
                'duracion_dias': len(active),
                'acumulado_mm': round(sum(values), 3),
                'maximo_mm': peak['mm'], 'fecha_pico': peak['date'],
                'promedio_mm_dia': round(statistics.mean(values),3),
                'umbral_mm_dia': round(threshold,3)
            }
            events.append(episode)
            for r in active:
                days_at_threshold.append({
                    'fecha': r['date'], 'anio': r['year'],
                    'mes': r['month'], 'lluvia_mm': r['mm'],
                    'percentil': pp, 'umbral_mm_dia': round(threshold,3),
                    'exceso_umbral_mm': round(r['mm']-threshold,3),
                    'id_evento': eid
                })
            active.clear()

        if threshold is not None:
            for r in daily:
                if r['mm'] is not None and r['mm'] > threshold:
                    active.append(r)
                else:
                    close_event()
            close_event()
        event_days[key] = days_at_threshold
        event_groups[key] = events

    # Para series anuales incompletas no se publican conteos/sumas anuales.
    for rec in annual:
        yy = rec['year']
        complete = rec['total'] is not None
        rec['event_counts'] = {
            str(pp): (sum(ev['anio_inicio']==yy for ev in event_groups[str(pp)]) if complete else None)
            for pp in EXTREME_PERCENTILES
        }
        rec['extreme_mm'] = {
            str(pp): (round(sum(day['lluvia_mm'] for day in event_days[str(pp)] if day['anio']==yy),3) if complete else None)
            for pp in EXTREME_PERCENTILES
        }

    allvalid=[r['mm'] for r in daily if r['mm'] is not None]
    wet_valid=[v for v in allvalid if v>=wet_min]
    extremes={str(p):trend([r['year'] for r in annual],[r['exceedances'][str(p)] for r in annual]) for p in PERCENTILES}
    fixed_trends={str(t):trend([r['year'] for r in annual],
                              [r['fixed_days'][str(t)] for r in annual]) for t in FIXED_THRESHOLDS_MM}
    fixed_means={str(t):(round(statistics.mean(r['fixed_days'][str(t)] for r in good),2) if good else None)
                 for t in FIXED_THRESHOLDS_MM}
    summary={
        'valid_days':len(allvalid),'expected_days':len(daily),
        'coverage_pct':round(100*len(allvalid)/len(daily),2),
        'complete_years':len(good),'reference_sample_n':len(base),
        'reference_period':f'{reference_start}–{reference_end}',
        'reference_annual_n':len(mean_ref),
        'mean_annual_mm':round(statistics.mean(totals),2) if totals else None,
        'reference_mean_annual_mm':round(refannual,2) if refannual is not None else None,
        'total_analyzed_mm':round(sum(allvalid),2),
        'daily_mean_mm':round(statistics.mean(allvalid),3) if allvalid else None,
        'wet_day_mean_mm':round(statistics.mean(wet_valid),3) if wet_valid else None,
        'daily_median_mm':round(statistics.median(allvalid),3) if allvalid else None,
        'daily_std_mm':round(statistics.stdev(allvalid),3) if len(allvalid)>1 else None,
        'daily_max_mm':max(allvalid) if allvalid else None,
        'max_rx5day_mm':max((r['rx5day'] for r in good if r['rx5day'] is not None),default=None),
        'max_cdd_days':max((r['cdd'] for r in good if r['cdd'] is not None),default=None),
        'monthly_pearson_exploratory':True,
        'dry_day_pct':round(100*sum(v<wet_min for v in allvalid)/len(allvalid),2) if allvalid else None,
        'annual_trend':trend(years,totals),
        'extreme_count_trends':extremes,
        'fixed_threshold_trends':fixed_trends,
        'fixed_threshold_mean_days':fixed_means,
        'extreme_days_full_series':{str(p):len(event_days[str(p)]) for p in EXTREME_PERCENTILES},
        'extreme_episodes_full_series':{str(p):len(event_groups[str(p)]) for p in EXTREME_PERCENTILES},
        'extreme_rain_total_mm':{str(p):round(sum(d['lluvia_mm'] for d in event_days[str(p)]),3) for p in EXTREME_PERCENTILES},
        'population':'Días con lluvia >= '+str(wet_min)+' mm' if population=='wet' else 'Todos los días válidos',
        'note':'Sin imputación: los acumulados de meses/años incompletos son nulos; percentiles del período de referencia. Kendall exploratorio sin ajuste por autocorrelación.',
    }
    return {'daily':daily,'monthly':monthly,'annual':annual,
            'climatology':climatology,'thresholds':{k:round(v,3) if v is not None else None for k,v in thresholds.items()},
            'extreme_days':event_days,'extreme_events':event_groups,
            'summary':summary}


def validate_request(args):
    source=args.get('source','gpm')
    if source not in SOURCES: raise ValueError('Fuente desconocida.')
    a=int(args.get('start_year',2001));b=int(args.get('end_year',2024))
    rs=int(args.get('ref_start',2001));re_=int(args.get('ref_end',2020))
    if not(SOURCES[source]['min_year']<=a<=b<=date.today().year):
        raise ValueError('Años incompatibles con la fuente seleccionada.')
    if b-a>40: raise ValueError('Máximo 41 años en una consulta.')
    if not(a<=rs<=re_<=b):raise ValueError('Referencia debe estar dentro del período solicitado.')
    points=args.get('points',[])
    if not isinstance(points,list) or not 1<=len(points)<=MAX_POINTS:raise ValueError(f'Seleccione de 1 a {MAX_POINTS} puntos.')
    pts=[]
    for i,p in enumerate(points):
        lat=float(p['lat']);lon=float(p['lon']);name=str(p.get('name',f'Punto {i+1}')).strip()[:95]
        if not (5<=lat<=11.5 and -87.5<=lon<=-82):
            raise ValueError(f'El punto {name} está fuera del ámbito de Costa Rica.')
        pts.append({'name':name or f'Punto {i+1}','lat':lat,'lon':lon})
    pop=args.get('population','wet')
    if pop not in ('wet','all'): raise ValueError('Población de percentiles inválida.')
    wet=float(args.get('wet_min',1))
    if not(0<=wet<=10): raise ValueError('El umbral de día lluvioso debe estar entre 0 y 10 mm.')
    return source,a,b,rs,re_,pts,pop,wet


def generate_csv(point, kind):
    data=point.get(kind,[])
    if not data: return ''
    if kind=='daily': keys=['date','year','month','mm']
    elif kind=='annual': keys=['year','total','coverage','valid_days','days','wet_days','rx1day','rx5day','r95ptot','r98ptot','r99ptot','cdd','anomaly','P80','P90','P95','P98','P99']+[fixed_field(t) for t in FIXED_THRESHOLDS_MM]
    else: keys=['year','month','total','coverage','wet_days']
    fout=io.StringIO()
    w=csv.DictWriter(fout,keys,extrasaction='ignore',delimiter=';')
    w.writeheader()
    for row in data:
        r=dict(row)
        if kind=='annual':
            for p in PERCENTILES: r['P'+str(p)]=row['exceedances'].get(str(p))
            for t in FIXED_THRESHOLDS_MM: r[fixed_field(t)]=row['fixed_days'][str(t)]
        w.writerow({k:'' if r.get(k) is None else r[k] for k in keys})
    return '\ufeff'+fout.getvalue()



def tsv_text(fields, rows):
    """TXT tabulado UTF-8 con encabezados. Vacíos, nunca lluvia simulada."""
    output=io.StringIO()
    writer=csv.DictWriter(output,fieldnames=fields,delimiter='\t',extrasaction='ignore',lineterminator='\n')
    writer.writeheader()
    for row in rows:
        writer.writerow({field:('' if row.get(field) is None else row[field]) for field in fields})
    return '\ufeff'+output.getvalue()


def write_report_exports(session, out):
    """Crea TXT inmediatamente al terminar el análisis, y ZIP descargable."""
    records=[]
    combined_events=[]
    combined_annual=[]
    combined_thresholds=[]
    for i,pt in enumerate(out['points'],1):
        pn=f'{i:02d}_{slug(pt["name"])}'
        fieldsbase={'lugar':pt['name'],'latitud':pt['lat'],'longitud':pt['lon'],
                    'fuente':out['source_label']}
        def write(name,fields,rows):
            fp=session/f'{pn}_{name}.txt'
            fp.write_text(tsv_text(fields,rows),encoding='utf-8')
            records.append(fp)
        daily=[{**fieldsbase,'fecha':r['date'],'lluvia_mm':r['mm']}
               for r in pt['daily']]
        write('lluvia_diaria',['lugar','latitud','longitud','fuente','fecha','lluvia_mm'],daily)
        monthly=[{**fieldsbase,**r} for r in pt['monthly']]
        write('lluvia_mensual',['lugar','latitud','longitud','year','month','total','coverage','wet_days'],monthly)
        annual=[]
        for r in pt['annual']:
            line={**fieldsbase,**{k:v for k,v in r.items() if k not in ('exceedances','event_counts','extreme_mm','fixed_days')}}
            for pp in PERCENTILES:
                line[f'dias_mayores_P{pp}']=r['exceedances'][str(pp)]
            for t in FIXED_THRESHOLDS_MM:
                line[fixed_field(t)]=r['fixed_days'][str(t)]
            for pp in EXTREME_PERCENTILES:
                line[f'episodios_P{pp}']=r['event_counts'][str(pp)]
                line[f'lluvia_extrema_P{pp}_mm']=r['extreme_mm'][str(pp)]
            annual.append(line)
            combined_annual.append(line)
        afields=['lugar','latitud','longitud','year','total','coverage','valid_days','days','wet_days',
                 'rx1day','rx5day','r95ptot','r99ptot','cdd','anomaly']
        afields += [f'dias_mayores_P{p}' for p in PERCENTILES]
        afields += [fixed_field(t) for t in FIXED_THRESHOLDS_MM]
        afields += [x for p in EXTREME_PERCENTILES for x in (f'episodios_P{p}',f'lluvia_extrema_P{p}_mm')]
        write('estadisticos_anuales',afields,annual)
        fixed=[]
        for t in FIXED_THRESHOLDS_MM:
            tr=pt['summary']['fixed_threshold_trends'][str(t)]
            fixed.append({**fieldsbase,'umbral_mm_dia':t,'media_anual_dias':pt['summary']['fixed_threshold_mean_days'][str(t)],
                          'n_anios_completos':tr['n'],'primer_anio':tr['first_year'],'ultimo_anio':tr['last_year'],
                          'pendiente_dias_decada':tr['slope_per_decade'],'cambio_dias':tr['change_absolute'],
                          'cambio_porcentual':tr['relative_change_pct'],'kendall_p':tr['kendall_p']})
        write('tendencias_umbrales_fijos',
              ['lugar','latitud','longitud','fuente','umbral_mm_dia','media_anual_dias','n_anios_completos',
               'primer_anio','ultimo_anio','pendiente_dias_decada','cambio_dias','cambio_porcentual','kendall_p'],fixed)
        thresholds=[]
        for pp in PERCENTILES:
            thresholds.append({**fieldsbase,'percentil':pp,'umbral_mm_dia':pt['thresholds'][str(pp)],
              'referencia_inicio':out['ref_start'],'referencia_fin':out['ref_end'],
              'muestra':pt['summary']['population'],'n_muestra':pt['summary']['reference_sample_n'],
              'cobertura_pct':pt['summary']['coverage_pct']})
        combined_thresholds.extend(thresholds)
        pfields=['lugar','latitud','longitud','fuente','percentil','umbral_mm_dia',
                 'referencia_inicio','referencia_fin','muestra','n_muestra','cobertura_pct']
        write('umbrales_percentiles',pfields,thresholds)
        for pp in EXTREME_PERCENTILES:
            key=str(pp)
            days=[{**fieldsbase,**r} for r in pt['extreme_days'][key]]
            ev=[{**fieldsbase,**r} for r in pt['extreme_events'][key]]
            combined_events += days
            write(f'P{pp}_dias_extremos', ['lugar','latitud','longitud','fuente','fecha',
                  'anio','mes','lluvia_mm','percentil','umbral_mm_dia','exceso_umbral_mm','id_evento'],days)
            write(f'P{pp}_episodios', ['lugar','latitud','longitud','fuente','id_evento',
                  'percentil','fecha_inicio','fecha_fin','anio_inicio','duracion_dias',
                  'acumulado_mm','maximo_mm','fecha_pico','promedio_mm_dia','umbral_mm_dia'],ev)
        # Lista única de días extremos clasificada por el máximo percentil superado.
        unique={}
        for pp in EXTREME_PERCENTILES:
            for day in pt['extreme_days'][str(pp)]:
                unique[day['fecha']]={**fieldsbase,**day,'clase_maxima':f'P{pp}'}
        rows=[unique[k] for k in sorted(unique)]
        write('SOLO_EVENTOS_EXTREMOS', ['lugar','latitud','longitud','fuente','fecha',
              'anio','mes','lluvia_mm','clase_maxima','percentil','umbral_mm_dia','exceso_umbral_mm','id_evento'],rows)
    # Tablas integradas, útiles para herramientas gráficas externas.
    combined_annual.sort(key=lambda r:(r['lugar'],r['year']))
    combined_events.sort(key=lambda r:(r['fecha'],r['lugar'],r['percentil']))
    summary_files={
        'TODOS_LOS_PUNTOS_ESTADISTICOS_ANUALES.txt':(afields,combined_annual),
        'TODOS_LOS_PUNTOS_UMBRALES.txt':(pfields,combined_thresholds),
        'TODOS_LOS_PUNTOS_DIAS_EXTREMOS.txt':(
            ['lugar','latitud','longitud','fuente','fecha','anio','mes','lluvia_mm',
             'percentil','umbral_mm_dia','exceso_umbral_mm','id_evento'],combined_events),
    }
    for fn,(fields,rows) in summary_files.items():
        fp=session/fn;fp.write_text(tsv_text(fields,rows),encoding='utf-8');records.append(fp)
    report=[]
    report.append('ATLAS DE LLUVIA CR | INFORME DE SERIES ANALIZADAS')
    report.append(f'Fuente: {out["source_label"]}')
    report.append(f'Analisis: {out["start_year"]}-{out["end_year"]}; referencia: {out["ref_start"]}-{out["ref_end"]}')
    report.append(f'Poblacion de percentiles: {out["population"]}; dia lluvioso >= {out["wet_min"]} mm')
    report.append('Umbral superado: lluvia diaria > percentil (estrictamente mayor).')
    report.append('Episodio: dias calendaricos consecutivos que superan el mismo umbral.')
    report.append('Los anos incompletos no aportan conteos ni acumulados anuales.')
    report.append('Cero real y dato ausente son diferentes. NO hay imputacion.')
    report.append('Los puntos NO constituyen un mapa de lluvia continua; no se interpola.')
    report.append('Umbrales fijos diarios >= 50.8, 76.2, 101.6 y 127.0 mm (equivalentes exactos a 2, 3, 4 y 5 pulgadas).')
    report.append('Cambio porcentual = 100 * (ajuste final - ajuste inicial) / ajuste inicial; ajuste Theil-Sen sobre primeros y ultimos anos completos.')
    report.append('Sin 10 anos completos, base cero o ajuste negativo no se publica porcentaje; Kendall p es exploratorio.')
    for pt in out['points']:
        report.append('')
        report.append(f'{pt["name"]} ({pt["lat"]:.5f}, {pt["lon"]:.5f})')
        report.append('Cobertura: '+str(pt['summary']['coverage_pct'])+'%; '+str(pt['summary']['valid_days'])+' dias validos')
        for pp in EXTREME_PERCENTILES:
            report.append(f'P{pp}={pt["thresholds"][str(pp)]} mm/dia; '+
                          f'dias extremos={len(pt["extreme_days"][str(pp)])}; '+
                          f'episodios={len(pt["extreme_events"][str(pp)])}')
        report.append('Procedencia: '+ ' | '.join(pt['provenance']))
    f=session/'LEER_ESTADISTICOS_Y_PROCEDENCIA.txt'
    f.write_text('\n'.join(report)+'\n',encoding='utf-8-sig')
    records.append(f)
    bundle=session/'DATOS_TXT_COMPLETOS.zip'
    with zipfile.ZipFile(bundle,'w',compression=zipfile.ZIP_DEFLATED) as z:
        for path in records:
            z.write(path,path.name)
    records.insert(0,bundle)
    return [{'name':f.name,'size_bytes':f.stat().st_size} for f in records]


def pearson(x,y):
    pairs=[(float(a),float(b)) for a,b in zip(x,y) if a is not None and b is not None]
    if len(pairs)<12: return {'r':None,'n':len(pairs)}
    av=statistics.mean(a for a,b in pairs);bv=statistics.mean(b for a,b in pairs)
    dx=[a-av for a,b in pairs];dy=[b-bv for a,b in pairs]
    den=math.sqrt(sum(v*v for v in dx)*sum(v*v for v in dy))
    return {'r':round(sum(a*b for a,b in zip(dx,dy))/den,4) if den else None,'n':len(pairs)}

def correlation_matrix(points):
    matrix=[]
    for p in points:
        row=[]
        a={(r['year'],r['month']):r['total'] for r in p['monthly']}
        for q in points:
            b={(r['year'],r['month']):r['total'] for r in q['monthly']}
            same=sorted(set(a)&set(b))
            row.append(pearson([a[k] for k in same],[b[k] for k in same]))
        matrix.append(row)
    return matrix


def start_job(args):
    src,y0,y1,r0,r1,pts,pop,wet=validate_request(args)
    jobid=uuid.uuid4().hex[:16]
    state={'id':jobid,'state':'waiting','progress':['Solicitud validada.'],'result':None,'error':None,'created':time.time()}
    with JOBS_LOCK:
        JOBS[jobid]=state
        for key,obj in list(JOBS.items()):
            if obj['created']<time.time()-3600*6:JOBS.pop(key,None)
    def progress(msg):
        with JOBS_LOCK:
            state['progress'].append(msg)
            state['progress']=state['progress'][-28:]
    def work():
        with JOBS_LOCK: state['state']='running'
        results=[]
        try:
            REPORTS.mkdir(parents=True,exist_ok=True)
            for ix,pt in enumerate(pts):
                progress(f'[{ix+1}/{len(pts)}] {pt["name"]}')
                if src=='csv':
                    # CSV por punto, sin atribuirlo a una fuente verificable automáticamente.
                    txt=args.get('csv_by_point',{}).get(str(ix),'')
                    obs=parse_user_csv(txt)
                    urls=['CSV proporcionado por el usuario; procedencia por verificar']
                else:
                    obs,urls=get_nasa_data(src,pt['lat'],pt['lon'],y0,y1,progress)
                data=aggregate(obs,y0,y1,r0,r1,wet,pop)
                if data['summary']['valid_days']<30:
                    raise RuntimeError(f'{pt["name"]}: menos de 30 días disponibles en la serie.')
                results.append({'name':pt['name'],'lat':pt['lat'],'lon':pt['lon'],
                                'source':src,'source_label':SOURCES[src]['label'],
                                'provenance':urls,**data})
                progress(f'Calculados estadísticos: {pt["name"]}.')
            out={'source':src,'source_label':SOURCES[src]['label'],'start_year':y0,'end_year':y1,
                 'ref_start':r0,'ref_end':r1,'wet_min':wet,'population':pop,
                 'generated_at':datetime.now().isoformat(timespec='seconds'),
                 'points':results,'correlations':correlation_matrix(results),
                 'method':'Percentiles con interpolación lineal; muestra de referencia de lluvia diaria; acumulados mensuales y anuales solo con cobertura 100%; tendencias Theil–Sen y Kendall tau-b exploratorio.'}
            session=REPORTS/(datetime.now().strftime('%Y%m%d_%H%M%S')+'_'+jobid)
            session.mkdir(parents=True,exist_ok=True)
            for pt in results:
                pn=slug(pt['name'])
                for kind in ('daily','monthly','annual'):
                    (session/f'{pn}_{kind}.csv').write_text(generate_csv(pt,kind),encoding='utf-8')
            (session/'analisis_estadistico.json').write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding='utf-8')
            out['exports']=write_report_exports(session,out)
            out['saved_to']=str(session)
            with JOBS_LOCK:
                state['result']=out;state['state']='done'
            progress('Análisis finalizado; TXT, CSV, ZIP y JSON guardados.')
        except Exception as e:
            with JOBS_LOCK: state['state']='error';state['error']=str(e)
            progress('Error: '+str(e))
    threading.Thread(target=work,name='NASA-'+jobid,daemon=True).start()
    return jobid


def geocode(q):
    global LAST_GEO
    q=str(q).strip()[:100]
    if len(q)<3:raise ValueError('Introduzca al menos 3 letras.')
    local=read_places()
    exact=[p for p in local if normalize(p['name'])==normalize(q)]
    if exact:return exact[0]
    with GEO_LOCK:
        wait=max(0,1.2-(time.monotonic()-LAST_GEO))
        if wait: time.sleep(wait)
        LAST_GEO=time.monotonic()
        url='https://nominatim.openstreetmap.org/search?'+urllib.parse.urlencode({
            'q':q+', Costa Rica','limit':5,'format':'jsonv2','addressdetails':1,'countrycodes':'cr'})
        data=request_json(url,timeout=20,attempts=1)
    if not isinstance(data,list):raise RuntimeError('Geocodificación sin resultados.')
    for p in data:
        try:lat=float(p['lat']);lon=float(p['lon'])
        except (KeyError,ValueError,TypeError):continue
        if 5<=lat<=11.5 and -87.5<=lon<=-82:
            return {'name':q,'lat':lat,'lon':lon,'type':'buscado',
                    'reference':False,'osm_label':p.get('display_name','')}
    raise RuntimeError('No se localizó ese nombre dentro de Costa Rica.')


class Handler(BaseHTTPRequestHandler):
    server_version='Phyllobytes/1.0'
    def log_message(self,*args):
        if args and '/api/status' not in str(args[0]): print('[WEB]',args[0] % args[1:] if len(args)>1 else args[0])
    def send_data(self, status, body, content_type='application/json; charset=utf-8'):
        if not isinstance(body,bytes):
            body=(json.dumps(body,ensure_ascii=False,allow_nan=False) if 'json' in content_type else str(body)).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type',content_type)
        self.send_header('Content-Length',str(len(body)))
        self.send_header('Cache-Control','no-store' if 'api/' in self.path else 'no-cache')
        self.send_header('X-Content-Type-Options','nosniff')
        self.end_headers();self.wfile.write(body)
    def do_GET(self):
        parsed=urllib.parse.urlparse(self.path);path=parsed.path
        q=urllib.parse.parse_qs(parsed.query)
        try:
            if path=='/api/places':return self.send_data(200,{'places':read_places(),'sources':SOURCES})
            if path=='/api/status':
                jid=q.get('id',[''])[0]
                with JOBS_LOCK:
                    job=JOBS.get(jid)
                    if not job:return self.send_data(404,{'error':'Trabajo no encontrado.'})
                    result={k:v for k,v in job.items() if k!='created'}
                return self.send_data(200,result)
            if path=='/api/geocode':return self.send_data(200,geocode(q.get('name',[''])[0]))
            if path=='/api/health':return self.send_data(200,{'status':'ok','version':'phyllobytes-1','data_dir':str(DATA)})
            if path=='/api/download':
                jid=q.get('id',[''])[0]; filename=q.get('name',[''])[0]
                with JOBS_LOCK:
                    job=JOBS.get(jid)
                    if job is None or job['state']!='done':
                        return self.send_data(404,{'error':'Análisis no disponible.'})
                    out=job['result']
                    permitted={x['name'] for x in out.get('exports',[])}
                    session=Path(out['saved_to'])
                if filename not in permitted or Path(filename).name!=filename:
                    return self.send_data(404,{'error':'Archivo no disponible.'})
                file=session/filename
                if not file.is_file():return self.send_data(404,{'error':'Archivo ausente.'})
                content_type='application/zip' if file.suffix=='.zip' else 'text/plain; charset=utf-8'
                data=file.read_bytes()
                self.send_response(200)
                self.send_header('Content-Type',content_type)
                self.send_header('Content-Disposition',"attachment; filename=\""+filename+"\"")
                self.send_header('Content-Length',str(len(data)))
                self.send_header('X-Content-Type-Options','nosniff')
                self.end_headers();self.wfile.write(data)
                return
            if path=='/':path='/index.html'
            path=path.lstrip('/')
            file=(WEB/path).resolve()
            if not file.is_relative_to(WEB.resolve()) or not file.is_file():
                return self.send_data(404,{'error':'No encontrado'})
            m={'html':'text/html; charset=utf-8','css':'text/css; charset=utf-8',
               'js':'text/javascript; charset=utf-8','json':'application/json; charset=utf-8',
               'geojson':'application/geo+json; charset=utf-8','svg':'image/svg+xml','png':'image/png','jpg':'image/jpeg','webp':'image/webp','ico':'image/x-icon','woff2':'font/woff2','woff':'font/woff','ttf':'font/ttf','otf':'font/otf','txt':'text/plain; charset=utf-8'}
            return self.send_data(200,file.read_bytes(),m.get(file.suffix[1:],'application/octet-stream'))
        except (ValueError,RuntimeError) as e:
            return self.send_data(400,{'error':str(e)})
        except Exception as e:
            return self.send_data(500,{'error':str(e)})
    def do_POST(self):
        try:
            if self.path!='/api/start':return self.send_data(404,{'error':'Ruta desconocida'})
            length=int(self.headers.get('Content-Length',0))
            if length<1 or length>12_000_000:raise ValueError('Cuerpo vacío o demasiado grande.')
            args=json.loads(self.rfile.read(length).decode('utf-8'))
            jid=start_job(args)
            return self.send_data(202,{'job_id':jid})
        except (ValueError,KeyError,TypeError) as e:
            return self.send_data(400,{'error':str(e)})
        except Exception as e:return self.send_data(500,{'error':str(e)})


_BACKGROUND_SERVER=None

def start_spyder(port=8767):
    """Spyder F5 puede ejecutarse múltiples veces sin bloquear la consola."""
    global _BACKGROUND_SERVER
    import webbrowser
    url=f'http://127.0.0.1:{port}'
    # Si otra ejecución de esta app está activa, simplemente reabre la web.
    try:
        with urllib.request.urlopen(url+'/api/health',timeout=1.5) as r:
            data=json.loads(r.read())
        if data.get('status')=='ok' and data.get('version')=='phyllobytes-1':
            print('Phyllobytes ya se encuentra abierto:',url,flush=True)
            webbrowser.open(url)
            return url
    except Exception:
        pass
    _comprobar_web()
    _BACKGROUND_SERVER,port=_servidor(port)
    url=f'http://127.0.0.1:{port}'
    DATA.mkdir(parents=True,exist_ok=True)
    threading.Thread(target=_BACKGROUND_SERVER.serve_forever,daemon=True,name='VISOR NASA CR').start()
    print('Servidor web activo en',url,flush=True)
    print('Resultados reales:',DATA,flush=True)
    print('La consola IPython queda disponible. Para apagar Phyllobytes, reinicie el núcleo de Spyder.',flush=True)
    webbrowser.open(url)
    return url


def _servidor(port):
    """Abre el servidor en el primer puerto libre desde `port` (así no falla si otro programa usa ese puerto)."""
    ultimo=None
    for p in range(port,port+11):
        try:return ThreadingHTTPServer(('127.0.0.1',p),Handler),p
        except OSError as e:ultimo=e
    raise SystemExit(f'No hay puertos libres entre {port} y {port+10}: {ultimo}')


def serve(port=8765,open_browser=True):
    import webbrowser
    _comprobar_web()
    server,port=_servidor(port)
    DATA.mkdir(parents=True,exist_ok=True)
    url=f'http://127.0.0.1:{port}'
    print('Phyllobytes: abra',url,flush=True)
    print('Archivos reales se guardan en:',DATA,flush=True)
    print('Para detener el servidor: Ctrl+C en la consola IPython.',flush=True)
    if open_browser: threading.Timer(0.7,lambda:webbrowser.open(url)).start()
    try:server.serve_forever(poll_interval=.2)
    except KeyboardInterrupt:print('Servidor detenido.')
    finally:server.server_close()
