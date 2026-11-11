# Lluvia extrema en Costa Rica — repositorio de PRÁCTICA

Reto NASA Space Apps: **Be an Earth System Trend Detective**.

**Idea:** el total mensual de lluvia en Centroamérica casi no cambia, pero podría estar cambiando *cómo* llueve (más intensa, en menos tiempo). Medimos eso contando **días de lluvia extrema por año** (días que superan el percentil 95 de un periodo base) y probando si hay tendencia significativa.

> ⚠ **Este repositorio es de práctica.** Usa **datos sintéticos** y sitios ficticios (`SIM_01…SIM_07`). No son resultados NASA. El repositorio del día del hackatón será **otro, nuevo**, y se arma durante el evento (confirmen con su sede qué se permite preparar antes).

## Estructura

```
analisis/   Python: datos → tendencias → resultados.json → gráficos (+ pruebas)
web/        Página estática que lee web/data/resultados.json
docs/       GUIA_GIT.md  ← empiecen aquí si no han usado Git
scripts/    crear_repo.sh (lo usa solo el líder técnico, una vez)
.github/    CI automático, plantilla de PR y de tareas
```

## Arranque rápido (5 minutos)

```bash
git clone https://github.com/DUENO/NOMBRE-REPO.git
cd NOMBRE-REPO/analisis

python -m venv .venv                 # Windows: python -m venv .venv
source .venv/bin/activate            # Windows PowerShell: .venv\Scripts\Activate.ps1
pip install -r requirements.txt

python 00_verificar_entorno.py
python 01_generar_datos_sinteticos.py
python 02_extraer_sitios.py
python 03_calcular_tendencias.py
python 04_graficar.py
pytest -v                            # debe decir: 8 passed
```

Ver la web: `cd ../web && python -m http.server 8000` y abrir http://localhost:8000

## Quién toca qué

| Área | Carpeta / archivo |
| --- | --- |
| Datos (extraer, calidad) | `analisis/02_extraer_sitios.py`, `analisis/05_*` |
| Estadística | `analisis/trendkit.py`, `analisis/config.py`, `analisis/test_trendkit.py` |
| Web | `web/` |
| Resultados | solo se generan con `03_calcular_tendencias.py`, no se editan a mano |

**Regla de oro:** todo parámetro (periodo, percentil, sitios) se cambia en `analisis/config.py`.

## Cómo trabajamos

Una rama por tarea → Pull Request → revisión de otra persona → merge a `main`. Paso a paso en [`docs/GUIA_GIT.md`](docs/GUIA_GIT.md).
