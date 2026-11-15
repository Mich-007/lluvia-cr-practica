# -*- coding: utf-8 -*-
"""Núcleo científico y servidor HTTP local del visor de precipitación (v6).

Sin bibliotecas Python externas: diseñado para Spyder 6. Los cálculos son
exclusivamente sobre datos devueltos por NASA POWER o CSV aportados por usuario.

QUÉ CAMBIA EN LA v6 (resumen para el equipo)
--------------------------------------------
Se conservan TODOS los nombres y cálculos de la v5 (aggregate, trend,
relative_change_pct, fixed_days, exceedances, etc.). Lo nuevo se añade en
secciones aparte, marcadas con «v6», para que se pueda leer y aprender por
bloques:

  1. CELDA DEL PRODUCTO. Cada clic en el mapa se traduce a la celda real del
     producto satelital (IMERG 0,1° ≈ 11 km; MERRA-2 ½° × ⅝° ≈ 55 × 69 km).
     Se informa su tamaño en km y en metros y qué parte es tierra de Costa Rica.
  2. TERRITORIO. El punto debe caer dentro de Costa Rica (frontera Natural
     Earth 1:10m, incluida la Isla del Coco), con 2 km de tolerancia costera.
  3. ÁREA 3 × 3 (opcional, solo IMERG). Promedio espacial de 9 celdas
     (≈ 33 × 33 km) para una serie menos ruidosa.
  4. ESTADÍSTICA AVANZADA. Intervalo de confianza de Sen, corrección de
     Hamed-Rao por autocorrelación, corrección de Holm entre puntos, estado de
     la tendencia, cambio de régimen (Pettitt + BIC + CUSUM), cuantiles por
     mitades del período, estaciones y veranillo, firma de concentración y
     períodos de retorno (Gumbel).
  5. IDONEIDAD. Una ficha por punto que dice si los datos alcanzan para
     concluir algo, y por qué.
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

import chirps_climateserv
import era5_openmeteo
import estaciones   # v6.2: validación frente a estaciones de Costa Rica
from precip_tools import import_precip, inspect_csv, quality_audit, compare_series
from precip_sources import RESOURCES, get_noaa, nearby_stations, distance_km

ROOT = Path(__file__).resolve().parent
WEB = ROOT / 'web'
DATA = Path.home() / 'Downloads' / 'Precipitacion_NASA_Comparador_CR'
CACHE = DATA / 'cache_nasa'
REPORTS = DATA / 'resultados'
POWER = 'https://power.larc.nasa.gov/api/temporal/daily/point'
VERSION = '7.0'

SOURCES = {
    # v6: min_year de IMERG pasa de 1998 a 2001. La documentación de NASA POWER
    # indica que IMERG Final está disponible desde el 1 de enero de 2001; pedir
    # años previos solo producía años incompletos, nunca datos.
    'gpm': {'label':'GPM IMERG (estimación satelital)', 'parameter':'IMERG_PRECTOT',
            'community':'AG', 'min_year':2001,
            'url':'https://power.larc.nasa.gov/docs/methodology/data/sources/'},
    'merra2': {'label':'MERRA-2 (reanálisis corregido, no satélite)',
               'parameter':'PRECTOTCORR', 'community':'AG', 'min_year':1981,
               'url':'https://power.larc.nasa.gov/docs/methodology/data/sources/'},
    'csv': {'label':'CSV de precipitación de estación o producto', 'parameter':'precipitacion_mm',
            'community':None,'min_year':1900,'url':''},
    'giovanni': {'label':'Giovanni · precipitación importada','parameter':'precipitacion_mm',
                 'community':None,'min_year':1900,'url':'https://giovanni.gsfc.nasa.gov/giovanni/'},
    'hydrology': {'label':'Hydrology Time Series · GLDAS importado','parameter':'precipitacion_mm',
                  'community':None,'min_year':1900,'url':'https://disc.gsfc.nasa.gov/information/tools?title=Hydrology%20Time%20Series'},
    'chirps': {'label':'CHIRPS · precipitación diaria importada','parameter':'precipitacion_mm',
               'community':None,'min_year':1981,'url':'https://www.chc.ucsb.edu/data/chirps3'},
    'chirps_auto': {'label':'CHIRPS v2.0 diario · descarga automática (ClimateSERV)','parameter':'CHIRPS_precip',
                    'community':None,'min_year':1981,'url':'https://climateserv.servirglobal.net/'},
    'era5': {'label':'ERA5 · reanálisis Copernicus/ECMWF (vía Open-Meteo)','parameter':'precipitation_sum',
             'community':None,'min_year':1940,'url':'https://open-meteo.com/en/docs/historical-weather-api'},
    'noaa': {'label':'NOAA GHCN-Daily · PRCP de estación','parameter':'PRCP',
             'community':None,'min_year':1900,'url':'https://www.ncei.noaa.gov/pub/data/ghcn/daily/readme.txt'},
}
IMPORT_SOURCES = ('csv','giovanni','hydrology','chirps')
CA_COUNTRIES = ('Guatemala','Belize','El Salvador','Honduras','Nicaragua','Costa Rica','Panama')
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


# =============================================================================
# v6 · utilidades estadísticas pequeñas (sin numpy)
# =============================================================================
Z95 = 1.959963984540054   # cuantil 0,975 de la normal: IC del 95 %


def rankdata(values):
    """Rangos promedio (1..n). Los empates reciben el rango medio de su grupo.

    Es lo que hace scipy.stats.rankdata, escrito a mano porque el visor no
    puede depender de scipy (Spyder sin paquetes extra).
    """
    order = sorted(range(len(values)), key=lambda i: values[i])
    ranks = [0.0] * len(values)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and values[order[j + 1]] == values[order[i]]:
            j += 1
        r = (i + j) / 2 + 1
        for k in range(i, j + 1):
            ranks[order[k]] = r
        i = j + 1
    return ranks


def holm(pvalues):
    """Corrección de Holm-Bonferroni. Los None se conservan y no cuentan.

    POR QUÉ: con 6 puntos y α = 0,05, la probabilidad de que AL MENOS UNO salga
    «significativo» por azar es 1 − 0,95⁶ ≈ 26 %. Holm mantiene esa
    probabilidad por debajo de 5 %. Con un solo punto, Holm no cambia nada.
    """
    idx = [i for i, p in enumerate(pvalues) if p is not None]
    m = len(idx)
    out = [None] * len(pvalues)
    if not m:
        return out
    order = sorted(idx, key=lambda i: pvalues[i])
    running = 0.0
    for rank, i in enumerate(order):
        adj = min(1.0, pvalues[i] * (m - rank))
        running = max(running, adj)          # monotonía: nunca baja
        out[i] = round(running, 6)
    return out


def trend(years, values):
    pairs=sorted((int(x), float(v)) for x,v in zip(years,values) if v is not None and math.isfinite(v))
    n=len(pairs)
    out={'n':n,'slope_per_decade':None,'kendall_tau':None,'kendall_p':None,'intercept':None,
         'first_year':pairs[0][0] if pairs else None,'last_year':pairs[-1][0] if pairs else None,
         'fitted_start':None,'fitted_end':None,'change_absolute':None,'relative_change_pct':None,
         'method':'Theil–Sen / Kendall tau-b',
         # v6: campos nuevos. Ninguno reemplaza a los de la v5.
         'ci_low_per_decade':None,'ci_high_per_decade':None,'ci_level':95,
         'kendall_p_hr':None,'autocorr_lag1':None,'variance_factor':None,
         'pivot_year':None,'pivot_value':None}
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

    # ---------------------------------------------------------------------
    # v6 · 1) Autocorrelación: corrección de Hamed y Rao (1998)
    # ---------------------------------------------------------------------
    # Mann-Kendall supone años independientes. En lluvia tropical no siempre
    # lo son: El Niño dura 12-18 meses y abarca dos años seguidos. Si hay
    # memoria, la serie «parece» tener más información de la que tiene y el
    # valor p sale demasiado pequeño.
    #
    # Pasos: quitar la tendencia → pasar a rangos → medir la autocorrelación
    # de los rangos en los rezagos 1..5 → quedarse con los significativos →
    # inflar la varianza de S por el factor n/n*.
    #
    # Decisión conservadora del proyecto: el factor solo se aplica cuando es
    # MAYOR que 1 (vuelve la prueba más exigente). Con autocorrelación negativa
    # Hamed-Rao relajaría la prueba; aquí preferimos no hacerlo.
    var_c = var
    if var > 0:
        resid = [v - slope * y for y, v in pairs]
        r = rankdata(resid)
        mean_r = sum(r) / n
        r = [x - mean_r for x in r]
        denom = sum(x * x for x in r)
        factor_sum = 0.0
        if denom > 0:
            for k in range(1, min(5, n - 3) + 1):
                rho = sum(r[i] * r[i + k] for i in range(n - k)) / denom
                if k == 1:
                    out['autocorr_lag1'] = round(rho, 4)
                # Banda de confianza de Anderson para ρ_k = 0 (Hamed y Rao, ec. 4)
                lo_b = (-1 - Z95 * math.sqrt(n - k - 1)) / (n - k)
                hi_b = (-1 + Z95 * math.sqrt(n - k - 1)) / (n - k)
                if rho < lo_b or rho > hi_b:
                    factor_sum += (n - k) * (n - k - 1) * (n - k - 2) * rho
        factor = 1 + 2 * factor_sum / (n * (n - 1) * (n - 2))
        out['variance_factor'] = round(factor, 4)
        if factor > 1:
            var_c = var * factor
        z_c = (s - 1 if s > 0 else s + 1 if s < 0 else 0) / math.sqrt(var_c)
        out['kendall_p_hr'] = round(math.erfc(abs(z_c) / math.sqrt(2)), 6)

        # -----------------------------------------------------------------
        # v6 · 2) Intervalo de confianza de Sen (1968)
        # -----------------------------------------------------------------
        # Se ordenan las N pendientes entre pares y se eligen dos POSICIONES
        # alrededor de la mediana. Cuántas posiciones nos alejamos depende de
        # Var(S): C = z·√Var(S). Usamos la varianza ya corregida, para que el
        # intervalo y el valor p digan siempre lo mismo (si p < 0,05, el
        # intervalo no cruza el cero).
        ordered = sorted(slopes)
        N = len(ordered)
        C = Z95 * math.sqrt(var_c)
        m1 = max(0, min(N - 1, int(math.floor((N - C) / 2))))
        m2 = max(0, min(N - 1, int(math.ceil((N + C) / 2)) - 1))
        out['ci_low_per_decade'] = round(ordered[min(m1, m2)] * 10, 5)
        out['ci_high_per_decade'] = round(ordered[max(m1, m2)] * 10, 5)

    # Pivote: punto por el que pasa la recta en el año central. La web dibuja
    # el «abanico» de incertidumbre girando la recta alrededor de él.
    ymid = (pairs[0][0] + pairs[-1][0]) / 2
    out['pivot_year'] = round(ymid, 2)
    out['pivot_value'] = round(intercept + slope * ymid, 5)
    return out


def classify_trend(tr, p_adjusted=None, alpha=0.05):
    """Regla fija, escrita ANTES de ver resultados.

      datos_insuficientes : menos de 10 años completos
      creciente           : pendiente > 0 y p ajustado < α
      decreciente         : pendiente < 0 y p ajustado < α
      no_concluyente      : todo lo demás

    «No concluyente» NO significa «sin cambio»: significa que con estos datos
    no se distingue la señal del ruido.
    """
    if not tr or tr.get('slope_per_decade') is None:
        return 'datos_insuficientes'
    p = p_adjusted
    if p is None:
        p = tr.get('kendall_p_hr', tr.get('kendall_p'))
    if p is None:
        return 'datos_insuficientes'
    if p < alpha and tr['slope_per_decade'] > 0:
        return 'creciente'
    if p < alpha and tr['slope_per_decade'] < 0:
        return 'decreciente'
    return 'no_concluyente'


def request_json(url, timeout=95, attempts=3):
    err=None
    for k in range(attempts):
        try:
            req=urllib.request.Request(url,headers={'User-Agent':'NASA-Lluvia-CR-Visor/6.0 (investigacion; desktop)','Accept':'application/json'})
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
    units=str((response.get('parameters',{}).get(cfg['parameter']) or {}).get('units','')).strip()
    if units and units.lower().replace(' ','') not in ('mm','mm/day','mm/d','mmday-1','mm/day-1'):
        raise RuntimeError('Unidad inesperada en respuesta o caché NASA: '+units)
    day_clock=str((response.get('header') or {}).get('time_standard','UTC')).strip().upper()
    if day_clock!='UTC':raise RuntimeError('El producto NASA no usa el día UTC solicitado: '+day_clock)
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
    text=content.lstrip('﻿')
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
        wspell=0; maxwspell=0   # v6.2: CWD (racha húmeda), mismo criterio de día lluvioso
        for r in year_days:
            if r['mm'] is None: spell=0; wspell=0
            elif r['mm']<wet_min:
                spell+=1;maxspell=max(maxspell,spell); wspell=0
            else:
                spell=0; wspell+=1; maxwspell=max(maxwspell,wspell)
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
                       'fixed_days':fixed_days,
                       # v6.2 (ETCCDI): campos nuevos, no reemplazan a ninguno.
                       'cwd':maxwspell if complete else None,
                       'r10mm':sum(v>=10 for v in valid) if complete else None,
                       'r20mm':sum(v>=20 for v in valid) if complete else None})
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


# =============================================================================
# v6 · GEOGRAFÍA: territorio de Costa Rica y celdas del producto
# =============================================================================
# POR QUÉ ESTA SECCIÓN ES LA CLAVE DEL «CLIC EN CUALQUIER PUNTO»
# ---------------------------------------------------------------
# Un producto satelital NO mide puntos: entrega un valor por CELDA de la malla.
# Si una persona hace clic en Escazú, el dato que recibe es la lluvia media de
# un cuadrado de ~11 × 11 km que contiene a Escazú. Dos clics dentro de la
# misma celda reciben exactamente la misma serie.
#
# Por eso, en vez de «elegir cuántos metros tomar», la resolución la fija el
# producto, y lo correcto es: (1) mostrar al usuario qué celda va a usar,
# (2) decirle su tamaño real, y (3) avisarle si la celda es mayormente mar u
# otro país, porque entonces la serie no representa a Costa Rica.
#
# Resoluciones según la documentación de NASA POWER (fuentes de datos):
#   IMERG    : malla global 0,1° × 0,1° (≈ 10-11 km)
#   MERRA-2  : malla ½° × ⅝° (≈ 55 × 69 km a la latitud de Costa Rica)
#   NASA POWER ya no reproyecta las fuentes a una malla común.

BORDERS_FILE = WEB / 'assets' / 'borders.geojson'
COAST_TOLERANCE_KM = 2.0     # clics en la playa que caen fuera del polígono
KM_PER_DEG_LAT = 111.2       # aproximación suficiente a esta escala

# lat_edge0 / lon_edge0 = coordenada de un BORDE de celda de referencia.
GRIDS = {
    'gpm': {'dlat': 0.1, 'dlon': 0.1, 'lat_edge0': -90.0, 'lon_edge0': -180.0,
            'label': 'GPM IMERG 0,1° × 0,1°',
            'note': 'Malla nativa de IMERG en NASA POWER (≈ 11 km).'},
    'chirps_auto': {'dlat': 0.05, 'dlon': 0.05, 'lat_edge0': -50.0, 'lon_edge0': -180.0,
                    'label': 'CHIRPS 0,05° × 0,05°',
                    'note': 'Malla terrestre de CHIRPS (≈ 5,5 km); sobre el mar no hay datos.'},
    'era5': {'dlat': 0.25, 'dlon': 0.25, 'lat_edge0': -90.125, 'lon_edge0': -180.125,
             'label': 'ERA5 0,25° × 0,25°',
             'note': 'Reanálisis de Copernicus (≈ 28 km): representa una región, no un sitio.'},
    'merra2': {'dlat': 0.5, 'dlon': 0.625, 'lat_edge0': -90.25, 'lon_edge0': -180.3125,
               'label': 'MERRA-2 ½° × ⅝°',
               'note': ('Reanálisis de baja resolución: una celda cubre una región '
                        'entera (≈ 55 × 69 km), no un sitio.')},
}
AREA_MODES = {'cell': 1, 'block3': 3}
_BORDERS = None


def load_borders():
    """Lee la frontera una sola vez y la guarda como {país: [polígonos]}.

    Cada polígono es una lista de anillos [exterior, hueco1, ...] y cada anillo
    una lista de (lon, lat).
    """
    global _BORDERS
    if _BORDERS is None:
        gj = json.loads(BORDERS_FILE.read_text('utf-8'))
        out = {}
        for f in gj['features']:
            g = f['geometry']
            polys = [g['coordinates']] if g['type'] == 'Polygon' else g['coordinates']
            out[f['properties']['name']] = [[[tuple(c) for c in ring] for ring in poly]
                                            for poly in polys]
        _BORDERS = out
    return _BORDERS


def _in_ring(lon, lat, ring):
    """Algoritmo del rayo: cuenta cuántas veces una semirrecta cruza el borde.

    Impar = adentro. Es el método clásico de SIG para punto-en-polígono.
    """
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > lat) != (yj > lat):
            x_cross = xi + (lat - yi) * (xj - xi) / (yj - yi)
            if lon < x_cross:
                inside = not inside
        j = i
    return inside


def in_country(lat, lon, name='Costa Rica'):
    for poly in load_borders().get(name, []):
        if _in_ring(lon, lat, poly[0]) and not any(_in_ring(lon, lat, h) for h in poly[1:]):
            return True
    return False


def country_at(lat, lon):
    for name in load_borders():
        if in_country(lat, lon, name):
            return name
    return None


def distance_to_country_km(lat, lon, name='Costa Rica'):
    """Distancia mínima (km) del punto al borde del país.

    Proyección local equirrectangular: a escala de pocos km el error es
    despreciable y evita depender de bibliotecas geodésicas.
    """
    kx = KM_PER_DEG_LAT * math.cos(math.radians(lat))
    ky = KM_PER_DEG_LAT
    best = float('inf')
    for poly in load_borders().get(name, []):
        for ring in poly:
            for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
                ax, ay = (x1 - lon) * kx, (y1 - lat) * ky
                bx, by = (x2 - lon) * kx, (y2 - lat) * ky
                dx, dy = bx - ax, by - ay
                L2 = dx * dx + dy * dy
                t = 0.0 if L2 == 0 else max(0.0, min(1.0, -(ax * dx + ay * dy) / L2))
                px, py = ax + t * dx, ay + t * dy
                best = min(best, math.hypot(px, py))
    return best


def grid_cell(source, lat, lon, area_mode='cell'):
    """Celda del producto que contiene (lat, lon), con su tamaño real.

    Con area_mode='block3' devuelve el bloque de 3 × 3 celdas centrado en ella.
    Para CSV no hay malla conocida: la resolución la define quien hizo el CSV.
    """
    g = GRIDS.get(source)
    if g is None:
        return {'available': False,
                'note': 'Resolución desconocida: depende del producto con que se generó el CSV.'}
    block = AREA_MODES.get(area_mode, 1)
    i = math.floor((lat - g['lat_edge0']) / g['dlat'])
    j = math.floor((lon - g['lon_edge0']) / g['dlon'])
    clat = g['lat_edge0'] + (i + 0.5) * g['dlat']
    clon = g['lon_edge0'] + (j + 0.5) * g['dlon']
    half_lat = g['dlat'] * block / 2
    half_lon = g['dlon'] * block / 2
    height_km = 2 * half_lat * KM_PER_DEG_LAT
    width_km = 2 * half_lon * KM_PER_DEG_LAT * math.cos(math.radians(clat))
    return {
        'available': True, 'source': source, 'grid_label': g['label'],
        'grid_note': g['note'], 'area_mode': area_mode, 'block': block,
        'cell_id': f'{source}:{i}:{j}',
        'center_lat': round(clat, 5), 'center_lon': round(clon, 5),
        'lat_min': round(clat - half_lat, 5), 'lat_max': round(clat + half_lat, 5),
        'lon_min': round(clon - half_lon, 5), 'lon_max': round(clon + half_lon, 5),
        'dlat_deg': g['dlat'], 'dlon_deg': g['dlon'],
        'width_km': round(width_km, 2), 'height_km': round(height_km, 2),
        'width_m': int(round(width_km * 1000, -1)), 'height_m': int(round(height_km * 1000, -1)),
        'area_km2': round(width_km * height_km, 1),
    }


def cell_land_fractions(cell, samples=15, country='Costa Rica'):
    """Muestra qué fracción de la celda pertenece al país del punto."""
    if not cell.get('available'):
        return None
    own=other=cr=0
    total=samples*samples
    for a in range(samples):
        la=cell['lat_min']+(a+.5)*(cell['lat_max']-cell['lat_min'])/samples
        for b in range(samples):
            lo=cell['lon_min']+(b+.5)*(cell['lon_max']-cell['lon_min'])/samples
            at=country_at(la,lo)
            own+=at==country
            cr+=at=='Costa Rica'
            other+=at is not None and at!=country
    return {'pais':round(own/total,3),'country':country,'costa_rica':round(cr/total,3),
            'otro_pais':round(other/total,3),'mar':round((total-own-other)/total,3)}


def nearest_ca_country(lat,lon):
    return min(CA_COUNTRIES,key=lambda name:distance_to_country_km(lat,lon,name))


def cell_report(source,lat,lon,area_mode='cell'):
    """Ficha de celda para cualquiera de los siete países de Centroamérica."""
    lat=float(lat);lon=float(lon)
    if not(math.isfinite(lat) and math.isfinite(lon)):
        raise ValueError('Coordenadas no finitas.')
    in_box=5<=lat<=19.5 and -94<=lon<=-76
    location=country_at(lat,lon) if in_box else None
    inside=location in CA_COUNTRIES
    nearest=location if inside else nearest_ca_country(lat,lon) if in_box else None
    dist=0.0 if inside else distance_to_country_km(lat,lon,nearest) if nearest else None
    accepted=inside or (dist is not None and dist<=COAST_TOLERANCE_KM and location is None)
    rep={'lat':round(lat,6),'lon':round(lon,6),'accepted':accepted,
         'inside_polygon':inside,'country':(location or nearest) if accepted else location,
         'distance_to_country_km':round(dist,2) if dist is not None else None,
         'distance_to_cr_km':round(dist,2) if nearest=='Costa Rica' and dist is not None else None,
         'coast_tolerance_km':COAST_TOLERANCE_KM,'messages':[]}
    if not accepted:
        rep['verdict']='fuera'
        rep['messages'].append('El punto cae fuera de los siete países de Centroamérica.')
        return rep
    country=nearest
    if not inside:
        rep['messages'].append(f'El punto está a {dist:.1f} km de la costa de {country}; se acepta '
                               f'por la tolerancia cartográfica de {COAST_TOLERANCE_KM:.0f} km.')
    cell=grid_cell(source,lat,lon,area_mode)
    rep['cell']=cell
    if not cell.get('available'):
        rep['verdict']='apta'
        rep['messages'].append(cell['note']+' Comprueba que el CSV corresponda a este punto.')
        return rep
    fr=cell_land_fractions(cell,country=country)
    rep['land_fraction']=fr
    share=fr['pais']
    if share>=.6:
        rep['verdict']='apta'
        rep['messages'].append(f'La celda es {share*100:.0f} % tierra de {country}.')
    elif share>=.3:
        rep['verdict']='reservas'
        rep['messages'].append(f'Celda costera o fronteriza: {share*100:.0f} % es tierra de {country}.')
    elif country=='Costa Rica' and lat<7:
        rep['verdict']='reservas'
        rep['messages'].append(f'Isla del Coco: solo {share*100:.0f} % de la celda es tierra. Representa el entorno marítimo.')
    else:
        rep['verdict']='no_recomendada'
        rep['messages'].append(f'Solo {share*100:.0f} % de la celda es tierra de {country}; prueba un punto tierra adentro.')
    if source in ('merra2','era5'):rep['messages'].append(GRIDS[source]['note'])
    if area_mode=='block3':
        rep['messages'].append('El promedio 3 × 3 atenúa picos; compara umbrales con el mismo modo de área.')
    return rep


def get_area_data(source, lat, lon, y0, y1, progress, size=3):
    """Promedio espacial de size × size celdas centradas en la del punto.

    Regla estricta, igual que en todo el visor: un día solo tiene valor si las
    9 celdas tienen dato ese día. Si falta una, el día queda vacío. Promediar
    8 celdas un día y 9 otro mezclaría áreas distintas en la misma serie.

    Se consulta el CENTRO de cada celda (no la coordenada del clic): así cada
    consulta cae con margen dentro de su celda y la cache se reutiliza.
    """
    g = GRIDS[source]
    c = grid_cell(source, lat, lon, 'cell')
    half = size // 2
    series, urls = [], []
    for di in range(-half, half + 1):
        for dj in range(-half, half + 1):
            la = round(c['center_lat'] + di * g['dlat'], 5)
            lo = round(c['center_lon'] + dj * g['dlon'], 5)
            progress(f'Área {size}×{size}: celda ({la:.2f}, {lo:.2f})')
            d, u = get_nasa_data(source, la, lo, y0, y1, progress)
            series.append(d)
            urls.extend(u)
    keys = set().union(*[set(s) for s in series])
    out = {}
    for k in keys:
        vals = [s.get(k) for s in series]
        out[k] = round(sum(vals) / len(vals), 4) if all(v is not None for v in vals) else None
    return out, urls


# =============================================================================
# v6 · CAMBIO DE RÉGIMEN: Pettitt + comparación de modelos (BIC) + CUSUM
# =============================================================================
# Pendiente y salto son preguntas distintas:
#     5,6,7,8,9,10,11,12  -> sube gradualmente (tendencia, sin salto)
#     5,5,5,5,12,12,12,12 -> da un salto (pendiente pequeña, pero cambió)
# Pettitt solo, aplicado a una serie con tendencia, marca «quiebre» aunque no
# lo haya. Por eso se comparan cuatro modelos con BIC y se elige el que explica
# mejor los datos castigando la complejidad.

INSTRUMENT_YEARS = {'gpm': (2014, 2015)}   # transición de constelación TRMM → GPM


def _clean_pairs(years, values):
    return [(int(y), float(v)) for y, v in zip(years, values) if v is not None and math.isfinite(v)]


def pettitt(values):
    """Prueba de Pettitt (1979). Devuelve (índice del último valor antes del
    cambio, K, p). U(t) = 2·Σ rangos hasta t − t·(n+1)."""
    n = len(values)
    if n < 10:
        return -1, 0.0, 1.0
    r = rankdata(values)
    acc = 0.0
    U = []
    for t in range(n):
        acc += r[t]
        U.append(2 * acc - (t + 1) * (n + 1))
    margin = 2                                 # un corte en los extremos no parte la serie
    inner = range(margin, n - margin)
    idx = max(inner, key=lambda t: abs(U[t]))
    K = abs(U[idx])
    p = min(1.0, 2 * math.exp(-6 * K * K / (n ** 3 + n ** 2)))
    return idx, K, p


def _ols(X, y):
    """Mínimos cuadrados con ecuaciones normales (X'X)b = X'y. Devuelve la SCR.

    Solo lo usamos con 1-3 columnas, así que la eliminación de Gauss basta.
    """
    k = len(X[0])
    A = [[sum(row[a] * row[b] for row in X) for b in range(k)] for a in range(k)]
    v = [sum(row[a] * yy for row, yy in zip(X, y)) for a in range(k)]
    M = [A[a] + [v[a]] for a in range(k)]
    for c in range(k):
        piv = max(range(c, k), key=lambda r_: abs(M[r_][c]))
        if abs(M[piv][c]) < 1e-12:
            return None
        M[c], M[piv] = M[piv], M[c]
        for r_ in range(k):
            if r_ != c:
                f = M[r_][c] / M[c][c]
                M[r_] = [a - f * b for a, b in zip(M[r_], M[c])]
    beta = [M[a][k] / M[a][a] for a in range(k)]
    return sum((yy - sum(b * x for b, x in zip(beta, row))) ** 2 for row, yy in zip(X, y))


def compare_models(years, values):
    """¿Nulo, tendencia, salto o ambos? Selección por BIC = n·ln(SCR/n) + k·ln(n).

    El corte cuenta como un parámetro más: se estimó con los datos.
    Diferencia de BIC con el segundo mejor (Kass y Raftery, 1995):
    < 2 sin preferencia clara · 2-6 positiva · 6-10 fuerte · > 10 muy fuerte.
    """
    pairs = _clean_pairs(years, values)
    n = len(pairs)
    if n < 12:
        return {'modelo_preferido': 'indeterminado', 'motivo': 'Menos de 12 años completos.'}
    ys = [v for _, v in pairs]
    tm = sum(y for y, _ in pairs) / n
    ts = [y - tm for y, _ in pairs]

    def bic(scr, k):
        return n * math.log(max(scr, 1e-12) / n) + k * math.log(n)

    mean = sum(ys) / n
    cands = {'nulo': bic(sum((v - mean) ** 2 for v in ys), 1)}
    scr_t = _ols([[1, t] for t in ts], ys)
    cands['tendencia'] = bic(scr_t, 2) if scr_t is not None else float('inf')
    best_s = (float('inf'), None)
    best_a = (float('inf'), None)
    for k in range(4, n - 4):
        a, b = ys[:k], ys[k:]
        ma, mb = sum(a) / len(a), sum(b) / len(b)
        scr = sum((v - ma) ** 2 for v in a) + sum((v - mb) ** 2 for v in b)
        if scr < best_s[0]:
            best_s = (scr, k)
        scr2 = _ols([[1, t, 1 if i >= k else 0] for i, t in enumerate(ts)], ys)
        if scr2 is not None and scr2 < best_a[0]:
            best_a = (scr2, k)
    cands['salto'] = bic(best_s[0], 3) if best_s[1] else float('inf')
    cands['ambos'] = bic(best_a[0], 4) if best_a[1] else float('inf')
    pref = min(cands, key=cands.get)
    vals = sorted(cands.values())
    adv = vals[1] - vals[0]
    fuerza = ('sin_preferencia_clara' if adv < 2 else 'positiva' if adv < 6
              else 'fuerte' if adv < 10 else 'muy_fuerte')
    year_cut = None
    if pref == 'salto' and best_s[1]:
        year_cut = pairs[best_s[1]][0]
    if pref == 'ambos' and best_a[1]:
        year_cut = pairs[best_a[1]][0]
    texts = {'nulo': 'Sin tendencia ni salto: solo variabilidad.',
             'tendencia': 'Se describe mejor como un cambio GRADUAL.',
             'salto': 'Se describe mejor como un SALTO de nivel' + (f' desde {year_cut}' if year_cut else '') + '.',
             'ambos': 'Combina un cambio gradual con un salto' + (f' desde {year_cut}' if year_cut else '') + '.'}
    return {'modelo_preferido': pref, 'fuerza_preferencia': fuerza,
            'ventaja_bic': round(adv, 2), 'anio_corte': year_cut,
            'bic': {k: (round(v, 2) if math.isfinite(v) else None) for k, v in cands.items()},
            'explicacion': texts[pref]}


def change_point_analysis(years, values, source):
    """Une Pettitt, comparación de modelos y CUSUM para una serie anual."""
    pairs = _clean_pairs(years, values)
    out = {'years': [y for y, _ in pairs], 'values': [v for _, v in pairs],
           'cusum': [], 'pettitt': None, 'models': compare_models(years, values),
           'instrumental_flag': False, 'texto': ''}
    if len(pairs) < 10:
        out['texto'] = 'Serie demasiado corta para buscar un cambio de régimen.'
        return out
    vs = [v for _, v in pairs]
    m = sum(vs) / len(vs)
    sd = statistics.stdev(vs) if len(vs) > 1 else 0
    acc = 0.0
    for v in vs:
        acc += v - m
        out['cusum'].append(round(acc / sd, 4) if sd > 0 else 0.0)
    idx, K, p = pettitt(vs)
    year = pairs[idx + 1][0] if 0 <= idx < len(pairs) - 1 else None
    before = vs[:idx + 1]
    after = vs[idx + 1:]
    out['pettitt'] = {'anio_cambio': year, 'K': round(K, 2), 'p': round(p, 6),
                      'media_antes': round(sum(before) / len(before), 3) if before else None,
                      'media_despues': round(sum(after) / len(after), 3) if after else None}
    mod = out['models']
    has_jump = mod.get('modelo_preferido') in ('salto', 'ambos')
    cut = mod.get('anio_corte') or year
    flag_years = INSTRUMENT_YEARS.get(source, ())
    out['instrumental_flag'] = bool(has_jump and cut and any(abs(cut - a) <= 1 for a in flag_years))
    if p < 0.05 and has_jump:
        out['texto'] = (f'Cambio de nivel desde {cut} (Pettitt p = {p:.3f}). {mod["explicacion"]}')
    elif p < 0.05:
        out['texto'] = ('Pettitt detecta un cambio de nivel, pero la comparación de modelos indica que '
                        'se explica mejor como cambio gradual: probablemente es el reflejo de la tendencia.')
    else:
        out['texto'] = 'Sin cambio de régimen con evidencia suficiente. ' + mod.get('explicacion', '')
    if out['instrumental_flag']:
        out['texto'] += (' ⚠ Coincide con la transición de constelación TRMM → GPM (2014-2015): '
                         'antes de atribuirlo al clima hay que descartar un efecto del instrumento.')
    return out


# =============================================================================
# v6 · OTROS ANÁLISIS: cuantiles, estaciones, concentración, retorno
# =============================================================================

def quantile_shift(daily, start_year, end_year, wet_min):
    """¿Cambia la lluvia NORMAL o solo la EXTREMA?

    Compara cuantiles de los días lluviosos en la primera y la segunda mitad
    del período. Si el cuantil 50 casi no se mueve y el 99 sube, la cola se
    estira: «llueve igual de seguido, pero más fuerte cuando llueve fuerte».
    Es descriptivo (sin valor p): complementa a las tendencias, no las sustituye.
    """
    mid = (start_year + end_year) // 2
    a = [r['mm'] for r in daily if r['mm'] is not None and r['mm'] >= wet_min and r['year'] <= mid]
    b = [r['mm'] for r in daily if r['mm'] is not None and r['mm'] >= wet_min and r['year'] > mid]
    rows = []
    if len(a) >= 100 and len(b) >= 100:
        for q in (10, 25, 50, 75, 90, 95, 98, 99, 99.5):
            qa, qb = pct(a, q), pct(b, q)
            rows.append({'q': q, 'first_mm': round(qa, 3), 'second_mm': round(qb, 3),
                         'diff_mm': round(qb - qa, 3),
                         'ratio_pct': round(100 * (qb - qa) / qa, 2) if qa > 0 else None})
    return {'periods': [[start_year, mid], [mid + 1, end_year]],
            'n_first': len(a), 'n_second': len(b), 'rows': rows,
            'note': 'Cuantiles de días con lluvia ≥ umbral de día lluvioso. Descriptivo, sin prueba de significancia.'}


SEASONS = {'dry': (12, 1, 2, 3, 4), 'rainy': (5, 6, 7, 8, 9, 10, 11)}
VERANILLO = (7, 8)
VERANILLO_REF = (5, 6, 9, 10)


def seasonal_analysis(monthly, start_year, end_year):
    """Totales por temporada y veranillo, año por año (solo meses completos).

    Temporada seca = dic-abr del MISMO año calendario (declarado: el diciembre
    que se suma es el de inicio de la siguiente estación; el efecto es
    constante y no sesga la tendencia).

    Veranillo (canícula): razón entre la lluvia media de julio-agosto y la de
    mayo, junio, septiembre y octubre. < 1 confirma la pausa; si baja con los
    años, la pausa se profundiza. Es un rasgo de la vertiente del PACÍFICO; en
    la vertiente del Caribe el ciclo anual es distinto y el índice se lee con
    cuidado.
    """
    tot = {(r['year'], r['month']): r['total'] for r in monthly}
    years = list(range(start_year, end_year + 1))
    out = {'years': years, 'dry': [], 'rainy': [], 'veranillo_ratio': []}
    for y in years:
        for key in ('dry', 'rainy'):
            vals = [tot.get((y, m)) for m in SEASONS[key]]
            out[key].append(round(sum(vals), 3) if all(v is not None for v in vals) else None)
        v = [tot.get((y, m)) for m in VERANILLO]
        ref = [tot.get((y, m)) for m in VERANILLO_REF]
        if all(x is not None for x in v + ref) and sum(ref) > 0:
            out['veranillo_ratio'].append(round((sum(v) / 2) / (sum(ref) / 4), 4))
        else:
            out['veranillo_ratio'].append(None)
    out['trend_dry'] = trend(years, out['dry'])
    out['trend_rainy'] = trend(years, out['rainy'])
    out['trend_veranillo'] = trend(years, out['veranillo_ratio'])
    return out


def climatology_halves(monthly, start_year, end_year):
    """Ciclo anual medio en la primera y la segunda mitad: ¿cambió la forma del año?"""
    mid = (start_year + end_year) // 2
    res = {'periods': [[start_year, mid], [mid + 1, end_year]], 'first': [], 'second': []}
    for m in range(1, 13):
        a = [r['total'] for r in monthly if r['month'] == m and r['total'] is not None and r['year'] <= mid]
        b = [r['total'] for r in monthly if r['month'] == m and r['total'] is not None and r['year'] > mid]
        res['first'].append(round(statistics.mean(a), 2) if a else None)
        res['second'].append(round(statistics.mean(b), 2) if b else None)
    return res


def concentration_signature(annual):
    """Firma de la hipótesis central del proyecto: «llueve más en menos tiempo».

    Si a la vez:  total anual ≈ estable, días lluviosos ↓, intensidad (SDII) ↑ y
    fracción aportada por días > P95 (R95pTOT/total) ↑,
    el conjunto es compatible con una concentración de la lluvia. Cuatro
    índices independientes contando la misma historia pesan más que uno solo.
    """
    years = [r['year'] for r in annual]
    share = [round(100 * r['r95ptot'] / r['total'], 3)
             if r['total'] and r['r95ptot'] is not None else None for r in annual]
    t = {'total': trend(years, [r['total'] for r in annual]),
         'wet_days': trend(years, [r['wet_days'] for r in annual]),
         'sdii': trend(years, [r['rainy_mean'] for r in annual]),
         'r95_share_pct': trend(years, share)}

    def sig(tr):
        p = tr.get('kendall_p_hr')
        return None if p is None or tr['slope_per_decade'] is None else (
            1 if p < 0.05 and tr['slope_per_decade'] > 0 else -1 if p < 0.05 else 0)

    checks = {'total_estable': sig(t['total']) == 0,
              'dias_lluviosos_bajan': sig(t['wet_days']) == -1,
              'intensidad_sube': sig(t['sdii']) == 1,
              'fraccion_extrema_sube': sig(t['r95_share_pct']) == 1}
    k = sum(checks.values())
    if any(sig(x) is None for x in t.values()):
        verdict, text = 'sin_datos', 'Faltan años completos para evaluar la firma de concentración.'
    elif k >= 3:
        verdict, text = 'compatible', 'Los índices son compatibles con una concentración de la lluvia en menos días más intensos.'
    elif k == 2:
        verdict, text = 'parcial', 'Evidencia mixta: algunos índices apuntan a concentración y otros no.'
    else:
        verdict, text = 'no_compatible', 'Los índices no respaldan una concentración de la lluvia en este punto.'
    return {'years': years, 'r95_share_pct': share, 'trends': t, 'checks': checks,
            'criterios_a_favor': k, 'veredicto': verdict, 'texto': text,
            'advertencia': 'Lectura de coherencia entre índices; cada índice tiene su propio valor p.'}


def return_levels(annual):
    """Períodos de retorno de la lluvia máxima diaria (Rx1day) con Gumbel.

    «Lluvia de 1 en 10 años» = valor que en promedio se supera una vez cada 10
    años. Ajuste por el método de los momentos:
        α = √6·s/π ,  u = media − 0,5772·α ,  x_T = u − α·ln(−ln(1 − 1/T))
    Las posiciones empíricas usan Gringorten: T = (n + 0,12)/(m − 0,44).
    Con menos de 20 años, extrapolar a 50 años es muy incierto: se advierte.
    """
    xs = [r['rx1day'] for r in annual if r['rx1day'] is not None]
    n = len(xs)
    if n < 10:
        return {'n': n, 'levels': [], 'empirical': [], 'method': 'Gumbel (momentos)',
                'note': 'Se requieren al menos 10 años completos.'}
    m = statistics.mean(xs)
    s = statistics.stdev(xs)
    alpha = math.sqrt(6) * s / math.pi
    u = m - 0.5772156649 * alpha
    levels = [{'T': T, 'mm': round(u - alpha * math.log(-math.log(1 - 1 / T)), 2)}
              for T in (2, 5, 10, 25, 50)]
    emp = []
    for rank, v in enumerate(sorted(xs, reverse=True), start=1):
        emp.append({'T': round((n + 0.12) / (rank - 0.44), 3), 'mm': v})
    note = ('Ajuste de Gumbel por momentos sobre el máximo diario de cada año completo.'
            + (' Con menos de 20 años, los períodos de 25 y 50 años son extrapolaciones muy inciertas.' if n < 20 else ''))
    return {'n': n, 'mu': round(u, 3), 'alpha': round(alpha, 3), 'levels': levels,
            'empirical': emp, 'method': 'Gumbel (momentos)', 'note': note}


# =============================================================================
# v6.2 · ÍNDICES ETCCDI y BANDA BOOTSTRAP de la pendiente
# =============================================================================
# ¿Cuentan los índices la misma historia? Un solo índice puede subir por azar;
# si PRCPTOT queda plano mientras R95pTOT, SDII y Rx1day suben, el conjunto
# describe una CONCENTRACIÓN de la lluvia. El mapa de calor de la web pinta la
# dirección (color) y escribe la pendiente real (número) de cada índice.
#
# Definiciones (Zhang et al., 2011, WIREs Clim. Change; manual RClimDex):
#   PRCPTOT  total anual en días lluviosos         Rx1day / Rx5day  máximos de 1 y 5 días
#   R95p_d   días > P95 del período de referencia  R95pTOT / R99pTOT  lluvia en días > P95 / P99
#   SDII     intensidad media en días lluviosos    CDD / CWD  racha seca / húmeda más larga
#   R10mm / R20mm  días ≥ 10 / ≥ 20 mm
# Diferencia declarada: ETCCDI usa ≥ 1 mm como día lluvioso; aquí se usa el
# umbral elegido por el usuario (1 mm por defecto) y el P95 de su población.

ETCCDI_INDICES = (
    ('PRCPTOT', 'PRCPTOT', 'mm', lambda r: r['total']),
    ('R95p_dias', 'R95p días', 'días', lambda r: r['exceedances'].get('95')),
    ('Rx1day', 'Rx1day', 'mm', lambda r: r['rx1day']),
    ('Rx5day', 'Rx5day', 'mm', lambda r: r['rx5day']),
    ('R95pTOT', 'R95pTOT', 'mm', lambda r: r['r95ptot']),
    ('R99pTOT', 'R99pTOT', 'mm', lambda r: r['r99ptot']),
    ('SDII', 'SDII', 'mm/día', lambda r: r['rainy_mean']),
    ('R10mm', 'R10mm', 'días', lambda r: r.get('r10mm')),
    ('R20mm', 'R20mm', 'días', lambda r: r.get('r20mm')),
    ('CDD', 'CDD', 'días', lambda r: r['cdd']),
    ('CWD', 'CWD', 'días', lambda r: r.get('cwd')),
)


def etccdi_trends(annual):
    years = [r['year'] for r in annual]
    out = {}
    for key, label, unit, get in ETCCDI_INDICES:
        vals = [get(r) for r in annual]
        out[key] = {'label': label, 'unit': unit, 'values': vals, 'trend': trend(years, vals)}
    return {'years': years, 'indices': out,
            'nota': 'Pendiente de Theil–Sen por década; estado con Mann-Kendall (Hamed-Rao) y Holm entre puntos.'}


def _sen_slope(pairs):
    slopes = [(pairs[j][1] - pairs[i][1]) / (pairs[j][0] - pairs[i][0])
              for i in range(len(pairs)) for j in range(i + 1, len(pairs))]
    return statistics.median(slopes) if slopes else None


def bootstrap_slope_ci(years, values, B=500, level=95, seed=2026):
    """IC de la pendiente de Sen por bootstrap de BLOQUES MÓVILES de residuos.

    POR QUÉ OTRO INTERVALO: el IC de Sen es analítico (supone la distribución
    de S). El bootstrap no supone forma alguna: re-muestrea los residuos en
    bloques de ≈ n^(1/3) años, conservando la memoria entre años (El Niño),
    los suma a la recta y vuelve a estimar la pendiente B veces.
    Si ambos intervalos coinciden, la conclusión es robusta al método.
    Semilla fija: el mismo dato da siempre el mismo intervalo (reproducible).
    """
    import random
    pairs = _clean_pairs(years, values)
    n = len(pairs)
    if n < 10:
        return None
    slope = _sen_slope(pairs)
    inter = statistics.median(v - slope * y for y, v in pairs)
    resid = [v - (inter + slope * y) for y, v in pairs]
    L = max(2, round(n ** (1 / 3)))
    rng = random.Random(seed + n)
    est = []
    for _ in range(B):
        res = []
        while len(res) < n:
            k = rng.randrange(0, n - L + 1)
            res.extend(resid[k:k + L])
        sim = [(y, inter + slope * y + e) for (y, _), e in zip(pairs, res[:n])]
        s = _sen_slope(sim)
        if s is not None:
            est.append(s)
    est.sort()
    a = (100 - level) / 200
    lo = est[int(math.floor(a * (len(est) - 1)))]
    hi = est[int(math.ceil((1 - a) * (len(est) - 1)))]
    return {'boot_ci_low_per_decade': round(lo * 10, 5), 'boot_ci_high_per_decade': round(hi * 10, 5),
            'boot_B': B, 'boot_block_years': L, 'boot_method': 'bloques móviles de residuos (Künsch, 1989)'}


def add_bootstrap_bands(agg, adv):
    """Añade la banda bootstrap a las series del gráfico «¿Dónde cambia?»."""
    annual = agg['annual']
    years = [r['year'] for r in annual]
    sm = agg['summary']
    jobs = [(sm['annual_trend'], [r['total'] for r in annual])]
    for t in FIXED_THRESHOLDS_MM:
        jobs.append((sm['fixed_threshold_trends'][str(t)], [r['fixed_days'][str(t)] for r in annual]))
    for p in ('95', '99'):
        jobs.append((sm['extreme_count_trends'][p], [r['exceedances'][p] for r in annual]))
    conc = adv.get('concentration') or {}
    ct = conc.get('trends') or {}
    if ct:
        jobs.append((ct['wet_days'], [r['wet_days'] for r in annual]))
        jobs.append((ct['sdii'], [r['rainy_mean'] for r in annual]))
        jobs.append((ct['r95_share_pct'], conc.get('r95_share_pct') or []))
    sea = adv.get('seasonal') or {}
    for k, s in (('trend_dry', 'dry'), ('trend_rainy', 'rainy')):
        if sea.get(k):
            jobs.append((sea[k], sea.get(s) or []))
    for tr, vals in jobs:
        if tr and tr.get('slope_per_decade') is not None:
            yrs = years if len(vals) == len(years) else (sea.get('years') or years)
            b = bootstrap_slope_ci(yrs, vals)
            if b:
                tr.update(b)


def advanced_statistics(agg, start_year, end_year, wet_min, source):
    """Reúne todos los análisis v6 de un punto. No modifica la salida de aggregate."""
    annual = agg['annual']
    years = [r['year'] for r in annual]
    adv = {
        'change_points': {
            'annual_total': change_point_analysis(years, [r['total'] for r in annual], source),
            'fixed_50.8': change_point_analysis(years, [r['fixed_days']['50.8'] for r in annual], source),
            'P95': change_point_analysis(years, [r['exceedances']['95'] for r in annual], source),
            # v6.2: también para P80/P90/P98/P99, para marcar el salto sobre la serie de excedencias
            **{f'P{p}': change_point_analysis(years, [r['exceedances'][str(p)] for r in annual], source)
               for p in PERCENTILES if p != 95},
        },
        'quantile_shift': quantile_shift(agg['daily'], start_year, end_year, wet_min),
        'seasonal': seasonal_analysis(agg['monthly'], start_year, end_year),
        'climatology_halves': climatology_halves(agg['monthly'], start_year, end_year),
        'concentration': concentration_signature(annual),
        'return_levels': return_levels(annual),
        'etccdi': etccdi_trends(annual),   # v6.2
    }
    # v6.2: banda bootstrap. Añade campos boot_* a las tendencias existentes
    # (no cambia ningún valor ya calculado).
    add_bootstrap_bands(agg, adv)
    return adv


# =============================================================================
# v6 · IDONEIDAD: ¿alcanzan los datos de este punto para concluir algo?
# =============================================================================

def assess_validity(point, cell_rep, request):
    """Ficha de verificación del punto. Cada criterio tiene una razón técnica.

    Estados: ok · aviso · no · info.  Nivel final:
      apto               : ningún aviso ni fallo
      apto_con_reservas  : algún aviso
      no_apto            : algún fallo (la conclusión no se sostiene)
    """
    sm = point['summary']
    checks = []

    def add(cid, label, status, detail):
        checks.append({'id': cid, 'label': label, 'status': status, 'detail': detail})

    # 1. Territorio y celda
    if cell_rep:
        if cell_rep.get('inside_polygon'):
            add('territorio', 'Dentro del país', 'ok', f'El punto cae dentro de {cell_rep.get("country")}.')
        else:
            add('territorio', 'Dentro del país', 'aviso',
                f'A {cell_rep.get("distance_to_country_km")} km de la costa; aceptado por tolerancia cartográfica.')
        fr = cell_rep.get('land_fraction')
        if fr:
            share = fr['pais']
            st = 'ok' if share >= 0.6 else 'aviso' if share >= 0.3 else 'no'
            if st == 'no' and cell_rep.get('verdict') == 'reservas':
                st = 'aviso'          # Isla del Coco: limitación inevitable, no un error
            add('celda_tierra', 'Celda mayormente terrestre', st,
                f'{share*100:.0f} % de la celda es {cell_rep.get("country")}, {fr["mar"]*100:.0f} % mar y '
                f'{fr["otro_pais"]*100:.0f} % otro país.')
        cell = cell_rep.get('cell') or {}
        if cell.get('available'):
            add('resolucion', 'Área representada', 'info',
                f'{cell["grid_label"]}: ≈ {cell["width_km"]:.1f} × {cell["height_km"]:.1f} km '
                f'({cell["area_km2"]:.0f} km²). El valor es la media de esa área, no un pluviómetro.')
    # 2. Longitud de la serie
    ny = sm['complete_years']
    add('anios', 'Años completos para tendencia', 'ok' if ny >= 20 else 'aviso' if ny >= 10 else 'no',
        f'{ny} años completos. Theil-Sen/Kendall exige ≥ 10; con ≥ 20 la tendencia se distingue mejor de El Niño/La Niña.')
    # 3. Período de referencia
    nr = sm['reference_annual_n']
    add('referencia', 'Período de referencia', 'ok' if nr >= 20 else 'aviso' if nr >= 10 else 'no',
        f'{nr} años completos en {sm["reference_period"]}. La OMM usa 30 años para normales; ≥ 20 es aceptable para percentiles.')
    # 4. Cobertura diaria
    cov = sm['coverage_pct']
    add('cobertura', 'Cobertura diaria', 'ok' if cov >= 95 else 'aviso' if cov >= 80 else 'no',
        f'{cov:.1f} % de días con dato. Los faltantes nunca se rellenan.')
    # 5. Tamaño de muestra para percentiles altos
    ns = sm['reference_sample_n']
    add('muestra_percentiles', 'Muestra para P95/P99', 'ok' if ns >= 1000 else 'aviso' if ns >= 200 else 'no',
        f'{ns} días en la muestra de referencia. Para P99 conviene ≥ 1000 (≈ 10 excedencias esperadas); con < 200 incluso P95 es inestable.')
    # 6. Frecuencia de días con umbral fijo (el % de la esquina)
    mean508 = sm['fixed_threshold_mean_days'].get('50.8')
    if mean508 is not None:
        st = 'ok' if mean508 >= 2 else 'aviso'
        add('eventos_umbral', 'Eventos ≥ 50,8 mm suficientes', st,
            f'Media de {mean508:.1f} días/año ≥ 50,8 mm. Con menos de 2 al año la serie tiene muchos ceros y '
            f'el porcentaje de cambio es poco estable.')
    rare = [t for t in ('76.2', '101.6', '127') if (sm['fixed_threshold_mean_days'].get(t) or 0) < 0.5]
    if rare:
        add('umbrales_raros', 'Umbrales altos poco frecuentes', 'info',
            'Días ≥ ' + ', '.join(rare).replace('.', ',') + ' mm ocurren menos de una vez cada dos años aquí: '
            'sus paneles son ilustrativos, no concluyentes.')
    # 7. Particularidades de la fuente
    src = request['source']
    if src == 'gpm':
        recent = request['end_year'] >= date.today().year - (1 if date.today().month <= 4 else 0)
        if recent:
            add('late_run', 'Años recientes (IMERG Late)', 'aviso',
                'NASA POWER mezcla IMERG Late con Final en los últimos ~3,5 meses. Para tendencias conviene '
                'terminar el análisis en un año ya cerrado.')
    if src == 'merra2':
        add('fuente', 'Tipo de fuente', 'info', 'MERRA-2 es un reanálisis (modelo + observaciones), no una medición satelital directa.')
    if src == 'era5':
        add('fuente', 'Tipo de fuente', 'info', 'ERA5 es el reanálisis de Copernicus/ECMWF (modelo + observaciones), independiente de la NASA; celda ≈ 28 km.')
    if request.get('area_mode') == 'block3':
        add('area', 'Promedio 3 × 3', 'info',
            'La serie es el promedio de 9 celdas (≈ 33 km). Atenúa los picos: compara umbrales solo entre puntos con el mismo modo.')
    statuses = [c['status'] for c in checks]
    level = 'no_apto' if 'no' in statuses else 'apto_con_reservas' if 'aviso' in statuses else 'apto'
    texts = {'apto': 'Los datos de este punto cumplen todos los criterios para interpretar tendencias.',
             'apto_con_reservas': 'Se puede interpretar, pero con las reservas indicadas.',
             'no_apto': 'Al menos un criterio falla: no conviene sacar conclusiones de tendencia de este punto.'}
    return {'nivel': level, 'resumen': texts[level], 'checks': checks}


def apply_multiple_testing(results):
    """Holm entre puntos, métrica por métrica, y estado de cada tendencia.

    Se aplica a cada familia «misma métrica en todos los puntos». Usa el p de
    Hamed-Rao (ya corregido por autocorrelación) cuando existe.
    """
    def paths(pt):
        sm = pt['summary']
        yield ('annual_trend',), sm['annual_trend']
        for t in FIXED_THRESHOLDS_MM:
            yield ('fixed', str(t)), sm['fixed_threshold_trends'][str(t)]
        for p in PERCENTILES:
            yield ('exceed', str(p)), sm['extreme_count_trends'][str(p)]
        adv = pt.get('advanced') or {}
        sea = adv.get('seasonal') or {}
        for k in ('trend_dry', 'trend_rainy', 'trend_veranillo'):
            if k in sea:
                yield ('season', k), sea[k]
        for k, tr in ((adv.get('concentration') or {}).get('trends') or {}).items():
            yield ('conc', k), tr
        # v6.2: cada índice ETCCDI es su propia familia de Holm entre puntos
        for k, ix in ((adv.get('etccdi') or {}).get('indices') or {}).items():
            yield ('etccdi', k), ix['trend']

    families = defaultdict(list)
    for pt in results:
        for key, tr in paths(pt):
            families[key].append(tr)
    for key, trs in families.items():
        ps = [tr.get('kendall_p_hr') if tr.get('kendall_p_hr') is not None else tr.get('kendall_p') for tr in trs]
        adj = holm(ps)
        for tr, pa in zip(trs, adj):
            tr['kendall_p_holm'] = pa
            tr['holm_family_size'] = sum(p is not None for p in ps)
            tr['estado'] = classify_trend(tr, pa)


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
    if not isinstance(points,list) or not 1<=len(points)<=6:raise ValueError('Seleccione de 1 a 6 puntos.')
    # v6: modo de área. Se valida aquí y se guarda en cada punto para no
    # cambiar la forma de la tupla que devuelve esta función.
    area_mode=args.get('area_mode','cell')
    if area_mode not in AREA_MODES: raise ValueError('Modo de área inválido.')
    if area_mode=='block3':
        if source!='gpm': raise ValueError('El promedio 3 × 3 solo está disponible para GPM IMERG.')
        if len(points)>3: raise ValueError('El promedio 3 × 3 consulta 9 celdas por punto: máximo 3 puntos.')
    pts=[]
    for i,p in enumerate(points):
        lat=float(p['lat']);lon=float(p['lon']);name=str(p.get('name',f'Punto {i+1}')).strip()[:95]
        if not (5<=lat<=19.5 and -94<=lon<=-76):
            raise ValueError(f'El punto {name} está fuera del mapa de Centroamérica.')
        if not cell_report(source,lat,lon,area_mode)['accepted']:
            raise ValueError(f'El punto {name} ({lat:.4f}, {lon:.4f}) cae fuera de los siete países de Centroamérica.')
        pts.append({'name':name or f'Punto {i+1}','lat':lat,'lon':lon,'area_mode':area_mode})
    pop=args.get('population','wet')
    if pop not in ('wet','all'): raise ValueError('Población de percentiles inválida.')
    wet=float(args.get('wet_min',1))
    if not(0<=wet<=10): raise ValueError('El umbral de día lluvioso debe estar entre 0 y 10 mm.')
    parse_reference_lag(args.get('reference_lag_days',0))
    if args.get('robustness','fast') not in ROBUSTNESS_MODES:raise ValueError('Modo de robustez inválido.')
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
    return '﻿'+fout.getvalue()



def tsv_text(fields, rows):
    """TXT tabulado UTF-8 con encabezados. Vacíos, nunca lluvia simulada."""
    output=io.StringIO()
    writer=csv.DictWriter(output,fieldnames=fields,delimiter='\t',extrasaction='ignore',lineterminator='\n')
    writer.writeheader()
    for row in rows:
        writer.writerow({field:('' if row.get(field) is None else row[field]) for field in fields})
    return '﻿'+output.getvalue()


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
                          'cambio_porcentual':tr['relative_change_pct'],'kendall_p':tr['kendall_p'],
                          # v6: columnas añadidas AL FINAL para no romper lectores existentes.
                          'ic95_bajo_dias_decada':tr.get('ci_low_per_decade'),
                          'ic95_alto_dias_decada':tr.get('ci_high_per_decade'),
                          'kendall_p_hamed_rao':tr.get('kendall_p_hr'),
                          'kendall_p_holm':tr.get('kendall_p_holm'),'estado':tr.get('estado')})
        write('tendencias_umbrales_fijos',
              ['lugar','latitud','longitud','fuente','umbral_mm_dia','media_anual_dias','n_anios_completos',
               'primer_anio','ultimo_anio','pendiente_dias_decada','cambio_dias','cambio_porcentual','kendall_p',
               'ic95_bajo_dias_decada','ic95_alto_dias_decada','kendall_p_hamed_rao','kendall_p_holm','estado'],fixed)
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

        # v6 · tendencias avanzadas en una sola tabla
        adv_rows=[]
        def add_tr(metric,unit,tr):
            adv_rows.append({**fieldsbase,'metrica':metric,'unidad_por_decada':unit,'n_anios':tr.get('n'),
                'pendiente_por_decada':tr.get('slope_per_decade'),'ic95_bajo':tr.get('ci_low_per_decade'),
                'ic95_alto':tr.get('ci_high_per_decade'),'cambio_porcentual':tr.get('relative_change_pct'),
                'kendall_p':tr.get('kendall_p'),'kendall_p_hamed_rao':tr.get('kendall_p_hr'),
                'kendall_p_holm':tr.get('kendall_p_holm'),'autocorr_lag1':tr.get('autocorr_lag1'),
                'estado':tr.get('estado')})
        sm=pt['summary'];adv=pt.get('advanced') or {}
        add_tr('lluvia_total_anual','mm',sm['annual_trend'])
        for t in FIXED_THRESHOLDS_MM: add_tr(f'dias_desde_{t}_mm','dias',sm['fixed_threshold_trends'][str(t)])
        for p in PERCENTILES: add_tr(f'dias_mayores_P{p}','dias',sm['extreme_count_trends'][str(p)])
        sea=adv.get('seasonal') or {}
        for k,lab,u in (('trend_dry','temporada_seca_dic_abr','mm'),('trend_rainy','temporada_lluviosa_may_nov','mm'),
                        ('trend_veranillo','razon_veranillo_jul_ago','razon')):
            if k in sea: add_tr(lab,u,sea[k])
        for k,tr in ((adv.get('concentration') or {}).get('trends') or {}).items():
            add_tr('concentracion_'+k,'segun_indice',tr)
        write('tendencias_avanzadas',['lugar','latitud','longitud','fuente','metrica','unidad_por_decada','n_anios',
              'pendiente_por_decada','ic95_bajo','ic95_alto','cambio_porcentual','kendall_p','kendall_p_hamed_rao',
              'kendall_p_holm','autocorr_lag1','estado'],adv_rows)
        # v6 · celda y ficha de idoneidad
        cr=pt.get('cell_report') or {};cell=cr.get('cell') or {};fr=cr.get('land_fraction') or {}
        val=pt.get('validity') or {}
        kv=[('celda_producto',cell.get('grid_label','sin malla conocida')),('modo_area',pt.get('area_mode')),
            ('centro_celda_lat',cell.get('center_lat')),('centro_celda_lon',cell.get('center_lon')),
            ('ancho_km',cell.get('width_km')),('alto_km',cell.get('height_km')),('area_km2',cell.get('area_km2')),
            ('fraccion_costa_rica',fr.get('costa_rica')),('fraccion_mar',fr.get('mar')),('fraccion_otro_pais',fr.get('otro_pais')),
            ('veredicto_celda',cr.get('verdict')),('nivel_idoneidad',val.get('nivel')),('resumen',val.get('resumen'))]
        kv+=[('criterio_'+c['id'],f'{c["status"]}: {c["detail"]}') for c in val.get('checks',[])]
        write('celda_y_validez',['lugar','latitud','longitud','fuente','campo','valor'],
              [{**fieldsbase,'campo':k,'valor':v} for k,v in kv])
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
    report.append('ATLAS DE LLUVIA CENTROAMÉRICA | INFORME DE SERIES ANALIZADAS (v6.3)')
    report.append(f'Fuente: {out["source_label"]}')
    report.append(f'Analisis: {out["start_year"]}-{out["end_year"]}; referencia: {out["ref_start"]}-{out["ref_end"]}')
    report.append(f'Poblacion de percentiles: {out["population"]}; dia lluvioso >= {out["wet_min"]} mm')
    report.append(f'Modo de area: {out.get("area_mode","cell")} (cell = 1 celda nativa; block3 = promedio de 3x3 celdas)')
    report.append('Umbral superado: lluvia diaria > percentil (estrictamente mayor).')
    report.append('Episodio: dias calendaricos consecutivos que superan el mismo umbral.')
    report.append('Los anos incompletos no aportan conteos ni acumulados anuales.')
    report.append('Cero real y dato ausente son diferentes. NO hay imputacion.')
    report.append('Los puntos NO constituyen un mapa de lluvia continua; no se interpola.')
    report.append('Umbrales fijos diarios >= 50.8, 76.2, 101.6 y 127.0 mm (equivalentes exactos a 2, 3, 4 y 5 pulgadas).')
    report.append('Cambio porcentual = 100 * (ajuste final - ajuste inicial) / ajuste inicial; ajuste Theil-Sen sobre primeros y ultimos anos completos.')
    report.append('Sin 10 anos completos, base cero o ajuste negativo no se publica porcentaje; Kendall p es exploratorio.')
    report.append('v6: IC 95 % de Sen; p de Kendall corregido por autocorrelacion (Hamed-Rao, solo si vuelve la prueba mas exigente);')
    report.append('    p ajustado por Holm entre los puntos analizados; estado = creciente / decreciente / no_concluyente / datos_insuficientes.')
    for pt in out['points']:
        report.append('')
        report.append(f'{pt["name"]} ({pt["lat"]:.5f}, {pt["lon"]:.5f})')
        report.append('Cobertura: '+str(pt['summary']['coverage_pct'])+'%; '+str(pt['summary']['valid_days'])+' dias validos')
        cell=(pt.get('cell_report') or {}).get('cell') or {}
        if cell.get('available'):
            report.append(f'Celda: {cell["grid_label"]}, centro ({cell["center_lat"]}, {cell["center_lon"]}), '
                          f'~{cell["width_km"]} x {cell["height_km"]} km')
        if pt.get('validity'):
            report.append('Idoneidad: '+pt['validity']['nivel']+' - '+pt['validity']['resumen'])
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


def load_input_series(args,source,ix,point,y0,y1,progress,reference=False,area_mode='cell'):
    prefix='reference_' if reference else ''
    if source in IMPORT_SOURCES:
        content=args.get(prefix+'csv_by_point',{}).get(str(ix),'')
        options=args.get(prefix+'import_options',{}).get(str(ix),{})
        named=str(options.get('product','')).strip()
        if any(x in named.lower() for x in ('daymet','nldas','radarsat','seawifs','chlorophyll','swot')):
            raise ValueError('El producto declarado no representa precipitación con cobertura centroamericana.')
        if source in ('giovanni','hydrology','chirps') and not named:
            raise ValueError('Especifica nombre y versión del producto importado.')
        obs,meta=import_precip(content,options)
        meta['portal']=source
        provenance=[x for x in (SOURCES[source]['url'],'CSV aportado; producto declarado: '+meta['product']) if x]
        return obs,meta,provenance
    if source=='era5':
        return era5_openmeteo.get_era5(point['lat'],point['lon'],y0,y1,DATA/'cache_era5',progress)
    if source=='chirps_auto':
        return chirps_climateserv.get_chirps(point['lat'],point['lon'],y0,y1,DATA/'cache_chirps',progress)
    if source=='noaa':
        station=args.get(prefix+'stations',{}).get(str(ix),'')
        progress('Descargando estación NOAA '+str(station))
        return get_noaa(station,y0,y1,DATA/'cache_noaa')
    if area_mode=='block3' and not reference:
        obs,urls=get_area_data(source,point['lat'],point['lon'],y0,y1,progress,3)
    else:
        obs,urls=get_nasa_data(source,point['lat'],point['lon'],y0,y1,progress)
    return obs,{'product':SOURCES[source]['parameter'],'input_unit':'mm','output_unit':'mm/día',
                'temporal':'daily','day_definition':'UTC','counts':{},'issues':[],
                'note':'Las respuestas NASA originales se conservan en caché.'},urls


GRIDDED_PRODUCTS={'gpm':'IMERG','merra2':'MERRA-2','era5':'ERA5','chirps_auto':'CHIRPS'}
PRODUCT_DISAGREE_RATIO=1.3   # media anual > 30 % mayor en un producto que en el otro

def product_agreement(annual_a,annual_b,src_a,src_b):
    """Avisa si dos productos en malla (IMERG, MERRA-2, CHIRPS) difieren mucho en el mismo punto.

    Compara la lluvia anual media de los años completos que ambos tienen. Un cociente > 1,3
    suele indicar que la celda de un producto cae en relieve o en un borde costero que el otro
    no resuelve; no dice cuál es el correcto (compárese con una estación).
    """
    if src_a not in GRIDDED_PRODUCTS or src_b not in GRIDDED_PRODUCTS or src_a==src_b:
        return {'applicable':False}
    pairs=[(a['total'],b['total']) for a,b in zip(annual_a,annual_b) if a['total'] is not None and b['total'] is not None]
    if len(pairs)<3:return {'applicable':True,'n_years':len(pairs),'warning':None}
    ma=statistics.mean(p[0] for p in pairs);mb=statistics.mean(p[1] for p in pairs)
    if min(ma,mb)<=0:return {'applicable':True,'n_years':len(pairs),'warning':None}
    ratio=max(ma,mb)/min(ma,mb);na,nb=GRIDDED_PRODUCTS[src_a],GRIDDED_PRODUCTS[src_b]
    out={'applicable':True,'n_years':len(pairs),'mean_a_mm':round(ma,1),'mean_b_mm':round(mb,1),
         'product_a':na,'product_b':nb,'ratio':round(ratio,2),'warning':None}
    if ratio>PRODUCT_DISAGREE_RATIO:
        hi,lo=(na,nb) if ma>mb else (nb,na)
        out['warning']=(f'Aviso: {na} y {nb} difieren mucho en este punto ({ma:.0f} frente a {mb:.0f} mm/año; '
                        f'{hi} marca {100*(ratio-1):.0f} % más que {lo}). La celda de un producto puede caer en relieve o costa '
                        'que el otro no resuelve. Contrasta con una estación antes de interpretar tendencias o extremos.')
    return out


ROBUSTNESS_MODES={'off':(),'fast':('gpm','merra2','era5'),'full':('gpm','merra2','era5','chirps_auto')}


def _product_series(product,point,y0,y1,progress,reuse=None):
    """Serie diaria de un producto en malla para el punto (reutiliza la ya descargada)."""
    if reuse is not None:return reuse
    if product=='chirps_auto':
        return chirps_climateserv.get_chirps(point['lat'],point['lon'],y0,y1,DATA/'cache_chirps',progress)[0]
    if product=='era5':
        return era5_openmeteo.get_era5(point['lat'],point['lon'],y0,y1,DATA/'cache_era5',progress)[0]
    return get_nasa_data(product,point['lat'],point['lon'],y0,y1,progress)[0]


def trend_robustness(point,src,obs,y0,y1,wet,pop,mode,progress,area_mode='cell'):
    """Idea 3: ¿la tendencia anual se sostiene en varios productos independientes de la elección?

    Calcula Theil–Sen / Mann-Kendall (con corrección Hamed-Rao) para IMERG, MERRA-2 y,
    si se pide, CHIRPS, en el MISMO período común y la misma celda. Una tendencia que
    cambia de signo según el producto depende de la fuente, no del clima.
    """
    products=ROBUSTNESS_MODES.get(mode,())
    if not products:return {'status':'off'}
    cy0=max(y0,max(SOURCES[p]['min_year'] for p in products));cy1=y1
    out={'status':'ok','mode':mode,'period':[cy0,cy1],'products':[]}
    if cy1-cy0+1<10:
        out.update(status='insuficiente',note=f'El período común {cy0}–{cy1} tiene menos de 10 años: no se compara.')
        return out
    for p in products:
        label=GRIDDED_PRODUCTS[p]
        try:
            reuse=obs if (p==src and area_mode=='cell') else None
            progress(f'Robustez: {label} {cy0}–{cy1}')
            data=_product_series(p,point,cy0,cy1,progress,reuse)
            agg=aggregate(data,cy0,cy1,cy0,cy1,wet,pop)
            tr=agg['summary']['annual_trend'] or {}
            tots=[a['total'] for a in agg['annual'] if a['total'] is not None]
            out['products'].append({'source':p,'label':label,'is_main':p==src,'n_years':len(tots),
                'mean_annual_mm':round(statistics.mean(tots),1) if tots else None,
                'slope_per_decade':tr.get('slope_per_decade'),'p_mk':tr.get('kendall_p'),'p_hr':tr.get('kendall_p_hr'),
                'ci_low':tr.get('ci_low_per_decade'),'ci_high':tr.get('ci_high_per_decade'),
                'estado':classify_trend(tr) if tr else 'datos_insuficientes'})
        except (RuntimeError,ValueError,OSError) as exc:
            out['products'].append({'source':p,'label':label,'is_main':p==src,'error':str(exc)[:300],'estado':'error'})
    ok=[r for r in out['products'] if r.get('slope_per_decade') is not None]
    out['n_compared']=len(ok)
    if len(ok)<2:
        out.update(status='insuficiente',note='Menos de dos productos con tendencia calculable.')
        return out
    signs={(r['slope_per_decade']>0)-(r['slope_per_decade']<0) for r in ok}
    sig={r['estado'] for r in ok if r['estado'] in ('creciente','decreciente')}
    means=[r['mean_annual_mm'] for r in ok if r['mean_annual_mm']]
    out['mean_ratio']=round(max(means)/min(means),2) if len(means)>=2 and min(means)>0 else None
    if len(signs)>1 and sig:verdict='contradictoria'
    elif len(signs)>1:verdict='signo_opuesto'
    elif len(sig)==1 and all(r['estado'] in sig for r in ok):verdict='robusta_significativa'
    elif sig:verdict='mismo_signo_parcial'
    else:verdict='mismo_signo_no_significativa'
    out['verdict']=verdict
    out['note']={'robusta_significativa':'Todos los productos muestran una tendencia significativa en la misma dirección.',
                 'mismo_signo_parcial':'Todos coinciden en la dirección, pero solo algunos alcanzan significancia.',
                 'mismo_signo_no_significativa':'Todos coinciden en la dirección, pero ninguno es significativo.',
                 'signo_opuesto':'Los productos no coinciden ni en la dirección (ninguno significativo): la tendencia depende de la fuente.',
                 'contradictoria':'Un producto da tendencia significativa y otro la da en sentido contrario: la conclusión depende de la fuente.'}[verdict]
    return out


def traffic_light(point):
    """Semáforo de confianza: ¿se puede confiar en la conclusión de este punto?

    Junta controles ya calculados: validez de los datos (años, cobertura, celda...),
    acuerdo de nivel entre productos (cociente de medias) y robustez del signo de la
    tendencia. El color NO dice si llueve más o menos ni si la tendencia es significativa.
      rojo     : un criterio falla (no sacar conclusiones)
      amarillo : interpretable con reservas
      verde    : datos suficientes y productos coherentes
    """
    red,yellow,green=[],[],[]
    checks=(point.get('validity') or {}).get('checks',[])
    for c in checks:
        if c['status']=='no':red.append(c['label']+': '+c['detail'])
        elif c['status']=='aviso':yellow.append(c['label']+': '+c['detail'])
    if not red and not yellow:green.append('Datos suficientes: años completos, cobertura y celda adecuados.')
    rb=point.get('robustness') or {}
    ratio=rb.get('mean_ratio')
    if rb.get('status')=='ok':
        if ratio is not None and ratio>2:red.append(f'Los productos difieren más del doble en la lluvia media (cociente {ratio:.2f}).')
        elif ratio is not None and ratio>PRODUCT_DISAGREE_RATIO:yellow.append(f'Los productos difieren {100*(ratio-1):.0f} % en la lluvia media.')
        elif ratio is not None:green.append(f'Los productos coinciden en la lluvia media (diferencia {100*(ratio-1):.0f} %).')
        v=rb.get('verdict')
        if v=='contradictoria':red.append(rb['note'])
        elif v=='signo_opuesto':yellow.append(rb['note'])
        else:green.append(rb['note'])
    elif rb.get('status')=='insuficiente':yellow.append('Robustez entre productos no evaluable: '+rb.get('note',''))
    color='rojo' if red else 'amarillo' if yellow else 'verde'
    tr=(point.get('summary') or {}).get('annual_trend') or {}
    st=tr.get('estado') or classify_trend(tr)
    if tr.get('slope_per_decade') is not None:
        if tr.get('kendall_p_holm') is not None and (tr.get('holm_family_size') or 1)>1:
            p,plab=tr['kendall_p_holm'],f'p Holm, {tr["holm_family_size"]} puntos'
        elif tr.get('kendall_p_hr') is not None:p,plab=tr['kendall_p_hr'],'p Hamed-Rao'
        else:p,plab=tr.get('kendall_p'),'p Mann-Kendall'
        words={'creciente':'aumento significativo','decreciente':'disminución significativa',
               'no_concluyente':'no concluyente','datos_insuficientes':'datos insuficientes'}
        trend=f'Lluvia anual: {tr["slope_per_decade"]:+.0f} mm/década · {words.get(st,st)}'+(f' ({plab} = {p:.2f})' if p is not None else '')
        if rb.get('status')=='ok':
            same=sum(1 for r in rb['products'] if r.get('slope_per_decade') is not None and (r['slope_per_decade']>0)==(tr['slope_per_decade']>0))
            trend+=f' · mismo signo en {same} de {rb["n_compared"]} productos'
    else:trend='Lluvia anual: tendencia no calculable (menos de 10 años completos).'
    titles={'verde':'Confianza alta','amarillo':'Confianza media: interpretar con reservas','rojo':'Confianza baja: no sacar conclusiones'}
    return {'color':color,'title':titles[color],'trend':trend,'red':red,'yellow':yellow,'green':green}


def parse_reference_lag(value):
    """Desfase declarado de la referencia: 'auto' o entero −2…2 (0 por defecto)."""
    if value in (None,''):return 0
    if str(value).strip().lower()=='auto':return 'auto'
    try:lag=int(str(value).strip().replace('−','-'))
    except ValueError:raise ValueError('Desfase de referencia inválido.')
    if not -2<=lag<=2:raise ValueError('El desfase de la referencia debe estar entre −2 y 2 días.')
    return lag


def add_point_verification(obs,point_data,reference,ref_meta,ref_urls,args,point,y0,y1,r0,r1,wet,pop):
    ref=aggregate(reference,y0,y1,r0,r1,wet,pop)
    sample=[r['mm'] for r in ref['daily'] if r0<=r['year']<=r1 and r['mm'] is not None
            and (pop=='all' or r['mm']>=wet)]
    thresholds=[('≥ '+str(t)+' mm',t,False) for t in (wet,)+FIXED_THRESHOLDS_MM]
    thresholds += [('> P'+str(p)+' de referencia',pct(sample,p),True) for p in (95,99)]
    first=f'{y0}-01-01';last=f'{y1}-12-31'
    result=compare_series({d:v for d,v in obs.items() if first<=d<=last},
                          {d:v for d,v in reference.items() if first<=d<=last},thresholds,
                          bool(args.get('aligned_days',False)),parse_reference_lag(args.get('reference_lag_days',0)))
    result['reference_name']=ref_meta.get('station',{}).get('name') or ref_meta.get('product','Referencia')
    result['reference_provenance']=ref_urls
    result['reference_quality']=quality_audit(reference,y0,y1,r0,r1,ref_meta,args.get('suspect_mm',500))
    result['reference_type']=args.get('reference_type','station')
    st=ref_meta.get('station')
    result['distance_km']=round(distance_km(point['lat'],point['lon'],st['lat'],st['lon']),2) if st else None
    result['reference_location']=st
    result['annual_trends']=[]
    result['product_agreement']=product_agreement(point_data['annual'],ref['annual'],args.get('source'),args.get('reference_source'))
    if result['product_agreement'].get('warning'):
        result['note']=(result['product_agreement']['warning']+' '+result.get('note','')).strip()
    if result['status']=='compared':
        matched=[(a,b) for a,b in zip(point_data['annual'],ref['annual'])
                 if a['total'] is not None and b['total'] is not None]
        years=[a['year'] for a,b in matched]
        for t in FIXED_THRESHOLDS_MM:
            key=str(t)
            result['annual_trends'].append({'threshold_mm':t,'n_years':len(years),
                'product':trend(years,[a['fixed_days'][key] for a,b in matched]),
                'reference':trend(years,[b['fixed_days'][key] for a,b in matched])})
        if all(r['product_mm']==r['reference_mm'] for r in result['pairs']):
            result['note']+=' Las series pareadas son idénticas: comprueba la independencia de la referencia.'
    return result


def add_quality_exports(session,out):
    """Anexa cobertura, incidencias y pares al ZIP TXT previo de v6.2."""
    records=[]
    for i,pt in enumerate(out['points'],1):
        stem=f'{i:02d}_{slug(pt["name"])}'
        q=pt['quality'];v=pt['verification']
        for name,fields,rows in [
            ('cobertura_y_calidad_anual',['year','valid_days','expected_days','coverage_pct'],q['yearly']),
            ('dias_para_revision',['fecha','lluvia_mm','motivo'],q['suspicious_days']),
            ('incidencias_importacion',['fila','fecha','motivo','valor'],q['import'].get('issues',[]))]:
            file=session/f'{stem}_{name}.txt'
            file.write_text(tsv_text(fields,rows),encoding='utf-8')
            records.append(file)
        file=session/f'{stem}_informe_calidad_y_verificacion.txt'
        file.write_text(json.dumps({'quality':q,'verification':{k:val for k,val in v.items() if k!='pairs'}},
                              ensure_ascii=False,indent=2),encoding='utf-8-sig')
        records.append(file)
        if v.get('status')=='compared':
            for name,fields,rows in [
                ('verificacion_diaria',['date','product_date','product_mm','reference_mm','error_mm'],v['pairs']),
                ('verificacion_desfases',['lag_days','n','pearson_r'],(v.get('lag') or {}).get('diagnostic',[])),
                ('verificacion_eventos',['threshold','threshold_mm','hits','misses','false_alarms','correct_negatives','pod','far','csi'],v['events'])]:
                file=session/f'{stem}_{name}.txt'
                file.write_text(tsv_text(fields,rows),encoding='utf-8')
                records.append(file)
    with zipfile.ZipFile(session/'DATOS_TXT_COMPLETOS.zip','a',compression=zipfile.ZIP_DEFLATED) as z:
        for file in records:z.write(file,file.name)
    out['exports'] += [{'name':f.name,'size_bytes':f.stat().st_size} for f in records]
    out['exports'].append({'name':'analisis_estadistico.json',
                           'size_bytes':(session/'analisis_estadistico.json').stat().st_size})
    next(e for e in out['exports'] if e['name']=='DATOS_TXT_COMPLETOS.zip')['size_bytes']=(session/'DATOS_TXT_COMPLETOS.zip').stat().st_size


def start_job(args):
    src,y0,y1,r0,r1,pts,pop,wet=validate_request(args)
    area_mode=pts[0]['area_mode'] if pts else 'cell'
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
            request={'source':src,'start_year':y0,'end_year':y1,'ref_start':r0,'ref_end':r1,'area_mode':area_mode}
            for ix,pt in enumerate(pts):
                progress(f'[{ix+1}/{len(pts)}] {pt["name"]}')
                obs,meta,urls=load_input_series(args,src,ix,pt,y0,y1,progress,area_mode=area_mode)
                requested=dict(pt)
                if src=='noaa':
                    st=meta['station']
                    pt={**pt,'lat':st['lat'],'lon':st['lon'],'name':st['name']+' · '+st['id']}
                data=aggregate(obs,y0,y1,r0,r1,wet,pop)
                data['quality']=quality_audit(obs,y0,y1,r0,r1,meta,args.get('suspect_mm',500))
                if data['summary']['valid_days']<30:
                    raise RuntimeError(f'{pt["name"]}: menos de 30 días disponibles en la serie.')
                rec={'name':pt['name'],'lat':pt['lat'],'lon':pt['lon'],
                     'source':src,'source_label':SOURCES[src]['label'],
                     'provenance':urls,'area_mode':area_mode,'requested_point':requested,**data}
                # v6: estadística avanzada, celda y ficha de idoneidad
                rec['advanced']=advanced_statistics(data,y0,y1,wet,src)
                rec['verification']={'status':'not_requested','note':'No se cargó una referencia independiente.'}
                ref_source=args.get('reference_source','none')
                if ref_source not in ('none','csv','noaa','chirps_auto','era5'):raise ValueError('Referencia inválida.')
                if ref_source!='none':
                    try:
                        reference,rm,ru=load_input_series(args,ref_source,ix,pt,y0,y1,progress,reference=True)
                        rec['verification']=add_point_verification(obs,data,reference,rm,ru,args,pt,y0,y1,r0,r1,wet,pop)
                    except (ValueError,RuntimeError) as exc:
                        rec['verification']={'status':'error','note':'Referencia no procesada: '+str(exc)}
                rec['cell_report']=cell_report(src,pt['lat'],pt['lon'],area_mode)
                rec['validity']=assess_validity(rec,rec['cell_report'],request)
                rec['robustness']=trend_robustness(pt,src,obs,y0,y1,wet,pop,args.get('robustness','fast'),progress,area_mode)
                results.append(rec)
                progress(f'Calculados estadísticos: {pt["name"]}.')
            # v6: Holm entre puntos (necesita TODOS los p, por eso va después del bucle)
            apply_multiple_testing(results)
            # v6: dos puntos en la misma celda reciben la misma serie
            by_cell=defaultdict(list)
            for k,r in enumerate(results):
                cid=((r.get('cell_report') or {}).get('cell') or {}).get('cell_id')
                if cid: by_cell[cid].append(k)
            for ks in by_cell.values():
                if len(ks)>1:
                    names=', '.join(results[k]['name'] for k in ks)
                    for k in ks:
                        results[k]['validity']['checks'].append({'id':'celda_compartida','label':'Celda compartida',
                            'status':'aviso','detail':f'{names} usan la misma celda: sus series son idénticas y no son '
                            'observaciones independientes.'})
                        if results[k]['validity']['nivel']=='apto':
                            results[k]['validity']['nivel']='apto_con_reservas'
                            results[k]['validity']['resumen']='Se puede interpretar, pero con las reservas indicadas.'
            for r in results:r['traffic_light']=traffic_light(r)
            out={'source':src,'source_label':SOURCES[src]['label'],'start_year':y0,'end_year':y1,
                 'ref_start':r0,'ref_end':r1,'wet_min':wet,'population':pop,'area_mode':area_mode,
                 'version':VERSION,
                 'generated_at':datetime.now().isoformat(timespec='seconds'),
                 'points':results,'correlations':correlation_matrix(results),
                 'method':'Percentiles con interpolación lineal; muestra de referencia de lluvia diaria; acumulados mensuales y anuales solo con cobertura 100%; tendencias Theil–Sen con IC 95 % de Sen, Kendall tau-b con corrección de Hamed-Rao y ajuste de Holm entre puntos.'}
            session=REPORTS/(datetime.now().strftime('%Y%m%d_%H%M%S')+'_'+jobid)
            session.mkdir(parents=True,exist_ok=True)
            for pt in results:
                pn=slug(pt['name'])
                for kind in ('daily','monthly','annual'):
                    (session/f'{pn}_{kind}.csv').write_text(generate_csv(pt,kind),encoding='utf-8')
            (session/'analisis_estadistico.json').write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding='utf-8')
            out['exports']=write_report_exports(session,out)
            add_quality_exports(session,out)
            out['saved_to']=str(session)
            with JOBS_LOCK:
                state['result']=out;state['state']='done'
            progress('Análisis finalizado; TXT, CSV, ZIP y JSON guardados.')
        except Exception as e:
            with JOBS_LOCK: state['state']='error';state['error']=str(e)
            progress('Error: '+str(e))
    threading.Thread(target=work,name='NASA-'+jobid,daemon=True).start()
    return jobid


# =============================================================================
# v6.2 · VALIDACIÓN SATÉLITE vs ESTACIONES (ver estaciones.py)
# =============================================================================
STATION_CACHE = DATA / 'cache_estaciones'


def validate_validation_request(args):
    """Comprueba TODO lo que llega de la web antes de tocar la red."""
    if not isinstance(args, dict): raise ValueError('Solicitud inválida.')
    src = args.get('source', 'gpm')
    if src not in ('gpm', 'merra2'): raise ValueError('Para validar elija GPM IMERG o MERRA-2.')
    y0 = int(args.get('start_year', 2001)); y1 = int(args.get('end_year', 2024))
    if not (SOURCES[src]['min_year'] <= y0 <= y1 <= date.today().year): raise ValueError('Años incompatibles con la fuente.')
    if y1 - y0 > 40: raise ValueError('Máximo 41 años.')
    ids = args.get('stations', [])
    if not isinstance(ids, list) or len(ids) > len(estaciones.STATIONS): raise ValueError('Lista de estaciones inválida.')
    ids = [str(i) for i in ids]
    for i in ids:
        if i not in estaciones.STATIONS: raise ValueError('Estación desconocida.')
    custom = args.get('custom_station')
    cst = None
    if custom:
        if not isinstance(custom, dict): raise ValueError('Estación propia inválida.')
        lat = float(custom.get('lat')); lon = float(custom.get('lon'))
        name = str(custom.get('name') or 'Estación propia').strip()[:80]
        if not cell_report(src,lat,lon)['accepted']:
            raise ValueError('La estación propia cae fuera de Centroamérica.')
        cst = {'name': name, 'lat': lat, 'lon': lon,
               'institution': str(custom.get('institution') or 'Proporcionada por el usuario').strip()[:80],
               'data': estaciones.parse_station_csv(custom.get('csv', ''))}
    if not ids and not cst: raise ValueError('Elija al menos una estación o cargue un CSV de estación.')
    wet = float(args.get('wet_min', 1))
    if not (0 <= wet <= 10): raise ValueError('Umbral de día lluvioso inválido.')
    return src, y0, y1, ids, cst, wet


def _validation_table(rows):
    tab = []
    for r in rows:
        cm = r.get('comparison') or {}
        m = cm.get('continuas') or {}
        cat = {x['umbral_mm']: x for x in cm.get('categoricas') or []}
        ex = cm.get('extremos') or {}
        tab.append({'estacion': r['station']['name'], 'id': r['station']['id'], 'lat': r['station']['lat'],
                    'lon': r['station']['lon'], 'dist_centro_celda_km': r.get('distance_to_cell_center_km'),
                    'dias_pareados': cm.get('n_pareados'),
                    **{k: m.get(k) for k in ('pbias_pct', 'sesgo_mm_dia', 'mae', 'rmse', 'pearson_r', 'spearman_rho', 'kge')},
                    'mensual_r': cm.get('mensual_r'), 'pod_1mm': (cat.get(1) or {}).get('pod'),
                    'far_1mm': (cat.get(1) or {}).get('far'), 'csi_1mm': (cat.get(1) or {}).get('csi'),
                    'hss_1mm': (cat.get(1) or {}).get('hss'), 'csi_20mm': (cat.get(20) or {}).get('csi'),
                    'mejor_desfase': cm.get('mejor_desfase'), 'tasa_deteccion_extremos': ex.get('tasa_deteccion'),
                    'fraccion_pico': ex.get('mediana_fraccion_pico'), 'error': r.get('error')})
    return tab


VALIDATION_FIELDS = ['estacion', 'id', 'lat', 'lon', 'dist_centro_celda_km', 'dias_pareados', 'pbias_pct',
                     'sesgo_mm_dia', 'mae', 'rmse', 'pearson_r', 'spearman_rho', 'kge', 'mensual_r', 'pod_1mm',
                     'far_1mm', 'csi_1mm', 'hss_1mm', 'csi_20mm', 'mejor_desfase', 'tasa_deteccion_extremos',
                     'fraccion_pico', 'error']


def run_validation(src, y0, y1, ids, cst, wet, progress):
    """Descarga y compara. Separado del hilo para poder probarlo."""
    rows = []
    targets = [{'id': i, **estaciones.STATIONS[i], 'institution': 'IMN · vía NOAA NCEI GHCN-Daily'} for i in ids]
    if cst:
        targets.append({'id': 'propia', **{k: v for k, v in cst.items() if k != 'data'}, 'elev_m': None,
                        'first': y0, 'last': y1})
    for t in targets:
        progress(f'Estación: {t["name"]}')
        a, b = max(y0, t['first']), min(y1, t['last'])
        if a > b:
            rows.append({'station': t, 'error': f'La estación solo tiene datos {t["first"]}–{t["last"]}.'})
            continue
        if t['id'] == 'propia':
            obs, qc, url_obs = cst['data'], {}, 'CSV aportado por el usuario (procedencia por verificar)'
        else:
            obs, qc, url_obs = estaciones.fetch_ghcn(t['id'], a, b, STATION_CACHE, progress)
        obs = {d: v for d, v in obs.items() if a <= int(d[:4]) <= b}
        sat, urls = get_nasa_data(src, t['lat'], t['lon'], a, b, progress)
        cell = cell_report(src, t['lat'], t['lon'], 'cell')
        c = cell.get('cell') or {}
        dist = (estaciones.haversine_km(t['lat'], t['lon'], c['center_lat'], c['center_lon'])
                if c.get('available') else None)
        cmp_ = estaciones.compare_series(sat, obs, wet)
        cmp_['dias_estacion'] = len(obs)
        cmp_['cobertura_estacion_pct'] = round(100 * len(obs) / ((date(b, 12, 31) - date(a, 1, 1)).days + 1), 1)
        cmp_['anios'] = [a, b]
        rows.append({'station': t, 'cell': c, 'land_fraction': cell.get('land_fraction'),
                     'distance_to_cell_center_km': round(dist, 2) if dist is not None else None,
                     'qc': qc, 'provenance': {'estacion': url_obs, 'satelite': urls},
                     'comparison': cmp_})
        progress(f'Comparado: {t["name"]} ({cmp_["n_pareados"]} días pareados).')
    return rows


def start_validation_job(args):
    src, y0, y1, ids, cst, wet = validate_validation_request(args)
    jobid = uuid.uuid4().hex[:16]
    state = {'id': jobid, 'state': 'waiting', 'progress': ['Validación solicitada.'], 'result': None,
             'error': None, 'created': time.time(), 'kind': 'validation'}
    with JOBS_LOCK:
        JOBS[jobid] = state

    def progress(msg):
        with JOBS_LOCK:
            state['progress'].append(msg)
            state['progress'] = state['progress'][-28:]

    def work():
        with JOBS_LOCK:
            state['state'] = 'running'
        try:
            rows = run_validation(src, y0, y1, ids, cst, wet, progress)
            out = {'kind': 'validation', 'source': src, 'source_label': SOURCES[src]['label'], 'start_year': y0,
                   'end_year': y1, 'wet_min': wet, 'version': VERSION, 'stations': rows,
                   'generated_at': datetime.now().isoformat(timespec='seconds'),
                   'method': ('Comparación en días pareados (sin imputar faltantes): sesgo, PBIAS, MAE, RMSE, Pearson, '
                              'Spearman, KGE (Kling et al., 2012); POD/FAR/CSI/FBI/HSS a 1-50 mm; desfase ±2 días; '
                              'Q-Q de días lluviosos; detección de extremos > P95.')}
            REPORTS.mkdir(parents=True, exist_ok=True)
            session = REPORTS / (datetime.now().strftime('%Y%m%d_%H%M%S') + '_validacion_' + jobid)
            session.mkdir(parents=True, exist_ok=True)
            (session / 'validacion_estaciones.json').write_text(json.dumps(out, ensure_ascii=False), encoding='utf-8')
            (session / 'VALIDACION_SATELITE_VS_ESTACIONES.txt').write_text(
                tsv_text(VALIDATION_FIELDS, _validation_table(rows)), encoding='utf-8')
            out['saved_to'] = str(session)
            # Mismo mecanismo de descarga que el análisis (/api/download con lista permitida)
            out['exports'] = [{'name': f.name, 'size_bytes': f.stat().st_size}
                              for f in (session / 'VALIDACION_SATELITE_VS_ESTACIONES.txt', session / 'validacion_estaciones.json')]
            with JOBS_LOCK:
                state['result'] = out
                state['state'] = 'done'
            progress('Validación finalizada.')
        except Exception as e:
            with JOBS_LOCK:
                state['state'] = 'error'
                state['error'] = str(e)
            progress('Error: ' + str(e))

    threading.Thread(target=work, name='VAL-' + jobid, daemon=True).start()
    return jobid


def stations_near(points):
    """Catálogo de estaciones con la distancia a cada punto del análisis."""
    cat = estaciones.station_catalog()
    for s in cat:
        s['dist_km'] = [round(estaciones.haversine_km(s['lat'], s['lon'], p[0], p[1]), 1) for p in points]
    return cat


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
            'q':q+', Centroamérica','limit':10,'format':'jsonv2','addressdetails':1,'countrycodes':'gt,bz,sv,hn,ni,cr,pa'})
        data=request_json(url,timeout=20,attempts=1)
    if not isinstance(data,list):raise RuntimeError('Geocodificación sin resultados.')
    for p in data:
        try:lat=float(p['lat']);lon=float(p['lon'])
        except (KeyError,ValueError,TypeError):continue
        if 5<=lat<=19.5 and -94<=lon<=-76 and cell_report('csv',lat,lon)['accepted']:
            return {'name':q,'lat':lat,'lon':lon,'type':'buscado',
                    'reference':False,'osm_label':p.get('display_name','')}
    raise RuntimeError('No se localizó ese nombre dentro de Centroamérica.')


class Handler(BaseHTTPRequestHandler):
    server_version='LluviaCA/'+VERSION
    def log_message(self,*args):
        if args and '/api/status' not in str(args[0]) and '/api/cell' not in str(args[0]): print('[WEB]',args[0] % args[1:] if len(args)>1 else args[0])
    def send_data(self, status, body, content_type='application/json; charset=utf-8'):
        if not isinstance(body,bytes):
            body=(json.dumps(body,ensure_ascii=False,allow_nan=False) if 'json' in content_type else str(body)).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type',content_type)
        self.send_header('Content-Length',str(len(body)))
        # v6.2: antes TODO lo estático se guardaba 1 h en el navegador
        # (max-age=3600). Tras actualizar app.js/styles.css, el navegador seguía
        # mostrando los gráficos de la versión anterior. Ahora la página y su
        # código se revalidan siempre (no-cache); solo las librerías pesadas
        # y la frontera, que no cambian, se guardan.
        if 'api/' in self.path: cache='no-store'
        elif '/assets/' in self.path: cache='public, max-age=86400'
        else: cache='no-cache'
        self.send_header('Cache-Control',cache)
        self.send_header('X-Content-Type-Options','nosniff')
        # Los servidores de teselas de OpenStreetMap exigen Referer y devuelven
        # una tesela «Access blocked» si falta. Se envía solo el origen
        # (http://127.0.0.1:puerto), nunca la ruta ni los parámetros.
        self.send_header('Referrer-Policy','strict-origin-when-cross-origin')
        self.end_headers();self.wfile.write(body)
    def do_GET(self):
        parsed=urllib.parse.urlparse(self.path);path=parsed.path
        q=urllib.parse.parse_qs(parsed.query)
        try:
            if path=='/api/places':return self.send_data(200,{'places':read_places(),'sources':SOURCES})
            if path=='/api/resources':return self.send_data(200,{'resources':RESOURCES})
            if path=='/api/nearby-stations':
                lat=float(q.get('lat',[''])[0]);lon=float(q.get('lon',[''])[0])
                if not cell_report('csv',lat,lon)['accepted']:raise ValueError('Fuera de Centroamérica.')
                def _yr(k):
                    v=q.get(k,[''])[0]
                    return int(v) if v.strip().isdigit() else None
                return self.send_data(200,{'stations':nearby_stations(lat,lon,DATA/'cache_noaa',_yr('y0'),_yr('y1'))})
            if path=='/api/status':
                jid=q.get('id',[''])[0]
                with JOBS_LOCK:
                    job=JOBS.get(jid)
                    if not job:return self.send_data(404,{'error':'Trabajo no encontrado.'})
                    result={k:v for k,v in job.items() if k!='created'}
                return self.send_data(200,result)
            if path=='/api/geocode':return self.send_data(200,geocode(q.get('name',[''])[0]))
            if path=='/api/cell':
                # v6: ficha de lo que representa un clic, antes de analizar.
                src=q.get('source',['gpm'])[0]
                if src not in SOURCES: raise ValueError('Fuente desconocida.')
                mode=q.get('area',['cell'])[0]
                if mode not in AREA_MODES: raise ValueError('Modo de área inválido.')
                return self.send_data(200,cell_report(src,float(q.get('lat',[''])[0]),float(q.get('lon',[''])[0]),mode))
            if path=='/api/stations':
                pts=[]
                for item in q.get('pts',[''])[0].split(';')[:6]:
                    if not item: continue
                    la,lo=(float(x) for x in item.split(',')[:2])
                    if cell_report('csv',la,lo)['accepted']: pts.append((la,lo))
                return self.send_data(200,{'stations':stations_near(pts)})
            if path=='/api/health':return self.send_data(200,{'status':'ok','version':VERSION,'data_dir':str(DATA)})
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
               'geojson':'application/geo+json; charset=utf-8','png':'image/png','svg':'image/svg+xml',
               'woff2':'font/woff2','ttf':'font/ttf','ico':'image/x-icon','md':'text/plain; charset=utf-8'}
            return self.send_data(200,file.read_bytes(),m.get(file.suffix[1:],'application/octet-stream'))
        except (ValueError,RuntimeError) as e:
            return self.send_data(400,{'error':str(e)})
        except Exception as e:
            return self.send_data(500,{'error':str(e)})
    def do_POST(self):
        try:
            if self.path not in ('/api/start','/api/validate','/api/inspect_csv'):return self.send_data(404,{'error':'Ruta desconocida'})
            length=int(self.headers.get('Content-Length',0))
            if length<1 or length>80_000_000:raise ValueError('Cuerpo vacío o demasiado grande.')
            args=json.loads(self.rfile.read(length).decode('utf-8'))
            if self.path=='/api/inspect_csv':return self.send_data(200,inspect_csv(args.get('content','')))
            jid=start_validation_job(args) if self.path=='/api/validate' else start_job(args)
            return self.send_data(202,{'job_id':jid})
        except (ValueError,KeyError,TypeError) as e:
            return self.send_data(400,{'error':str(e)})
        except Exception as e:return self.send_data(500,{'error':str(e)})


_BACKGROUND_SERVER=None

def start_spyder(port=8768):
    """Spyder F5 puede ejecutarse múltiples veces sin bloquear la consola."""
    global _BACKGROUND_SERVER
    import webbrowser
    url=f'http://127.0.0.1:{port}'
    # Si otra ejecución de esta app está activa, simplemente reabre la web.
    try:
        with urllib.request.urlopen(url+'/api/health',timeout=1.5) as r:
            data=json.loads(r.read())
        if data.get('status')=='ok' and data.get('version')==VERSION:
            print('El visor ya se encuentra abierto:',url,flush=True)
            webbrowser.open(url)
            return url
    except Exception:
        pass
    _BACKGROUND_SERVER=ThreadingHTTPServer(('127.0.0.1',port),Handler)
    DATA.mkdir(parents=True,exist_ok=True)
    threading.Thread(target=_BACKGROUND_SERVER.serve_forever,daemon=True,name='VISOR NASA CA').start()
    print('Servidor web activo en',url,flush=True)
    print('Resultados reales:',DATA,flush=True)
    print('La consola IPython queda disponible. Para apagar el visor, reinicie el núcleo de Spyder.',flush=True)
    webbrowser.open(url)
    return url


def serve(port=8768,open_browser=True):
    import webbrowser
    server=ThreadingHTTPServer(('127.0.0.1',port),Handler)
    DATA.mkdir(parents=True,exist_ok=True)
    url=f'http://127.0.0.1:{port}'
    print('Visor de precipitación Centroamérica',url,flush=True)
    print('Archivos reales se guardan en:',DATA,flush=True)
    print('Para detener el servidor: Ctrl+C en la consola IPython.',flush=True)
    if open_browser: threading.Timer(0.7,lambda:webbrowser.open(url)).start()
    try:server.serve_forever(poll_interval=.2)
    except KeyboardInterrupt:print('Servidor detenido.')
    finally:server.server_close()
