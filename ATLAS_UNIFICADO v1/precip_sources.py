"""Acceso NOAA GHCN-Daily y catálogo de recursos documentados."""
from __future__ import annotations
import calendar
import hashlib
import math
import re
import time
import urllib.request
from collections import Counter
from datetime import datetime, timezone, date
from pathlib import Path
from precip_tools import noaa_measurement_issue

BASE='https://www.ncei.noaa.gov/pub/data/ghcn/daily/'
RESOURCES=[
 {'name':'NASA POWER · IMERG / MERRA-2','kind':'Descarga por coordenadas','url':'https://power.larc.nasa.gov/docs/methodology/data/sources_meteorology/',
  'text':'Precipitación diaria en mm para Centroamérica. IMERG es satelital y MERRA-2 es reanálisis. Conserva versiones y usa períodos cerrados para tendencias.'},
 {'name':'Giovanni · GPM IMERG','kind':'Importación CSV (requiere cuenta Earthdata)','url':'https://giovanni.gsfc.nasa.gov/giovanni/',
  'text':'Exporta precipitación diaria de IMERG, TRMM o GLDAS con cobertura en Centroamérica. Declara producto, unidades y si es punto o promedio de área.'},
 {'name':'Hydrology Time Series · GLDAS','kind':'Importación CSV (requiere cuenta Earthdata)','url':'https://disc.gsfc.nasa.gov/information/tools?title=Hydrology%20Time%20Series',
  'text':'Usa GLDAS con cobertura global terrestre y una variable de precipitación. Las tasas subdiarias se integran en mm solo con todos los intervalos del día. NLDAS no cubre Centroamérica.'},
 {'name':'ERA5 · Copernicus vía Open-Meteo','kind':'Descarga automática por coordenadas','url':'https://open-meteo.com/en/docs/historical-weather-api',
  'text':'Reanálisis ERA5 de Copernicus/ECMWF desde 1940, celda de 0,25°, precipitación diaria en día UTC. Servicio sin clave para uso no comercial; datos con licencia CC-BY 4.0.'},
 {'name':'CHIRPS · ClimateSERV','kind':'Descarga automática por coordenadas','url':'https://climateserv.servirglobal.net/',
  'text':'CHIRPS v2.0 diario para la celda de 0,05° que contiene el punto, desde 1981, mediante el servicio público ClimateSERV (NASA/SERVIR). Sin cuenta.'},
 {'name':'CHIRPS · Centroamérica','kind':'Importación CSV diario','url':'https://www.chc.ucsb.edu/data/chirps3',
  'text':'Precipitación terrestre desde 1981. Declara versión y variante diaria (v3 sat o rnl). Su desagregación y el uso de estaciones afectan la independencia de las comparaciones.'},
 {'name':'NOAA CDO / GHCN-Daily','kind':'Descarga de estaciones regionales','url':'https://www.ncei.noaa.gov/cdo-web/',
  'text':'Busca estaciones de Guatemala, Belice, El Salvador, Honduras, Nicaragua, Costa Rica y Panamá. Se comprueba disponibilidad de PRCP y sus banderas de calidad.'}
]
CENTRAL_AMERICA_CODES={'GT','BH','ES','HO','NU','CS','PM'}


def fetch_text(url,cache_path,max_age=86400):
    path=Path(cache_path);path.parent.mkdir(parents=True,exist_ok=True)
    if path.exists() and time.time()-path.stat().st_mtime<max_age:
        raw=path.read_bytes()
    else:
        req=urllib.request.Request(url,headers={'User-Agent':'LluviaCA/6.0 (precipitation research)'})
        try:
            with urllib.request.urlopen(req,timeout=90) as resp:raw=resp.read(60_000_001)
        except Exception as exc:raise RuntimeError('NOAA no disponible: '+str(exc)) from exc
        if len(raw)>60_000_000:raise RuntimeError('Respuesta NOAA demasiado grande.')
        if raw.lstrip().startswith(b'<'):raise RuntimeError('NOAA devolvió una página en lugar de datos.')
        path.write_bytes(raw)
    return raw.decode('utf-8','replace'),{'url':url,'raw_sha256':hashlib.sha256(raw).hexdigest(),
          'downloaded_at_utc':datetime.fromtimestamp(path.stat().st_mtime,timezone.utc).isoformat()}

def distance_km(lat1,lon1,lat2,lon2):
    p1,p2=map(math.radians,(lat1,lat2));dp=p2-p1;dl=math.radians(lon2-lon1)
    return 6371*2*math.asin(min(1,math.sqrt(math.sin(dp/2)**2+math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2)))

def stations(cache):
    text,_=fetch_text(BASE+'ghcnd-stations.txt',Path(cache)/'ghcnd-stations.txt',86400*7)
    results=[]
    for line in text.splitlines():
        try:results.append({'id':line[:11],'lat':float(line[12:20]),'lon':float(line[21:30]),'name':line[41:71].strip()})
        except (ValueError,IndexError):continue
    if not results:raise RuntimeError('El catálogo NOAA no contiene estaciones legibles.')
    return results

def prcp_inventory(cache):
    """{id: (primer año, último año)} de PRCP según ghcnd-inventory.txt (solo Centroamérica)."""
    text,_=fetch_text(BASE+'ghcnd-inventory.txt',Path(cache)/'ghcnd-inventory.txt',86400*7)
    inv={}
    for line in text.splitlines():
        if line[:2] in CENTRAL_AMERICA_CODES and line[31:35]=='PRCP':
            try:inv[line[:11]]=(int(line[36:40]),int(line[41:45]))
            except ValueError:continue
    return inv

def nearby_stations(lat,lon,cache,y0=None,y1=None):
    """Estaciones a ≤ 300 km con PRCP: primero las que cubren ≥ 80 % del período, luego parciales y al final sin datos; dentro de cada grupo, por distancia."""
    if not(-90<=lat<=90 and -180<=lon<=180):raise ValueError('Coordenadas inválidas.')
    try:inv=prcp_inventory(cache)
    except RuntimeError:inv=None
    found=[]
    for s in stations(cache):
        if s['id'][:2] not in CENTRAL_AMERICA_CODES:continue
        distance=distance_km(lat,lon,s['lat'],s['lon'])
        if distance>300:continue
        rec={**s,'distance_km':round(distance,1)}
        if inv is not None:
            if s['id'] not in inv:continue          # sin PRCP: no sirve para lluvia
            a,b=inv[s['id']];rec['prcp_first_year']=a;rec['prcp_last_year']=b
            if y0 is not None and y1 is not None:
                rec['overlap_years']=max(0,min(b,y1)-max(a,y0)+1)
        found.append(rec)
    if inv is not None and y0 is not None and y1 is not None:
        need=0.8*(y1-y0+1)
        found.sort(key=lambda r:(0 if r['overlap_years']>=need else 1 if r['overlap_years']>0 else 2,r['distance_km']))
    else:found.sort(key=lambda r:r['distance_km'])
    return found[:25]

def parse_dly(text,station,y0,y1):
    data={};counts=Counter();issues=[]
    for line in text.splitlines():
        if line[:11]!=station or line[17:21]!='PRCP':continue
        try:
            year=int(line[11:15]);month=int(line[15:17])
            ndays=calendar.monthrange(year,month)[1]
        except ValueError:continue
        if not y0<=year<=y1:continue
        for day in range(1,ndays+1):
            pos=21+(day-1)*8;chunk=line[pos:pos+8];stamp=date(year,month,day).isoformat()
            counts['rows']+=1;value=None
            try:raw=int(chunk[:5]);mf=chunk[5:6];qf=chunk[6:7]
            except ValueError:raw=-9999;mf='';qf=''
            if raw==-9999:counts['missing_values']+=1
            elif qf.strip() or noaa_measurement_issue(mf):
                reason='bandera_calidad' if qf.strip() else noaa_measurement_issue(mf)
                counts[reason]+=1
                issues.append({'fecha':stamp,'valor':raw,'motivo':'NOAA_QFLAG_'+qf.strip() if qf.strip() else reason})
            elif raw<0:counts['negativo']+=1
            else:
                value=raw/10
                if mf=='T':value=0.0;counts['trace_as_zero']+=1
            if stamp in data and data[stamp]!=value:
                data[stamp]=None;counts['duplicates_conflicting']+=1
            else:data[stamp]=value
    if not data:raise RuntimeError('La estación NOAA no tiene registros PRCP en el período solicitado.')
    return data,{'counts':dict(counts),'issues':issues,'input_unit':'décimas de mm','output_unit':'mm/día',
                 'conversion_factor_per_record':0.1,'product':'GHCN-Daily PRCP','temporal':'daily',
                 'day_definition':'Día de observación de la estación; verificar hora de cierre.',
                 'station_id':station}

def get_noaa(station,y0,y1,cache):
    station=str(station).strip().upper()
    if station[:2] not in CENTRAL_AMERICA_CODES:raise ValueError('Selecciona una estación GHCN de Centroamérica.')
    if not re.fullmatch('[A-Z0-9]{11}',station):raise ValueError('El identificador GHCN debe contener 11 letras/números.')
    meta=next((s for s in stations(cache) if s['id']==station),None)
    if meta is None:raise ValueError('Estación no encontrada en el catálogo oficial GHCN.')
    text,provenance=fetch_text(BASE+'all/'+station+'.dly',Path(cache)/(station+'.dly'))
    try:data,audit=parse_dly(text,station,y0,y1)
    except RuntimeError:
        years=sorted({int(l[11:15]) for l in text.splitlines() if l[:11]==station and l[17:21]=='PRCP' and l[11:15].isdigit()})
        span=f'{years[0]}–{years[-1]}' if years else 'ningún año'
        raise RuntimeError(f'La estación {meta["name"]} ({station}) no tiene lluvia (PRCP) en {y0}–{y1}: '
                           f'solo hay registros en {span}. Elige otra estación o cambia el período.') from None
    audit.update(provenance);audit['station']=meta
    return data,audit,[provenance['url']]
