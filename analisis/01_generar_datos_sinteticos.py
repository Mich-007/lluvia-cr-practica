"""
Paso 1: genera datos SINTÉTICOS de lluvia diaria (un .nc por año).

Cada celda de la grilla toma la tendencia sembrada del sitio más cercano.
La tendencia es un cambio en la INTENSIDAD de la lluvia (no en el total),
que es justo la hipótesis del proyecto: llueve parecido en total, pero más
fuerte en menos tiempo.
"""
import numpy as np
import pandas as pd
import xarray as xr

import config as C

C.DATA_RAW.mkdir(parents=True, exist_ok=True)
rng = np.random.default_rng(C.SEMILLA)

lats = np.arange(C.GRILLA_LAT[0], C.GRILLA_LAT[1] + 1e-9, C.GRILLA_LAT[2])
lons = np.arange(C.GRILLA_LON[0], C.GRILLA_LON[1] + 1e-9, C.GRILLA_LON[2])

# Tendencia sembrada por celda = la del sitio más cercano
sembrado = np.zeros((len(lats), len(lons)))
for i, la in enumerate(lats):
    for j, lo in enumerate(lons):
        d = [(la - s["lat"]) ** 2 + (lo - s["lon"]) ** 2 for s in C.SITIOS]
        sembrado[i, j] = C.SITIOS[int(np.argmin(d))]["sembrado_pct_dec"]

for anio in range(C.ANIO_INICIO, C.ANIO_FIN + 1):
    fechas = pd.date_range(f"{anio}-01-01", f"{anio}-12-31", freq="D")
    n = len(fechas)
    doy = fechas.dayofyear.values
    # Ciclo estacional: más lluvia entre mayo y noviembre
    p_lluvia = 0.25 + 0.45 * np.clip(np.sin((doy - 100) / 365 * 2 * np.pi), 0, None)
    llueve = rng.random((n, len(lats), len(lons))) < p_lluvia[:, None, None]
    escala = 8.0 * (1 + sembrado / 100 * (anio - C.ANIO_INICIO) / 10)   # mm
    escala = np.clip(escala, 1.0, None)
    monto = rng.gamma(shape=0.9, scale=1.0, size=(n, len(lats), len(lons))) * escala[None, :, :]
    lluvia = np.where(llueve, monto, 0.0).astype("float32")

    ds = xr.Dataset(
        {C.VARIABLE: (("time", "lat", "lon"), lluvia, {"units": "mm/day"})},
        coords={"time": fechas, "lat": lats, "lon": lons},
        attrs={"descripcion": "DATOS SINTETICOS DE PRACTICA - no son datos NASA"},
    )
    ds.to_netcdf(C.DATA_RAW / f"lluvia_sintetica_{anio}.nc")
    print(f"✔ {anio}")

# Faltantes en un sitio (para practicar manejo de datos ausentes)
sitio = next(s for s in C.SITIOS if s["id"] == C.SITIO_CON_FALTANTES)
ia = int(np.argmin(np.abs(lats - sitio["lat"])))
io = int(np.argmin(np.abs(lons - sitio["lon"])))
dias_total = (pd.Timestamp(C.ANIO_FIN, 12, 31) - pd.Timestamp(C.ANIO_INICIO, 1, 1)).days + 1
elegidos = set(rng.choice(dias_total, size=C.N_FALTANTES, replace=False).tolist())
base = pd.Timestamp(C.ANIO_INICIO, 1, 1)
por_anio = {}
for k in elegidos:
    f = base + pd.Timedelta(days=int(k))
    por_anio.setdefault(f.year, []).append(f)
for anio, lista in por_anio.items():
    ruta = C.DATA_RAW / f"lluvia_sintetica_{anio}.nc"
    with xr.open_dataset(ruta) as ds:
        ds = ds.load()
    for f in lista:
        ds[C.VARIABLE].loc[dict(time=f, lat=lats[ia], lon=lons[io])] = np.nan
    ds.to_netcdf(ruta)
print(f"✔ {C.N_FALTANTES} días faltantes puestos en {C.SITIO_CON_FALTANTES}")
