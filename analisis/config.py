"""
Parámetros del análisis. TODO lo que se quiera cambiar se cambia AQUÍ,
no dentro de los scripts.

PRÁCTICA: los sitios SIM_xx son ficticios y los datos son sintéticos.
"""
from pathlib import Path

# ---------- Carpetas ----------
RAIZ = Path(__file__).resolve().parent
DATA_RAW = RAIZ / "data" / "raw_sintetico"      # archivos .nc (uno por año)
DATA_PROC = RAIZ / "data" / "processed"         # un CSV por sitio
RESULTS = RAIZ / "results"
FIGURAS = RESULTS / "figuras"
WEB_JSON = RAIZ.parent / "web" / "data" / "resultados.json"  # lo que lee la web

# ---------- Variable ----------
VARIABLE = "precipitation"   # nombre de la variable dentro del .nc
UNIDAD = "mm/día"
LLUVIA_MM = 1.0              # un día es "lluvioso" si llueve >= 1 mm

# ---------- Periodo y umbral ----------
ANIO_INICIO = 2000
ANIO_FIN = 2024
PERIODO_BASE = (2000, 2009)  # el umbral se calcula SOLO con estos años
PERCENTIL = 95               # día extremo = supera el P95 de días lluviosos del periodo base

# ---------- Calidad y estadística ----------
MIN_FRAC_DIAS_VALIDOS = 0.80   # un año con menos de 80 % de días válidos se descarta
ALFA = 0.05                    # nivel de significancia (después de ajustar con Holm)

# ---------- Sitios de práctica (FICTICIOS) ----------
# sembrado_pct_dec = cambio en la intensidad de la lluvia por década metido a propósito
# en los datos falsos, para comprobar que el análisis lo recupera.
SITIOS = [
    {"id": "SIM_01", "nombre": "Sitio 1", "lat": 10.6, "lon": -85.4, "sembrado_pct_dec": 30},
    {"id": "SIM_02", "nombre": "Sitio 2", "lat": 10.2, "lon": -84.6, "sembrado_pct_dec": 6},
    {"id": "SIM_03", "nombre": "Sitio 3", "lat": 9.9,  "lon": -84.0, "sembrado_pct_dec": 0},
    {"id": "SIM_04", "nombre": "Sitio 4", "lat": 10.4, "lon": -83.5, "sembrado_pct_dec": 25},
    {"id": "SIM_05", "nombre": "Sitio 5", "lat": 9.4,  "lon": -83.7, "sembrado_pct_dec": -20},
    {"id": "SIM_06", "nombre": "Sitio 6", "lat": 8.8,  "lon": -83.3, "sembrado_pct_dec": 30},
    {"id": "SIM_07", "nombre": "Sitio 7", "lat": 9.0,  "lon": -82.9, "sembrado_pct_dec": 0},
]

# ---------- Generador sintético ----------
SEMILLA = 42                   # misma semilla = mismos datos para todo el equipo
GRILLA_LAT = (8.0, 11.5, 0.5)  # inicio, fin, paso
GRILLA_LON = (-86.0, -82.5, 0.5)
SITIO_CON_FALTANTES = "SIM_06"
N_FALTANTES = 40
