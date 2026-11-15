# -*- coding: utf-8 -*-
"""v6.2 · VALIDACIÓN: satélite / reanálisis de NASA frente a estaciones de Costa Rica.

PREGUNTA QUE RESPONDE
---------------------
¿Se parece la lluvia que estima el satélite (IMERG) o el reanálisis (MERRA-2)
en una celda a la que midió un pluviómetro dentro de esa celda?

FUENTES DE ESTACIÓN (libres y verificables)
-------------------------------------------
1. NOAA NCEI · GHCN-Daily (descarga automática). Contiene las estaciones
   sinópticas de Costa Rica (red del IMN) que se intercambian por la OMM:
   Juan Santamaría, Limón, Liberia, Puntarenas, Palmar Sur y Fabio Baudrit.
   Se consulta el servicio oficial «Access Data Service» de NCEI, sin clave.
   En Costa Rica estas series provienen del resumen diario sinóptico (GSOD,
   bandera de fuente «S»): tienen MUCHOS días faltantes. Aquí un faltante
   nunca se convierte en cero: solo se comparan días con dato en ambas
   fuentes («días pareados»).
2. CSV de estación aportado por el usuario: por ejemplo, datos diarios que el
   Instituto Meteorológico Nacional (IMN) entrega bajo solicitud, o estaciones
   del ICE, universidades o redes propias. Columnas: fecha, precipitacion_mm.

CÓMO SE COMPARA (y por qué cada métrica)
----------------------------------------
* Continuas (días pareados): sesgo medio y relativo (PBIAS), MAE, RMSE,
  correlación de Pearson y de Spearman (esta última no la dominan unos pocos
  días enormes) y KGE (Kling-Gupta 2012), que resume correlación, sesgo y
  variabilidad en un solo número (1 = perfecto; > −0,41 mejora a la media).
* Categóricas (¿llovió o no?, y ¿superó X mm?): POD (probabilidad de
  detección), FAR (falsas alarmas), CSI (índice de éxito crítico), sesgo de
  frecuencia (FBI) y Heidke (HSS). Se evalúan a 1, 5, 10, 20 y 50 mm/día.
* Desfase de días: el día de IMERG en NASA POWER es UTC y el de cada
  estación puede ser local o terminar a una hora fija. Se calcula la
  correlación desplazando el satélite −2…+2 días: si el máximo no está en 0,
  hay un desfase de definición del día, no un error del satélite.
* Extremos: de los días en que la estación superó su P95, ¿cuántos detectó
  el satélite sobre su propio P95?, y ¿qué fracción del pico estimó?
* Mensual pareado: suma de los mismos días pareados en ambas fuentes (meses
  con ≥ 10 días pareados): elimina el ruido diario y muestra el sesgo estacional.
* Diagrama de Taylor: correlación, razón de desviaciones típicas y error
  cuadrático centrado en una sola figura para todas las estaciones.

LÍMITE FÍSICO QUE HAY QUE TENER PRESENTE
----------------------------------------
Un pluviómetro mide ~0,03 m²; una celda IMERG ≈ 122 km². La celda promedia
la lluvia de un área enorme: en lluvia convectiva tropical es NORMAL que el
satélite subestime los picos y sobrestime los días de llovizna. Una
discrepancia no prueba por sí sola que el satélite «está mal»: mide otra cosa.

Solo biblioteca estándar (Spyder sin paquetes extra).
"""
from __future__ import annotations

import csv
import io
import json
import math
import re
import statistics
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, timedelta
from pathlib import Path

NCEI_URL = 'https://www.ncei.noaa.gov/access/services/data/v1'
GHCN_DOC = 'https://www.ncei.noaa.gov/products/land-based-station/global-historical-climatology-network-daily'
MAX_BYTES = 15_000_000
MAX_DAILY_MM = 1000.0          # por encima: valor físicamente dudoso, se descarta y se cuenta

# Lista blanca. La web NUNCA puede pedir un identificador que no esté aquí:
# así el servidor no se convierte en un proxy hacia cualquier dirección.
# Metadatos tomados de ghcnd-stations.txt / ghcnd-inventory.txt de NOAA (2026).
STATIONS = {
    'CSM00078762': {'name': 'Aeropuerto Juan Santamaría (Alajuela)', 'lat': 9.9940, 'lon': -84.2090, 'elev_m': 920.8,
                    'wmo': '78762', 'first': 1973, 'last': 2025},
    'CS000081003': {'name': 'Puerto Limón', 'lat': 9.9670, 'lon': -83.0170, 'elev_m': 3.0,
                    'wmo': '78767', 'first': 1977, 'last': 2025},
    'CS000078774': {'name': 'Liberia (Aeropuerto D. Oduber)', 'lat': 10.6000, 'lon': -85.5330, 'elev_m': 80.0,
                    'wmo': '78774', 'first': 1979, 'last': 2025},
    'CSM00078760': {'name': 'Puntarenas', 'lat': 9.9670, 'lon': -84.8330, 'elev_m': 3.0,
                    'wmo': '78760', 'first': 1976, 'last': 2007},
    'CS000098002': {'name': 'Palmar Sur', 'lat': 8.9500, 'lon': -83.4670, 'elev_m': 15.0,
                    'wmo': '78772', 'first': 1979, 'last': 1992},
    'CS000084023': {'name': 'Fabio Baudrit (Alajuela)', 'lat': 10.0100, 'lon': -84.2600, 'elev_m': 840.0,
                    'wmo': '', 'first': 1979, 'last': 1991},
}
STATION_RE = re.compile(r'^CS[0-9A-Z]{9}$')
CATEGORICAL_MM = (1, 5, 10, 20, 50)
LAGS = (-2, -1, 0, 1, 2)


def station_catalog():
    out = []
    for sid, m in STATIONS.items():
        out.append({'id': sid, **m, 'network': 'GHCN-Daily (NOAA NCEI) · red sinóptica de Costa Rica',
                    'doc': GHCN_DOC})
    return out


# -----------------------------------------------------------------------------
# Descarga segura y con caché
# -----------------------------------------------------------------------------
def _finite_mm(v):
    try:
        f = float(str(v).strip().replace(',', '.'))
    except (TypeError, ValueError):
        return None
    if not math.isfinite(f) or f < 0:
        return None
    return f


def parse_ghcn_csv(text):
    """CSV de NCEI (format=csv, includeAttributes=true) → {fecha ISO: mm}.

    Se descartan: valores vacíos (faltante, NO cero), con bandera de calidad
    (QFLAG ≠ vacío: NOAA lo marcó como sospechoso) y > 1000 mm/día.
    """
    reader = csv.DictReader(io.StringIO(text.lstrip('﻿')))
    data, flagged, implausible = {}, 0, 0
    for row in reader:
        d = str(row.get('DATE', '')).strip()[:10]
        try:
            date.fromisoformat(d)
        except ValueError:
            continue
        raw = row.get('PRCP')
        if raw is None or str(raw).strip() == '':
            continue
        attrs = str(row.get('PRCP_ATTRIBUTES', '') or '').split(',')
        qflag = attrs[1].strip() if len(attrs) > 1 else ''
        v = _finite_mm(raw)
        if v is None:
            continue
        if qflag:
            flagged += 1
            continue
        if v > MAX_DAILY_MM:
            implausible += 1
            continue
        data[d] = v
    return data, {'descartados_bandera_calidad': flagged, 'descartados_inverosimiles': implausible}


def fetch_ghcn(station_id, y0, y1, cache_dir, progress=None, timeout=90):
    """Descarga PRCP diaria de una estación GHCN-Daily (lista blanca) con caché local."""
    if station_id not in STATIONS or not STATION_RE.match(station_id):
        raise ValueError('Estación no permitida.')
    y0, y1 = int(y0), int(y1)
    if not (1950 <= y0 <= y1 <= date.today().year):
        raise ValueError('Años de estación inválidos.')
    cache_dir = Path(cache_dir)
    cache_dir.mkdir(parents=True, exist_ok=True)
    target = cache_dir / f'ghcn_{station_id}_{y0}_{y1}.json'
    params = {'dataset': 'daily-summaries', 'stations': station_id, 'startDate': f'{y0}-01-01',
              'endDate': f'{y1}-12-31', 'dataTypes': 'PRCP', 'format': 'csv', 'units': 'metric',
              'includeAttributes': 'true'}
    url = NCEI_URL + '?' + urllib.parse.urlencode(params)
    if target.exists():
        payload = json.loads(target.read_text('utf-8'))
        return payload['data'], payload['qc'], payload['url']
    if progress:
        progress(f'Descargando estación {STATIONS[station_id]["name"]} (NOAA GHCN-Daily) {y0}–{y1}')
    req = urllib.request.Request(url, headers={'User-Agent': 'Lluvia-CR-Visor/6.2 (investigacion)',
                                               'Accept': 'text/csv'})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            if not r.geturl().startswith('https://www.ncei.noaa.gov/'):
                raise RuntimeError('Redirección inesperada fuera de NOAA NCEI.')
            raw = r.read(MAX_BYTES + 1)
    except urllib.error.HTTPError as e:
        raise RuntimeError(f'NOAA NCEI HTTP {e.code}') from None
    except OSError as e:
        raise RuntimeError(f'No se pudo conectar con NOAA NCEI: {e}') from None
    if len(raw) > MAX_BYTES:
        raise RuntimeError('Respuesta de NOAA demasiado grande.')
    text = raw.decode('utf-8', 'replace')
    if not text.lstrip('﻿').startswith('"STATION"'):
        raise RuntimeError('NOAA NCEI no devolvió el CSV esperado.')
    data, qc = parse_ghcn_csv(text)
    target.write_text(json.dumps({'data': data, 'qc': qc, 'url': url}, ensure_ascii=False), encoding='utf-8')
    return data, qc, url


# -----------------------------------------------------------------------------
# Métricas
# -----------------------------------------------------------------------------
def _rank(values):
    order = sorted(range(len(values)), key=lambda i: values[i])
    ranks = [0.0] * len(values)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and values[order[j + 1]] == values[order[i]]:
            j += 1
        for k in range(i, j + 1):
            ranks[order[k]] = (i + j) / 2 + 1
        i = j + 1
    return ranks


def _pearson(x, y):
    n = len(x)
    if n < 3:
        return None
    mx, my = sum(x) / n, sum(y) / n
    dx = [a - mx for a in x]
    dy = [b - my for b in y]
    den = math.sqrt(sum(a * a for a in dx) * sum(b * b for b in dy))
    return sum(a * b for a, b in zip(dx, dy)) / den if den else None


def _q(vals, p):
    v = sorted(vals)
    if not v:
        return None
    k = (len(v) - 1) * p / 100
    lo, hi = int(math.floor(k)), int(math.ceil(k))
    return v[lo] + (v[hi] - v[lo]) * (k - lo)


def _r(v, n=3):
    return None if v is None or not math.isfinite(v) else round(v, n)


def continuous_metrics(sat, obs):
    n = len(sat)
    if n < 30:
        return {'n': n}
    ms, mo = statistics.mean(sat), statistics.mean(obs)
    ss, so = statistics.pstdev(sat), statistics.pstdev(obs)
    r = _pearson(sat, obs)
    rho = _pearson(_rank(sat), _rank(obs))
    diff = [a - b for a, b in zip(sat, obs)]
    beta = ms / mo if mo > 0 else None
    gamma = (ss / ms) / (so / mo) if ms > 0 and mo > 0 and so > 0 else None
    kge = (1 - math.sqrt((r - 1) ** 2 + (beta - 1) ** 2 + (gamma - 1) ** 2)
           if r is not None and beta is not None and gamma is not None else None)
    # Recta de mínimos cuadrados satélite = a + b·estación (solo descriptiva)
    b = (sum((o - mo) * (s - ms) for s, o in zip(sat, obs)) / sum((o - mo) ** 2 for o in obs)
         if so > 0 else None)
    a = ms - b * mo if b is not None else None
    crmsd = math.sqrt(sum(((s - ms) - (o - mo)) ** 2 for s, o in zip(sat, obs)) / n)
    return {'n': n, 'media_sat': _r(ms), 'media_est': _r(mo), 'sesgo_mm_dia': _r(ms - mo),
            'pbias_pct': _r(100 * (ms - mo) / mo, 1) if mo > 0 else None,
            'mae': _r(sum(abs(d) for d in diff) / n), 'rmse': _r(math.sqrt(sum(d * d for d in diff) / n)),
            'pearson_r': _r(r), 'spearman_rho': _r(rho), 'kge': _r(kge), 'kge_r': _r(r), 'kge_beta': _r(beta),
            'kge_gamma': _r(gamma), 'ols_a': _r(a), 'ols_b': _r(b),
            'sd_sat': _r(ss), 'sd_est': _r(so), 'sd_ratio': _r(ss / so) if so > 0 else None,
            'crmsd_norm': _r(crmsd / so) if so > 0 else None}


def categorical_metrics(sat, obs, thr):
    h = sum(1 for s, o in zip(sat, obs) if s >= thr and o >= thr)
    m = sum(1 for s, o in zip(sat, obs) if s < thr and o >= thr)
    f = sum(1 for s, o in zip(sat, obs) if s >= thr and o < thr)
    c = len(sat) - h - m - f
    n = len(sat)
    pod = h / (h + m) if h + m else None
    far = f / (h + f) if h + f else None
    csi = h / (h + m + f) if h + m + f else None
    fbi = (h + f) / (h + m) if h + m else None
    exp = ((h + m) * (h + f) + (c + m) * (c + f)) / n if n else 0
    hss = (h + c - exp) / (n - exp) if n and n != exp else None
    return {'umbral_mm': thr, 'aciertos': h, 'fallos': m, 'falsas_alarmas': f, 'negativos_correctos': c,
            'pod': _r(pod), 'far': _r(far), 'csi': _r(csi), 'fbi': _r(fbi), 'hss': _r(hss)}


def lag_correlations(sat_daily, obs_daily):
    """Correlación diaria desplazando el satélite k días (k = −2…+2).

    k = −1 significa: el valor de la estación del día d se parece más al del
    satélite del día d − 1. Es lo esperable cuando la estación anota a la
    mañana la lluvia de las 24 h anteriores (lectura de las 7 h o de las
    12 UTC) y el producto usa el día UTC de 0 a 24 h.
    """
    days = sorted(d for d, v in obs_daily.items() if v is not None)
    lags = []
    for k in LAGS:
        xs, ys = [], []
        for d in days:
            dd = (date.fromisoformat(d) + timedelta(days=k)).isoformat()
            sv = sat_daily.get(dd)
            if sv is not None:
                xs.append(float(sv)); ys.append(float(obs_daily[d]))
        lags.append({'desfase_dias': k, 'r': _r(_pearson(xs, ys)), 'n': len(xs)})
    return lags


def shift_series(sat_daily, k):
    """Satélite desplazado: nuevo[d] = original[d + k]."""
    out = {}
    for d, v in sat_daily.items():
        try:
            dd = (date.fromisoformat(d) - timedelta(days=k)).isoformat()
        except ValueError:
            continue
        out[dd] = v
    return out


def compare_series(sat_daily, obs_daily, wet_min=1.0, align='auto'):
    """Compara satélite y estación en días pareados.

    align='auto': si desplazar el satélite ±1-2 días mejora la correlación en
    ≥ 0,05, TODAS las métricas se calculan con ese desfase («alineado»), y las
    del día de calendario sin desplazar se conservan en «sin_alinear».
    Es un ajuste de DEFINICIÓN DEL DÍA, no una corrección del satélite.
    """
    lags = lag_correlations(sat_daily, obs_daily)
    r0 = next((l['r'] for l in lags if l['desfase_dias'] == 0), None)
    best = max((l for l in lags if l['r'] is not None), key=lambda l: l['r'], default=None)
    shift = 0
    if align == 'auto' and best and best['desfase_dias'] != 0 and r0 is not None and best['r'] - r0 >= 0.05:
        shift = best['desfase_dias']
    out = _compare_core(shift_series(sat_daily, shift) if shift else sat_daily, obs_daily, wet_min)
    out['desfases'] = lags
    out['mejor_desfase'] = best['desfase_dias'] if best else None
    out['desfase_aplicado'] = shift
    if shift and out.get('suficiente'):
        raw = _compare_core(sat_daily, obs_daily, wet_min, light=True)
        out['sin_alinear'] = {k: raw.get(k) for k in ('n_pareados', 'continuas', 'categoricas', 'extremos', 'mensual_r')}
    out['texto'] = reading(out)
    return out


def _compare_core(sat_daily, obs_daily, wet_min=1.0, light=False):
    """Métricas en días pareados (sin desfase: el desfase lo aplica compare_series)."""
    days = sorted(d for d, v in obs_daily.items() if v is not None and sat_daily.get(d) is not None)
    sat = [float(sat_daily[d]) for d in days]
    obs = [float(obs_daily[d]) for d in days]
    out = {'n_pareados': len(days), 'periodo': [days[0], days[-1]] if days else None}
    if len(days) < 60:
        out['texto'] = 'Menos de 60 días pareados: la comparación no es fiable.'
        out['suficiente'] = False
        return out
    out['suficiente'] = True
    out['continuas'] = continuous_metrics(sat, obs)
    out['categoricas'] = [categorical_metrics(sat, obs, t) for t in CATEGORICAL_MM]

    # Mensual pareado (mismos días en ambas fuentes, meses con ≥ 10 días)
    by_m = {}
    for d, s, o in zip(days, sat, obs):
        by_m.setdefault(d[:7], []).append((s, o))
    monthly = [{'mes': k, 'n': len(v), 'sat': round(sum(a for a, _ in v), 2), 'est': round(sum(b for _, b in v), 2)}
               for k, v in sorted(by_m.items()) if len(v) >= 10]
    out['mensual'] = monthly
    if len(monthly) >= 12:
        out['mensual_r'] = _r(_pearson([m['sat'] for m in monthly], [m['est'] for m in monthly]))
        out['mensual_pbias_pct'] = _r(100 * (sum(m['sat'] for m in monthly) - sum(m['est'] for m in monthly))
                                      / max(1e-9, sum(m['est'] for m in monthly)), 1)

    # Sesgo por mes del calendario (ciclo anual del error)
    cal = []
    for mth in range(1, 13):
        pr = [(s, o) for d, s, o in zip(days, sat, obs) if int(d[5:7]) == mth]
        if len(pr) >= 20:
            ms_, mo_ = statistics.mean(a for a, _ in pr), statistics.mean(b for _, b in pr)
            cal.append({'mes': mth, 'n': len(pr), 'media_sat': _r(ms_), 'media_est': _r(mo_),
                        'pbias_pct': _r(100 * (ms_ - mo_) / mo_, 1) if mo_ > 0.05 else None})
        else:
            cal.append({'mes': mth, 'n': len(pr), 'media_sat': None, 'media_est': None, 'pbias_pct': None})
    out['ciclo_sesgo'] = cal

    # Cuantil-cuantil de días lluviosos (cada fuente con sus propios días ≥ umbral)
    ws = [s for s in sat if s >= wet_min]
    wo = [o for o in obs if o >= wet_min]
    qs = (10, 25, 50, 75, 90, 95, 98, 99, 99.5)
    out['qq'] = [{'q': q, 'sat': _r(_q(ws, q), 2), 'est': _r(_q(wo, q), 2)} for q in qs] if len(ws) > 50 and len(wo) > 50 else []

    # Extremos: días en que la estación superó su P95 de días lluviosos
    if len(wo) > 50 and len(ws) > 50:
        p95o, p95s = _q(wo, 95), _q(ws, 95)
        ext = [(s, o) for s, o in zip(sat, obs) if o > p95o]
        det = sum(1 for s, _ in ext if s > p95s)
        ratio = statistics.median(s / o for s, o in ext) if ext else None
        out['extremos'] = {'p95_est_mm': _r(p95o, 1), 'p95_sat_mm': _r(p95s, 1), 'n_dias_extremos_est': len(ext),
                           'detectados_por_sat': det, 'tasa_deteccion': _r(det / len(ext)) if ext else None,
                           'mediana_fraccion_pico': _r(ratio)}
    # Pares para el diagrama de dispersión (todos: ~4-8 mil puntos)
    if not light:
        out['pares'] = {'fecha': days, 'sat': [round(v, 2) for v in sat], 'est': [round(v, 2) for v in obs]}
    return out


def reading(c):
    """Lectura en lenguaje claro, con cautelas."""
    m = c.get('continuas') or {}
    cat = {x['umbral_mm']: x for x in c.get('categoricas') or []}
    parts = []
    if m.get('pbias_pct') is not None:
        pb = m['pbias_pct']
        if abs(pb) < 3:
            parts.append(f"En días pareados la lluvia media del producto y la de la estación prácticamente coinciden (PBIAS {pb:+.1f} %).")
        else:
            parts.append(f"En días pareados el producto {'sobrestima' if pb > 0 else 'subestima'} la lluvia media un {abs(pb):.0f} %"
                         f" (PBIAS {pb:+.0f} %).")
    if m.get('pearson_r') is not None:
        parts.append(f"Correlación diaria r = {m['pearson_r']:.2f} (Spearman {m['spearman_rho']:.2f}); "
                     f"KGE = {m['kge']:.2f}." if m.get('kge') is not None else f"Correlación diaria r = {m['pearson_r']:.2f}.")
    if c.get('mensual_r') is not None:
        parts.append(f"A escala mensual (mismos días) r = {c['mensual_r']:.2f}: el acuerdo mejora al agregar.")
    if 1 in cat and cat[1]['pod'] is not None:
        parts.append(f"Detecta {100 * cat[1]['pod']:.0f} % de los días con lluvia ≥ 1 mm, con {100 * (cat[1]['far'] or 0):.0f} % de falsas alarmas.")
    ex = c.get('extremos') or {}
    if ex.get('tasa_deteccion') is not None:
        parts.append(f"De los días extremos de la estación (> P95 = {ex['p95_est_mm']:.0f} mm), el satélite marcó como extremo "
                     f"{100 * ex['tasa_deteccion']:.0f} % y estimó en mediana {100 * (ex['mediana_fraccion_pico'] or 0):.0f} % del pico.")
    if c.get('desfase_aplicado'):
        r0 = ((c.get('sin_alinear') or {}).get('continuas') or {}).get('pearson_r')
        parts.insert(0, f"Día alineado: la estación se compara con el satélite del día {c['desfase_aplicado']:+d} "
                        f"(r sin alinear = {r0:.2f}). La estación anota la lluvia de las 24 h previas a su lectura; "
                        f"NASA POWER usa el día UTC. Todas las métricas siguientes usan ese desfase." if r0 is not None else
                        f"Día alineado con desfase {c['desfase_aplicado']:+d}.")
    elif c.get('mejor_desfase') not in (None, 0):
        parts.append(f"La correlación mejora levemente con el satélite desplazado {c['mejor_desfase']:+d} día(s); "
                     f"no se aplicó porque la mejora es < 0,05.")
    return ' '.join(parts)


def parse_station_csv(content):
    """CSV de estación del usuario (IMN, ICE, universidad…): fecha, precipitacion_mm."""
    if not isinstance(content, str) or len(content) > 10_000_000:
        raise ValueError('El CSV de estación está ausente o supera 10 MB.')
    text = content.lstrip('﻿')
    try:
        dialect = csv.Sniffer().sniff(text[:4000], delimiters=';,\t')
    except csv.Error:
        dialect = csv.excel
    reader = csv.DictReader(io.StringIO(text), dialect=dialect)
    cols = {str(c).strip().lower(): c for c in (reader.fieldnames or [])}
    cdate = next((cols[k] for k in ('fecha', 'date', 'dia', 'día', 'time') if k in cols), None)
    cprec = next((cols[k] for k in ('precipitacion_mm', 'precipitación_mm', 'precipitacion', 'precipitación',
                                     'lluvia', 'lluvia_mm', 'prcp', 'rain', 'rainfall', 'mm', 'valor') if k in cols), None)
    if not cdate or not cprec:
        raise ValueError('CSV de estación: se necesitan columnas fecha y precipitacion_mm.')
    data = {}
    for row in reader:
        s = str(row.get(cdate, '')).strip()[:10]
        try:
            d = date.fromisoformat(s)
        except ValueError:
            continue
        v = _finite_mm(row.get(cprec, ''))
        if v is not None and v <= MAX_DAILY_MM:
            data[d.isoformat()] = v
    if len(data) < 60:
        raise ValueError('CSV de estación: se necesitan al menos 60 días con dato (fechas AAAA-MM-DD).')
    return data


def haversine_km(lat1, lon1, lat2, lon2):
    R = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))
