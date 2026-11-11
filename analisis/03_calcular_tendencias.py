"""
Paso 3: umbral P95 -> conteo anual -> Theil-Sen + Mann-Kendall -> Holm -> resultados.json
"""
import json
import sys
from datetime import date

import pandas as pd

import config as C
import trendkit as T

if not list(C.DATA_PROC.glob("*.csv")):
    sys.exit("No hay CSV. Corran primero: python 02_extraer_sitios.py")

sitios_out, pvals = [], []
for s in C.SITIOS:
    serie = pd.read_csv(C.DATA_PROC / f"{s['id']}.csv", index_col="fecha", parse_dates=True)["precip_mm"]
    umbral = T.umbral_percentil(serie, C.PERIODO_BASE, C.PERCENTIL, C.LLUVIA_MM)
    conteo = T.conteo_anual(serie, umbral, C.ANIO_INICIO, C.ANIO_FIN, C.MIN_FRAC_DIAS_VALIDOS)
    anios = conteo.index.values
    pend, lo, hi = T.theil_sen(anios, conteo.values)
    tau, p = T.mann_kendall(conteo.values)
    pvals.append(p)
    sitios_out.append({
        "id": s["id"], "nombre": s["nombre"], "lat": s["lat"], "lon": s["lon"],
        "umbral_mm": round(umbral, 2),
        "anios": [int(a) for a in anios],
        "conteo": [None if pd.isna(v) else int(v) for v in conteo.values],
        "anios_descartados": int(conteo.isna().sum()),
        "pendiente_dias_dec": round(pend * 10, 3),
        "ic95_dias_dec": [round(lo * 10, 3), round(hi * 10, 3)],
        "tau": round(tau, 3), "p": round(p, 5),
        "sembrado_pct_dec": s.get("sembrado_pct_dec"),
    })

ajustados = T.holm(pvals)
for fila, pa in zip(sitios_out, ajustados):
    fila["p_holm"] = round(float(pa), 5)
    fila["estado"] = T.clasificar(fila["pendiente_dias_dec"], pa, C.ALFA)

resultado = {
    "meta": {
        "sintetico": True,   # <-- poner False SOLO con datos reales
        "producto": "Datos sintéticos de práctica",
        "version": "n/a",
        "variable": f"Precipitación diaria ({C.UNIDAD})",
        "periodo": [C.ANIO_INICIO, C.ANIO_FIN],
        "periodo_base": list(C.PERIODO_BASE),
        "definicion_umbral": f"Percentil {C.PERCENTIL} de los días con lluvia >= {C.LLUVIA_MM} mm en el periodo base",
        "metodo": "Theil-Sen (pendiente) + Mann-Kendall (significancia) + ajuste de Holm entre sitios",
        "alfa": C.ALFA,
        "fecha_generacion": date.today().isoformat(),
    },
    "sitios": sitios_out,
}

C.RESULTS.mkdir(parents=True, exist_ok=True)
texto = json.dumps(resultado, ensure_ascii=False, indent=2)
(C.RESULTS / "resultados.json").write_text(texto, encoding="utf-8")
C.WEB_JSON.parent.mkdir(parents=True, exist_ok=True)
C.WEB_JSON.write_text(texto, encoding="utf-8")

print(f"\n{'sitio':8} {'sembrado':>9} {'días/déc':>9} {'p_Holm':>8}  estado")
for f in sitios_out:
    print(f"{f['id']:8} {str(f['sembrado_pct_dec']) + '%':>9} {f['pendiente_dias_dec']:>9.2f} {f['p_holm']:>8.3f}  {f['estado']}")
print(f"\n✔ Guardado en results/resultados.json y {C.WEB_JSON.relative_to(C.RAIZ.parent)}")
