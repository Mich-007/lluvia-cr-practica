"""Paso 4: un PNG por sitio y un resumen regional."""
import json
import sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

import config as C

ruta = C.RESULTS / "resultados.json"
if not ruta.exists():
    sys.exit("Falta results/resultados.json. Corran primero: python 03_calcular_tendencias.py")

datos = json.loads(ruta.read_text(encoding="utf-8"))
C.FIGURAS.mkdir(parents=True, exist_ok=True)
ETIQUETA = {"creciente": "▲ creciente", "decreciente": "▼ decreciente", "no_concluyente": "● no concluyente"}

for s in datos["sitios"]:
    x = np.array(s["anios"], dtype=float)
    y = np.array([np.nan if v is None else v for v in s["conteo"]], dtype=float)
    fig, ax = plt.subplots(figsize=(7, 3.8))
    ax.bar(x, y, color="#6b8fb5")
    ok = ~np.isnan(y)
    if ok.sum() > 3:
        pend = s["pendiente_dias_dec"] / 10
        medio = np.nanmedian(y)
        ax.plot(x, medio + pend * (x - np.median(x[ok])), color="#c0392b", lw=2, label="Theil-Sen")
    ax.set_title(f"{s['id']} — {ETIQUETA[s['estado']]}  ({s['pendiente_dias_dec']:+.2f} días/década, p Holm = {s['p_holm']:.3f})", fontsize=9)
    ax.set_xlabel("Año")
    ax.set_ylabel(f"Días > {s['umbral_mm']} mm")
    ax.legend(loc="upper left", fontsize=8)
    fig.tight_layout()
    fig.savefig(C.FIGURAS / f"{s['id']}.png", dpi=120)
    plt.close(fig)

fig, ax = plt.subplots(figsize=(7, 4))
ids = [s["id"] for s in datos["sitios"]]
pend = [s["pendiente_dias_dec"] for s in datos["sitios"]]
colores = {"creciente": "#c0392b", "decreciente": "#2471a3", "no_concluyente": "#999999"}
ax.bar(ids, pend, color=[colores[s["estado"]] for s in datos["sitios"]])
for i, s in enumerate(datos["sitios"]):
    ax.text(i, pend[i], ETIQUETA[s["estado"]].split()[0], ha="center", va="bottom" if pend[i] >= 0 else "top")
ax.axhline(0, color="black", lw=0.8)
ax.set_ylabel("Cambio de días extremos por década")
ax.set_title("Resumen regional (SINTÉTICO)" if datos["meta"]["sintetico"] else "Resumen regional")
fig.tight_layout()
fig.savefig(C.FIGURAS / "resumen_regional.png", dpi=120)
print(f"✔ {len(ids) + 1} figuras en {C.FIGURAS.relative_to(C.RAIZ)}")
