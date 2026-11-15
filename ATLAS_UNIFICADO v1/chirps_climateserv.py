# -*- coding: utf-8 -*-
"""CHIRPS diario por descarga automática desde ClimateSERV (NASA/USAID SERVIR).

ClimateSERV es un servicio público (sin cuenta) que devuelve series diarias de
CHIRPS promediadas sobre un polígono. Se pide la celda CHIRPS de 0,05° que
contiene el punto, de modo que el valor equivale al de esa celda.

Flujo de la API: submitDataRequest → id; getDataRequestProgress (0–100);
getDataFromRequest → {"data":[{"date":"MM/DD/YYYY","value":{"avg":mm}}...]}.
Se descarga por años y se guarda cada año en caché JSON.
"""
from __future__ import annotations
import json
import math
import time
import urllib.parse
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date
from pathlib import Path

API = 'https://climateserv.servirglobal.net/api/'
DATATYPE_CHIRPS = 0          # CHIRPS diario (v2.0) en el catálogo de ClimateSERV
OPERATION_AVG = 5            # promedio espacial sobre el polígono
CELL = 0.05                  # resolución nativa de CHIRPS
UA = 'LluviaCA-Atlas/6.3 (precipitation research; desktop)'
MAX_DAILY_MM = 1000.0


def _get(url, timeout=60):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/json'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        if not r.geturl().startswith(API):
            raise RuntimeError('ClimateSERV redirigió a otra dirección.')
        return json.loads(r.read().decode('utf-8-sig'))


def cell_polygon(lat, lon):
    """Polígono GeoJSON de la celda CHIRPS de 0,05° que contiene el punto."""
    i = math.floor((lat + 50.0) / CELL)
    j = math.floor((lon + 180.0) / CELL)
    s = -50.0 + i * CELL
    w = -180.0 + j * CELL
    # Margen interior mínimo para no tocar celdas vecinas.
    e = 1e-4
    ring = [[w + e, s + e], [w + CELL - e, s + e], [w + CELL - e, s + CELL - e], [w + e, s + CELL - e], [w + e, s + e]]
    return {'type': 'Polygon', 'coordinates': [[[round(x, 5), round(y, 5)] for x, y in ring]]}, (round(s + CELL / 2, 4), round(w + CELL / 2, 4))


def _request_year(poly, year, progress=None, poll=2.0, max_wait=240):
    last = date(year, 12, 31)
    if last > date.today():
        last = date.today()
    params = {'datatype': DATATYPE_CHIRPS, 'begintime': f'01/01/{year}', 'endtime': last.strftime('%m/%d/%Y'),
              'intervaltype': 0, 'operationtype': OPERATION_AVG, 'dateType_Category': 'default',
              'isZip_CurrentDataType': 'false', 'geometry': json.dumps(poly, separators=(',', ':'))}
    sub = API + 'submitDataRequest/?' + urllib.parse.urlencode(params)
    rid = _get(sub)
    rid = rid[0] if isinstance(rid, list) else rid
    if not isinstance(rid, str) or len(rid) < 8:
        raise RuntimeError('ClimateSERV no devolvió un identificador de solicitud.')
    t0 = time.time()
    while True:
        p = _get(API + 'getDataRequestProgress/?id=' + urllib.parse.quote(rid))
        p = p[0] if isinstance(p, list) else p
        if float(p) >= 100:
            break
        if float(p) < 0:
            raise RuntimeError('ClimateSERV informó un error al procesar la solicitud.')
        if time.time() - t0 > max_wait:
            raise RuntimeError('ClimateSERV tardó demasiado en responder.')
        time.sleep(poll)
    data = _get(API + 'getDataFromRequest/?id=' + urllib.parse.quote(rid), timeout=120)
    return data, sub


def parse_rows(payload):
    """{"data":[...]} → {fecha ISO: mm o None}. Valores negativos/no finitos = faltante."""
    out = {}
    for row in (payload or {}).get('data', []):
        try:
            m, d, y = (int(x) for x in str(row.get('date', '')).split('/'))
            day = date(y, m, d).isoformat()
        except (ValueError, TypeError):
            continue
        v = (row.get('value') or {}).get('avg', row.get('raw_value'))
        try:
            v = float(v)
        except (TypeError, ValueError):
            v = None
        if v is None or not math.isfinite(v) or v < 0 or v > MAX_DAILY_MM:
            v = None
        out[day] = v
    return out


def _year_with_retry(poly, year, attempts=4):
    """Una solicitud anual; reintenta ante 429/503 (límite de uso del servicio)."""
    err = None
    for k in range(attempts):
        try:
            return _request_year(poly, year)
        except urllib.error.HTTPError as e:
            err = e
            if e.code not in (429, 500, 502, 503, 504):
                break
        except (OSError, ValueError, RuntimeError) as e:
            err = e
        time.sleep(4 * (k + 1))
    raise RuntimeError(f'ClimateSERV no entregó CHIRPS {year}: {err}')


def get_chirps(lat, lon, y0, y1, cache_dir, progress=None, workers=3):
    """Serie diaria CHIRPS (mm/día) para la celda que contiene el punto.

    ClimateSERV procesa un año por solicitud (~15–30 s; varios años juntos
    fallan). Se piden 3 años a la vez (más provoca 503) y cada año cerrado se
    guarda en caché, de modo que la segunda consulta es inmediata.
    """
    poly, center = cell_polygon(float(lat), float(lon))
    cache = Path(cache_dir)
    cache.mkdir(parents=True, exist_ok=True)
    data, urls, pending = {}, {}, []
    for year in range(int(y0), int(y1) + 1):
        target = cache / f'chirps_{center[0]:.4f}_{center[1]:.4f}_{year}.json'
        if target.exists():
            payload = json.loads(target.read_text('utf-8'))
            data.update(payload['rows']); urls[year] = payload['url']
        else:
            pending.append((year, target))
    if pending and progress:
        progress(f'CHIRPS (ClimateSERV): {len(pending)} años por descargar, 3 a la vez; '
                 f'≈ {max(1, round(len(pending) * 25 / 3 / 60))} min la primera vez.')
    done = 0
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futures = {ex.submit(_year_with_retry, poly, y): (y, t) for y, t in pending}
        for fut in as_completed(futures):
            year, target = futures[fut]
            raw, url = fut.result()
            rows = parse_rows(raw)
            if not any(v is not None for v in rows.values()):
                raise RuntimeError(f'ClimateSERV no devolvió datos CHIRPS para {year}.')
            if date(year, 12, 31) < date.today():
                target.write_text(json.dumps({'rows': rows, 'url': url}, ensure_ascii=False), encoding='utf-8')
            data.update(rows); urls[year] = url; done += 1
            if progress:
                progress(f'CHIRPS: {done}/{len(pending)} años descargados (último: {year}).')
    meta = {'product': 'CHIRPS v2.0 diario (ClimateSERV, celda 0,05°)', 'input_unit': 'mm', 'output_unit': 'mm/día',
            'temporal': 'daily', 'day_definition': 'Día natural de CHIRPS', 'counts': {}, 'issues': [],
            'cell_center': {'lat': center[0], 'lon': center[1]},
            'note': 'CHIRPS combina satélite infrarrojo con estaciones; no es independiente de las estaciones que use.'}
    return data, meta, [urls[y] for y in sorted(urls)]
