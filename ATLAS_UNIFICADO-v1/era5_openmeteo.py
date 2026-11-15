# -*- coding: utf-8 -*-
"""ERA5 (Copernicus/ECMWF) diario por punto mediante la API histórica de Open-Meteo.

ERA5 es el reanálisis de Copernicus (modelo + observaciones), independiente de
los productos de la NASA. Open-Meteo lo sirve sin clave para uso no comercial
(licencia CC-BY 4.0; límites ≈ 600 consultas/min y 10 000/día). Se pide la
precipitación diaria (precipitation_sum, mm) con días UTC, igual que NASA POWER.

ERA5 usa una malla de 0,25° (≈ 28 km): Open-Meteo devuelve la celda más cercana.
Una sola consulta trae todo el período; cada año cerrado se guarda en caché.
"""
from __future__ import annotations
import json
import math
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, timedelta
from pathlib import Path

API = 'https://archive-api.open-meteo.com/v1/archive'
UA = 'LluviaCA-Atlas/6.3 (precipitation research; desktop)'
CELL = 0.25
LATENCY_DAYS = 6          # ERA5 se publica con unos 5 días de retraso
MAX_DAILY_MM = 1000.0


def grid_point(lat, lon):
    """Nodo ERA5 de 0,25° más cercano (el que usa Open-Meteo)."""
    return round(round(lat / CELL) * CELL, 2), round(round(lon / CELL) * CELL, 2)


def _get(url, attempts=4, timeout=120):
    err = None
    for k in range(attempts):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/json'})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                if not r.geturl().startswith(API):
                    raise RuntimeError('Open-Meteo redirigió a otra dirección.')
                return json.loads(r.read().decode('utf-8'))
        except urllib.error.HTTPError as e:
            msg = e.read(600).decode('utf-8', 'replace')
            err = RuntimeError(f'Open-Meteo HTTP {e.code}: {msg}')
            if e.code not in (429, 500, 502, 503, 504):
                break
        except (OSError, ValueError) as e:
            err = e
        time.sleep(3 * (k + 1))
    raise RuntimeError(f'Open-Meteo no entregó ERA5: {err}')


def parse_daily(payload):
    """Respuesta de Open-Meteo → {fecha ISO: mm o None}."""
    daily = (payload or {}).get('daily') or {}
    unit = str(((payload or {}).get('daily_units') or {}).get('precipitation_sum', 'mm')).strip()
    if unit and unit != 'mm':
        raise RuntimeError(f'Unidad inesperada en Open-Meteo: {unit}. No se aplicó conversión.')
    out = {}
    for d, v in zip(daily.get('time', []), daily.get('precipitation_sum', [])):
        try:
            day = date.fromisoformat(str(d)[:10]).isoformat()
        except ValueError:
            continue
        try:
            v = float(v)
        except (TypeError, ValueError):
            v = None
        if v is None or not math.isfinite(v) or v < 0 or v > MAX_DAILY_MM:
            v = None
        out[day] = v
    return out


def get_era5(lat, lon, y0, y1, cache_dir, progress=None):
    """Serie diaria ERA5 (mm/día, día UTC) para la celda de 0,25° más cercana."""
    glat, glon = grid_point(float(lat), float(lon))
    cache = Path(cache_dir)
    cache.mkdir(parents=True, exist_ok=True)
    data, missing = {}, []
    for year in range(int(y0), int(y1) + 1):
        target = cache / f'era5_{glat:.2f}_{glon:.2f}_{year}.json'
        if target.exists():
            data.update(json.loads(target.read_text('utf-8')))
        else:
            missing.append(year)
    params = {'latitude': f'{glat:.2f}', 'longitude': f'{glon:.2f}', 'daily': 'precipitation_sum',
              'models': 'era5', 'timezone': 'UTC'}
    url = API + '?' + urllib.parse.urlencode({**params, 'start_date': f'{y0}-01-01', 'end_date': f'{y1}-12-31'})
    if missing:
        last_ok = date.today() - timedelta(days=LATENCY_DAYS)
        start, end = date(missing[0], 1, 1), min(date(missing[-1], 12, 31), last_ok)
        if start > end:
            raise RuntimeError('ERA5 todavía no tiene datos para el período pedido.')
        url = API + '?' + urllib.parse.urlencode({**params, 'start_date': start.isoformat(), 'end_date': end.isoformat()})
        if progress:
            progress(f'Descargando ERA5 (Open-Meteo) {start.year}–{end.year} · celda {glat:.2f}, {glon:.2f}')
        rows = parse_daily(_get(url))
        if not any(v is not None for v in rows.values()):
            raise RuntimeError('Open-Meteo no devolvió precipitación ERA5 para este punto.')
        for year in missing:
            yr = {k: v for k, v in rows.items() if k.startswith(f'{year}-')}
            if date(year, 12, 31) <= last_ok and len(yr) >= 365:
                (cache / f'era5_{glat:.2f}_{glon:.2f}_{year}.json').write_text(json.dumps(yr), encoding='utf-8')
            data.update(yr)
    meta = {'product': 'ERA5 diario (Copernicus/ECMWF) vía Open-Meteo, celda 0,25°', 'input_unit': 'mm',
            'output_unit': 'mm/día', 'temporal': 'daily', 'day_definition': 'UTC', 'counts': {}, 'issues': [],
            'cell_center': {'lat': glat, 'lon': glon},
            'note': 'Reanálisis (modelo + observaciones) de Copernicus, independiente de la NASA. Datos: Open-Meteo, CC-BY 4.0.'}
    return data, meta, [url]
