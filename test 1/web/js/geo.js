// Geografía de Costa Rica: proyección, provincias (aproximadas) y pruebas de "punto dentro".
// Las provincias son polígonos ILUSTRATIVOS dibujados a mano: se recortan con el contorno del país,
// por eso sus bordes interiores son aproximados (no son límites oficiales del IGN).
import { CR_CONTORNO, NICARAGUA, PANAMA } from "./geo-datos.js";
export { CR_CONTORNO, NICARAGUA, PANAMA };

export const CAJA = { lon0: -86.15, lon1: -82.35, lat0: 7.95, lat1: 11.45 };
const K = Math.cos((9.7 * Math.PI) / 180);
const PX = 215; // píxeles de SVG por grado de latitud
export const ANCHO = Math.round((CAJA.lon1 - CAJA.lon0) * K * PX);
export const ALTO = Math.round((CAJA.lat1 - CAJA.lat0) * PX);
export const proyectar = (lon, lat) => [(lon - CAJA.lon0) * K * PX, (CAJA.lat1 - lat) * PX];
export const invertir = (x, y) => [CAJA.lon0 + x / (K * PX), CAJA.lat1 - y / PX];

// Nodos compartidos entre provincias (lon, lat) para que no queden huecos.
const N = {
  A1: [-85.10, 11.8], A2: [-85.10, 11.05], A3: [-85.02, 10.80], A4: [-84.98, 10.62], A5: [-84.93, 10.42],
  G1: [-85.02, 10.26], G2: [-85.03, 10.10], G3: [-85.15, 9.95], G4: [-85.28, 9.75], G5: [-85.45, 9.40],
  B1: [-84.75, 10.36], B2: [-84.68, 10.14], B3: [-84.62, 10.02], V6: [-84.58, 9.86],
  C1: [-84.42, 9.92], C2: [-84.30, 9.95], V1: [-84.17, 9.965], H1: [-84.10, 9.96],
  D1: [-84.20, 10.15], D2: [-84.23, 10.35], D3: [-84.28, 10.55], D4: [-84.30, 10.78], D5: [-84.30, 11.8],
  E1: [-83.92, 11.8], E2: [-83.92, 10.78], E3: [-83.93, 10.55], E4: [-83.95, 10.35], E5: [-83.99, 10.15],
  V2: [-84.00, 10.00], V3: [-83.93, 10.00],
  F1: [-83.80, 10.03], F2: [-83.68, 10.00], F3: [-83.58, 9.88], F4: [-83.50, 9.75], V4: [-83.43, 9.55],
  S1: [-83.96, 9.95], S2: [-83.98, 9.85], S3: [-83.93, 9.78], S4: [-83.80, 9.65], S5: [-83.65, 9.55],
  V5: [-83.43, 9.35], L1: [-83.45, 9.20], L2: [-83.49, 9.07], L3: [-83.76, 9.28], L4: [-83.92, 9.32], L5: [-84.10, 9.45], L6: [-84.35, 9.58], L7: [-84.50, 9.72],
  P1: [-83.25, 9.28], P2: [-83.10, 9.18], P3: [-82.97, 9.10], P4: [-82.6, 9.0],
};
const n = (...k) => k.map((x) => N[x]);

export const PROVINCIAS = [
  { id: "GU", nombre: "Guanacaste", capital: "Liberia", poly: [...n("A1", "A2", "A3", "A4", "A5", "G1", "G2", "G3", "G4", "G5"), [-86.8, 9.4], [-86.8, 11.8]] },
  { id: "AL", nombre: "Alajuela", capital: "Alajuela", poly: n("A1", "D5", "D4", "D3", "D2", "D1", "V1", "C2", "C1", "V6", "B3", "B2", "B1", "A5", "A4", "A3", "A2") },
  { id: "HE", nombre: "Heredia", capital: "Heredia", poly: n("D5", "E1", "E2", "E3", "E4", "E5", "V2", "H1", "V1", "D1", "D2", "D3", "D4") },
  { id: "SJ", nombre: "San José", capital: "San José", poly: n("V6", "C1", "C2", "V1", "H1", "V2", "V3", "S1", "S2", "S3", "S4", "S5", "V4", "V5", "L1", "L2", "L3", "L4", "L5", "L6", "L7") },
  { id: "CA", nombre: "Cartago", capital: "Cartago", poly: n("V3", "F1", "F2", "F3", "F4", "V4", "S5", "S4", "S3", "S2", "S1") },
  { id: "LI", nombre: "Limón", capital: "Limón", poly: [...n("E1"), [-82.1, 11.8], [-82.1, 9.0], ...n("P4", "P3", "P2", "P1", "V5", "V4", "F4", "F3", "F2", "F1", "V3", "V2", "E5", "E4", "E3", "E2")] },
  { id: "PU", nombre: "Puntarenas", capital: "Puntarenas", poly: [...n("A5", "B1", "B2", "B3", "V6", "L7", "L6", "L5", "L4", "L3", "L2", "L1", "V5", "P1", "P2", "P3", "P4"), [-82.4, 7.4], [-85.45, 7.4], ...n("G5", "G4", "G3", "G2", "G1")] },
];

export function puntoEnPoligono(lon, lat, poly) {
  let dentro = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}
export const dentroDeCR = (lat, lon) => puntoEnPoligono(lon, lat, CR_CONTORNO);
export function provinciaDe(lat, lon) {
  if (!dentroDeCR(lat, lon)) return null;
  return PROVINCIAS.find((p) => puntoEnPoligono(lon, lat, p.poly)) ?? null;
}
// Distancia aproximada en km (equirrectangular, suficiente a escala nacional).
export const distKm = (lat1, lon1, lat2, lon2) => Math.hypot((lat1 - lat2) * 111.2, (lon1 - lon2) * 111.2 * Math.cos(((lat1 + lat2) / 2) * Math.PI / 180));
export const rutaSVG = (pts) => "M" + pts.map(([lo, la]) => proyectar(lo, la).map((v) => v.toFixed(1)).join(",")).join("L") + "Z";
export const centroide = (poly) => {
  const dentro = poly.filter(([lo, la]) => dentroDeCR(la, lo));
  const arr = dentro.length > 3 ? dentro : poly;
  return [arr.reduce((a, p) => a + p[0], 0) / arr.length, arr.reduce((a, p) => a + p[1], 0) / arr.length];
};
