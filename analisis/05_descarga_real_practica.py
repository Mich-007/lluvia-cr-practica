"""
OPCIONAL — SIN PROBAR. Descarga IMERG diario real de una zona pequeña, para practicar.

Antes: pip install earthaccess  y tener cuenta en urs.earthdata.nasa.gov
Ojo: esto es para PRACTICAR. Los datos del hackatón se descargan durante el hackatón,
y confirmen con su sede de Space Apps qué se permite preparar antes.
"""
import earthaccess

import config as C

# Zona de práctica (oeste, sur, este, norte) y un mes corto
ZONA = (-84.5, 9.5, -83.5, 10.5)
PERIODO = ("2023-06-01", "2023-06-30")
DESTINO = C.RAIZ / "data" / "raw_real_practica"

earthaccess.login()   # pide usuario/contraseña de Earthdata la primera vez
resultados = earthaccess.search_data(
    short_name="GPM_3IMERGDL",       # IMERG diario (Late). Confirmen versión vigente en el catálogo
    bounding_box=ZONA,
    temporal=PERIODO,
)
print(f"Encontrados: {len(resultados)} archivos")
DESTINO.mkdir(parents=True, exist_ok=True)
earthaccess.download(resultados, str(DESTINO))
print(f"✔ Guardados en {DESTINO}")
# Siguiente paso: abrir uno con xarray y revisar el nombre de la variable y la unidad
# antes de cambiar config.VARIABLE.
