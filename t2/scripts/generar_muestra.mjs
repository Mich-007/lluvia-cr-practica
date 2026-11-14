// Genera public/data/resultados.json con datos SINTÉTICOS (solo para practicar el despliegue).
// No son resultados NASA. El JSON queda marcado con "sintetico": true y la web muestra un aviso.
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Generador pseudoaleatorio con semilla (reproducible)
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const normal = (r) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
const mediana = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
// Φ(z) por aproximación de Abramowitz–Stegun
const cdf = (z) => { const t = 1 / (1 + 0.2316419 * Math.abs(z)); const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; };

function analizar(x, y) {
  const n = y.length, pend = [];
  let S = 0;
  for (let i = 0; i < n - 1; i++) for (let j = i + 1; j < n; j++) { pend.push((y[j] - y[i]) / (x[j] - x[i])); S += Math.sign(y[j] - y[i]); }
  const varS = (n * (n - 1) * (2 * n + 5)) / 18; // sin corrección de empates (suficiente para la muestra)
  const z = S === 0 ? 0 : (S - Math.sign(S)) / Math.sqrt(varS);
  const p = 2 * (1 - cdf(Math.abs(z)));
  const orden = [...pend].sort((a, b) => a - b), N = pend.length, c = 1.96 * Math.sqrt(varS);
  const lo = orden[Math.max(0, Math.floor((N - c) / 2))], hi = orden[Math.min(N - 1, Math.ceil((N + c) / 2))];
  return { b: mediana(pend), lo, hi, p };
}

const sitios = [
  // [id, nombre, país, lat, lon, cambio sembrado en días extremos por década]
  // Los siete puntos piloto son aeropuertos propuestos (uno por país). Verifiquen coordenadas
  // en una fuente pública durante el evento. Las SERIES son sintéticas, no datos NASA.
  ["BZE", "Aeropuerto Internacional Philip S. W. Goldson", "Belice", 17.539, -88.308, 4.0],
  ["GUA", "Aeropuerto Internacional La Aurora", "Guatemala", 14.583, -90.527, 0.5],
  ["SAL", "Aeropuerto Internacional Monseñor Óscar Arnulfo Romero", "El Salvador", 13.441, -89.056, 0],
  ["TGU", "Aeropuerto Internacional Toncontín", "Honduras", 14.061, -87.217, -3.5],
  ["MGA", "Aeropuerto Internacional Augusto C. Sandino", "Nicaragua", 12.141, -86.168, 0],
  ["SJO", "Aeropuerto Internacional Juan Santamaría", "Costa Rica", 9.994, -84.209, 5.0],
  ["PTY", "Aeropuerto Internacional de Tocumen", "Panamá", 9.071, -79.383, -0.1],
];

const r = mulberry32(2026);
const anios = Array.from({ length: 25 }, (_, i) => 2001 + i);
const crudos = sitios.map(([id, nombre, pais, lat, lon, sembrado]) => {
  const conteos = anios.map((a, i) => Math.max(0, Math.round(18 + (sembrado / 10) * i + normal(r) * 2.5)));
  const an = analizar(anios, conteos);
  return { id, nombre, pais, lat, lon, anios, conteos, an, umbral_mm: 28 + r() * 20, cobertura_pct: 100 };
});

// Corrección de Holm
const orden = crudos.map((s, i) => [s.an.p, i]).sort((a, b) => a[0] - b[0]);
const holm = new Array(crudos.length); let max = 0;
orden.forEach(([p, i], k) => { max = Math.max(max, Math.min(1, (crudos.length - k) * p)); holm[i] = max; });

const out = {
  meta: {
    producto: "DATOS SINTÉTICOS (no es NASA IMERG)", version: "n/a", periodo: "2001–2025 (sintético)",
    resolucion: "n/a", unidad: "días/año", fecha_descarga: "n/a", sintetico: true,
    nota: "Muestra generada por scripts/generar_muestra.mjs solo para practicar el despliegue.",
  },
  sitios: crudos.map((s, i) => ({
    id: s.id, nombre: s.nombre, pais: s.pais, lat: s.lat, lon: s.lon, umbral_mm: Math.round(s.umbral_mm * 10) / 10,
    anios: s.anios, conteos: s.conteos,
    pendiente_dias_decada: Math.round(s.an.b * 10 * 100) / 100,
    ic95_dias_decada: [Math.round(s.an.lo * 10 * 100) / 100, Math.round(s.an.hi * 10 * 100) / 100],
    p_holm: Math.round(holm[i] * 10000) / 10000,
    estado: holm[i] < 0.05 ? (s.an.b > 0 ? "creciente" : "decreciente") : "no_concluyente",
    cobertura_pct: s.cobertura_pct,
  })),
};
writeFileSync(resolve(raiz, "public/data/resultados.json"), JSON.stringify(out, null, 1) + "\n");
console.log("Muestra sintética escrita:", out.sitios.map((s) => `${s.id}:${s.estado}`).join(" "));
