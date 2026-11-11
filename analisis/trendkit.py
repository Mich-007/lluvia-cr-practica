"""
Funciones estadísticas del flujo. Sin dependencias raras: numpy, pandas, scipy.
"""
import numpy as np
import pandas as pd
from scipy import stats


def umbral_percentil(serie, base, percentil=95, lluvia_mm=1.0):
    """Umbral de día extremo.

    serie: pandas Series de lluvia diaria (mm) con índice de fechas.
    base: (anio_ini, anio_fin) -> el umbral se calcula SOLO con este periodo.
    Se usan solo los días lluviosos (>= lluvia_mm) y se toma el percentil.
    """
    en_base = serie[(serie.index.year >= base[0]) & (serie.index.year <= base[1])]
    lluviosos = en_base[en_base >= lluvia_mm].dropna()
    if len(lluviosos) == 0:
        raise ValueError("No hay días lluviosos en el periodo base")
    return float(np.percentile(lluviosos, percentil))


def conteo_anual(serie, umbral, anio_ini, anio_fin, min_frac=0.8):
    """Número de días extremos (> umbral) por año.

    Un año con menos de `min_frac` de días válidos queda como NaN (no se inventa).
    """
    filas = {}
    for anio in range(anio_ini, anio_fin + 1):
        s = serie[serie.index.year == anio]
        dias_anio = 366 if pd.Timestamp(year=anio, month=12, day=31).dayofyear == 366 else 365
        validos = s.notna().sum()
        if validos / dias_anio < min_frac:
            filas[anio] = np.nan
        else:
            filas[anio] = int((s > umbral).sum())
    return pd.Series(filas, name="dias_extremos", dtype=float)


def mann_kendall(y):
    """Prueba de Mann-Kendall (con corrección por empates, aprox. normal).

    Devuelve (tau, p). Ignora NaN. Con menos de 4 datos devuelve (nan, nan).
    """
    y = np.asarray(y, dtype=float)
    y = y[~np.isnan(y)]
    n = len(y)
    if n < 4:
        return np.nan, np.nan
    s = 0
    for i in range(n - 1):
        s += np.sign(y[i + 1:] - y[i]).sum()
    _, cuentas = np.unique(y, return_counts=True)
    var_s = (n * (n - 1) * (2 * n + 5) - np.sum(cuentas * (cuentas - 1) * (2 * cuentas + 5))) / 18.0
    if var_s == 0:
        return 0.0, 1.0
    if s > 0:
        z = (s - 1) / np.sqrt(var_s)
    elif s < 0:
        z = (s + 1) / np.sqrt(var_s)
    else:
        z = 0.0
    p = 2 * (1 - stats.norm.cdf(abs(z)))
    tau = s / (n * (n - 1) / 2)
    return float(tau), float(p)


def theil_sen(x, y, confianza=0.95):
    """Pendiente de Theil-Sen. Devuelve (pendiente, ic_bajo, ic_alto). Ignora NaN."""
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    ok = ~np.isnan(y)
    res = stats.theilslopes(y[ok], x[ok], alpha=confianza)
    return float(res[0]), float(res[2]), float(res[3])


def holm(pvalores):
    """Ajuste de Holm-Bonferroni (controla el error al comparar varios sitios)."""
    p = np.asarray(pvalores, dtype=float)
    m = len(p)
    orden = np.argsort(p)
    ajustado = np.empty(m)
    max_previo = 0.0
    for rango, idx in enumerate(orden):
        val = (m - rango) * p[idx]
        max_previo = max(max_previo, val)
        ajustado[idx] = min(1.0, max_previo)
    return ajustado


def clasificar(pendiente, p_ajustado, alfa=0.05):
    """creciente / decreciente / no_concluyente.

    Regla decidida ANTES de ver resultados: solo se declara tendencia si
    p ajustado < alfa. Si no, es 'no_concluyente' (no significa 'no hay cambio').
    """
    if np.isnan(p_ajustado) or p_ajustado >= alfa:
        return "no_concluyente"
    return "creciente" if pendiente > 0 else "decreciente"
