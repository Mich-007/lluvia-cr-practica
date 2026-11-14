// CONTRATO DE DATOS entre el análisis (Python) y la web.
// Si el JSON que produce el equipo de estadística tiene otra forma, SOLO se cambia este archivo.
//
// Forma esperada de public/data/resultados.json:
// {
//   "meta": { "producto", "version", "periodo", "resolucion", "unidad", "fecha_descarga",
//             "umbral_definicion", "sintetico": true|false, "nota" },
//   "sitios": [{
//     "id", "nombre", "pais", "lat", "lon", "umbral_mm",
//     "anios": [2001, ...], "conteos": [18, ...],
//     "pendiente_dias_decada", "ic95_dias_decada": [lo, hi],
//     "p_holm", "estado": "creciente" | "decreciente" | "no_concluyente",
//     "cobertura_pct"
//   }]
// }

const ESTADOS = ["creciente", "decreciente", "no_concluyente"];

export function normalizar(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.sitios)) {
    throw new Error("resultados.json no tiene la forma esperada (falta 'sitios').");
  }
  const meta = raw.meta ?? {};
  const sitios = raw.sitios.map((s, i) => {
    const etiqueta = s.id ?? `sitio ${i + 1}`;
    for (const campo of ["id", "nombre", "lat", "lon", "anios", "conteos", "estado"]) {
      if (s[campo] === undefined) throw new Error(`Al sitio ${etiqueta} le falta el campo '${campo}'.`);
    }
    if (!ESTADOS.includes(s.estado)) throw new Error(`Estado desconocido en ${etiqueta}: ${s.estado}`);
    if (s.anios.length !== s.conteos.length) throw new Error(`anios y conteos difieren en ${etiqueta}.`);
    return { ...s };
  });
  return { meta, sitios };
}
