"""
Paso 2: de los .nc toma la celda MÁS CERCANA a cada sitio y guarda un CSV por sitio.
Busca las dimensiones por nombre (lat/latitude, lon/longitude), no por posición.
"""
import sys
import xarray as xr
import pandas as pd

import config as C


def nombre_dim(ds, opciones):
    for o in opciones:
        if o in ds.coords or o in ds.dims:
            return o
    raise KeyError(f"No encontré ninguna de {opciones} en {list(ds.coords)}")


archivos = sorted(C.DATA_RAW.glob("*.nc"))
if not archivos:
    sys.exit("No hay archivos .nc. Corran primero: python 01_generar_datos_sinteticos.py")

C.DATA_PROC.mkdir(parents=True, exist_ok=True)
partes = {s["id"]: [] for s in C.SITIOS}

for ruta in archivos:
    with xr.open_dataset(ruta) as ds:
        t = nombre_dim(ds, ["time"])
        la = nombre_dim(ds, ["lat", "latitude"])
        lo = nombre_dim(ds, ["lon", "longitude"])
        da = ds[C.VARIABLE]
        for s in C.SITIOS:
            punto = da.sel({la: s["lat"], lo: s["lon"]}, method="nearest")
            partes[s["id"]].append(pd.Series(punto.values, index=pd.to_datetime(ds[t].values)))

for s in C.SITIOS:
    serie = pd.concat(partes[s["id"]]).sort_index()
    serie.name = "precip_mm"
    serie[serie < 0] = float("nan")          # valores de relleno negativos -> faltante
    serie.index.name = "fecha"
    serie.to_csv(C.DATA_PROC / f"{s['id']}.csv")
    print(f"✔ {s['id']}: {len(serie)} días, {int(serie.isna().sum())} faltantes")
