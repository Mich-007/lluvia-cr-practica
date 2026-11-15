/* Phyllobytes · módulo «modelo» (script clásico: funciona al abrir index.html con doble clic, sin servidor). */
(function () {
"use strict";
// Modelo de datos de Phyllobytes. Un "sitio" es un punto del mapa con (o sin) series anuales.
// Dos orígenes: la MUESTRA DE DEMOSTRACIÓN (sintética, marcada como tal) y los RESULTADOS REALES del servidor
// (backend.py -> NASA POWER). Ambos pasan por enriquecer(), así se calculan igual.
const { tendencia, holm, media, prng } = PHY.stats;
const { provinciaDe } = PHY.geo;

const UMBRALES = [50.8, 76.2, 101.6, 127];
const ANIOS_DEMO = Array.from({ length: 25 }, (_, i) => 2001 + i);

// Un sitio por provincia: su capital (coordenadas del catálogo places.json).
const SITIOS_BASE = [
  { id: "SJ", nombre: "San José", lat: 9.932, lon: -84.079 },
  { id: "AL", nombre: "Alajuela", lat: 10.016, lon: -84.213 },
  { id: "CA", nombre: "Cartago", lat: 9.864, lon: -83.919 },
  { id: "HE", nombre: "Heredia", lat: 9.998, lon: -84.116 },
  { id: "GU", nombre: "Liberia", lat: 10.634, lon: -85.44 },
  { id: "PU", nombre: "Puntarenas", lat: 9.977, lon: -84.834 },
  { id: "LI", nombre: "Limón", lat: 9.991, lon: -83.037 },
];

// Parámetros de la muestra sintética: lluvia anual (mm), días extremos/año al inicio, cambio sembrado (días/década), régimen mensual.
const PACIFICO = [0.01, 0.01, 0.015, 0.04, 0.13, 0.15, 0.1, 0.13, 0.18, 0.17, 0.06, 0.015];
const CARIBE = [0.11, 0.07, 0.06, 0.06, 0.08, 0.1, 0.12, 0.1, 0.06, 0.07, 0.11, 0.12];
const DEMO = {
  SJ: { total: 2050, ext: 8.5, cambio: 2.0, reg: PACIFICO, umbral: 36.5, sem: 11 },
  AL: { total: 1950, ext: 8.0, cambio: 0.2, reg: PACIFICO, umbral: 35.2, sem: 23 },
  CA: { total: 1650, ext: 7.0, cambio: 0.0, reg: PACIFICO, umbral: 31.8, sem: 37 },
  HE: { total: 2600, ext: 9.5, cambio: 1.2, reg: PACIFICO, umbral: 41.0, sem: 41 },
  GU: { total: 1750, ext: 8.0, cambio: -3.6, reg: PACIFICO, umbral: 37.6, sem: 53 },
  PU: { total: 2900, ext: 11, cambio: 0.4, reg: PACIFICO, umbral: 47.9, sem: 67 },
  LI: { total: 3350, ext: 12, cambio: 3.2, reg: CARIBE, umbral: 52.4, sem: 79 },
};
const GENERICO = { total: 2400, ext: 9, cambio: 0, reg: PACIFICO, umbral: 40, sem: 5 };

function serieDemo(id, lat, lon) {
  const d = DEMO[id] ?? GENERICO;
  const r = prng(d.sem * 7919 + Math.round((lat + lon) * 1000));
  const gauss = () => (r() + r() + r() - 1.5) * 1.6;
  const n = ANIOS_DEMO.length;
  const extremos = ANIOS_DEMO.map((a, i) => Math.max(0, Math.round(d.ext + (d.cambio / 10) * (i - (n - 1) / 2) + gauss() * 2.2)));
  const totales = ANIOS_DEMO.map((a, i) => Math.round(d.total * (1 + 0.012 * (d.cambio) * (i - (n - 1) / 2) / 2 + gauss() * 0.09)));
  const fijos = {};
  UMBRALES.forEach((t, k) => {
    const base = (d.total / 230) * Math.pow(0.4, k);
    fijos[String(t)] = ANIOS_DEMO.map((a, i) => Math.max(0, Math.round(base * (1 + 0.025 * d.cambio * (i - (n - 1) / 2) / 2) + gauss() * Math.sqrt(base + 0.2))));
  });
  const clim = d.reg.map((w) => Math.round((d.total * w * (1 + gauss() * 0.02)) * 10) / 10);
  return { anios: [...ANIOS_DEMO], extremos, totales, fijos, clim, umbral: d.umbral, cobertura: 100 };
}

function sitiosDemo() {
  return SITIOS_BASE.map((b) => ({ ...b, prov: b.id, demo: true, datos: true, ...serieDemo(b.id, b.lat, b.lon) }));
}

// Punto elegido por la persona que todavía no se analizó.
function sitioPendiente(id, nombre, lat, lon) {
  return { id, nombre, lat, lon, prov: provinciaDe(lat, lon)?.id ?? null, demo: false, datos: false };
}

// Convierte un punto devuelto por /api/status (backend.aggregate) al modelo del sitio.
function desdeServidor(p, id) {
  const completos = p.annual.filter((r) => r.exceedances && r.exceedances["95"] !== null && r.total !== null);
  return {
    id, nombre: p.name, lat: p.lat, lon: p.lon, prov: provinciaDe(p.lat, p.lon)?.id ?? null, demo: false, datos: true,
    anios: completos.map((r) => r.year),
    extremos: completos.map((r) => r.exceedances["95"]),
    totales: completos.map((r) => r.total),
    fijos: Object.fromEntries(UMBRALES.map((t) => [String(t), completos.map((r) => r.fixed_days?.[String(t)] ?? null)])),
    clim: (p.climatology ?? []).map((c) => c.mean),
    umbral: p.thresholds?.["95"] ?? null,
    cobertura: p.summary?.coverage_pct ?? null,
    diasValidos: p.summary?.valid_days ?? null,
    procedencia: p.provenance ?? [],
  };
}

// Calcula tendencias, valor p ajustado (Holm entre los sitios con datos) y estado de cada sitio.
function enriquecer(sitios) {
  for (const s of sitios) {
    if (!s.datos) continue;
    s.tend = tendencia(s.anios, s.extremos);
    s.tendTot = tendencia(s.anios, s.totales);
    s.fijosTend = Object.fromEntries(UMBRALES.map((t) => {
      const v = s.fijos[String(t)];
      return [String(t), { ...tendencia(s.anios, v), media: media(v.filter((x) => x !== null)) }];
    }));
    s.extMedia = media(s.extremos);
    s.totMedia = media(s.totales);
  }
  const con = sitios.filter((s) => s.datos);
  const aj = holm(con.map((s) => s.tend.p));
  con.forEach((s, i) => {
    s.pHolm = aj[i];
    const b = s.tend.pendienteDecada;
    s.estado = s.pHolm !== null && s.pHolm < 0.05 && b > 0 ? "creciente" : s.pHolm !== null && s.pHolm < 0.05 && b < 0 ? "decreciente" : "no_concluyente";
  });
  return sitios;
}

// Valor de un sitio para el indicador y el año elegidos (null = no disponible).
function valorIndicador(s, ind, anio) {
  if (!s.datos) return null;
  const en = (arr) => {
    if (anio === "todos") return media(arr.filter((x) => x !== null));
    const i = s.anios.indexOf(Number(anio));
    return i < 0 ? null : arr[i];
  };
  if (ind === "extremos") return en(s.extremos);
  if (ind === "tendencia") return s.tend.pendienteDecada;
  if (ind === "lluvia") return en(s.totales);
  if (ind.startsWith("fijo:")) return en(s.fijos[ind.slice(5)]);
  return null;
}
PHY.modelo = { sitiosDemo, sitioPendiente, desdeServidor, enriquecer, valorIndicador, UMBRALES, ANIOS_DEMO, SITIOS_BASE };
})();
