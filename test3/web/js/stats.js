/* Phyllobytes · módulo «stats» (script clásico: funciona al abrir index.html con doble clic, sin servidor). */
(function () {
"use strict";
// Estadística básica reproducible, sin dependencias. Replica backend.trend() (Theil–Sen + Mann–Kendall)
// y añade el intervalo de confianza de Sen y el ajuste de Holm.
const erfc = (x) => {
  // Aproximación de Abramowitz–Stegun 7.1.26 mejorada (error < 1.2e-7), suficiente para valores p.
  const z = Math.abs(x), t = 1 / (1 + 0.5 * z);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? r : 2 - r;
};
const media = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
const mediana = (a) => {
  const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
  return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null;
};
const interp = (s, k) => { const lo = Math.max(0, Math.min(s.length - 1, Math.floor(k))), hi = Math.max(0, Math.min(s.length - 1, Math.ceil(k))); return s[lo] + (s[hi] - s[lo]) * (k - lo); };

function tendencia(anios, valores) {
  const par = anios.map((a, i) => [Number(a), valores[i]]).filter(([, v]) => v !== null && v !== undefined && Number.isFinite(v)).sort((a, b) => a[0] - b[0]);
  const n = par.length;
  const r = { n, pendienteDecada: null, ic95Decada: null, tau: null, p: null, ajusteIni: null, ajusteFin: null, cambioPct: null, primero: par[0]?.[0] ?? null, ultimo: par[n - 1]?.[0] ?? null };
  if (n < 10) return r;
  const pend = [];
  let S = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    pend.push((par[j][1] - par[i][1]) / (par[j][0] - par[i][0]));
    S += Math.sign(par[j][1] - par[i][1]);
  }
  const sorted = [...pend].sort((a, b) => a - b);
  const b = mediana(pend);
  const a0 = mediana(par.map(([y, v]) => v - b * y));
  const lazos = new Map();
  par.forEach(([, v]) => lazos.set(v, (lazos.get(v) ?? 0) + 1));
  const n0 = (n * (n - 1)) / 2;
  let n1 = 0, corr = 0;
  lazos.forEach((t) => { n1 += (t * (t - 1)) / 2; corr += t * (t - 1) * (2 * t + 5); });
  const den = Math.sqrt(n0 * (n0 - n1));
  const varS = (n * (n - 1) * (2 * n + 5) - corr) / 18;
  if (den) r.tau = S / den;
  if (varS > 0) {
    const z = (S > 0 ? S - 1 : S < 0 ? S + 1 : 0) / Math.sqrt(varS);
    r.p = erfc(Math.abs(z) / Math.SQRT2);
    // IC 95 % de la pendiente de Sen (Gilbert 1987): índices M1 y M2+1 en las pendientes ordenadas.
    const N = sorted.length, C = 1.96 * Math.sqrt(varS);
    r.ic95Decada = [10 * interp(sorted, (N - C) / 2 - 1), 10 * interp(sorted, (N + C) / 2)];
  }
  r.pendienteDecada = 10 * b;
  r.ajusteIni = a0 + b * par[0][0];
  r.ajusteFin = a0 + b * par[n - 1][0];
  r.intercepto = a0;
  if (r.ajusteIni > 1e-9 && r.ajusteFin >= 0) r.cambioPct = (100 * (r.ajusteFin - r.ajusteIni)) / r.ajusteIni;
  return r;
}

// Ajuste de Holm–Bonferroni para m pruebas (devuelve valores p ajustados en el mismo orden).
function holm(ps) {
  const idx = ps.map((p, i) => [p, i]).filter(([p]) => p !== null && Number.isFinite(p)).sort((a, b) => a[0] - b[0]);
  const m = idx.length, out = ps.map(() => null);
  let max = 0;
  idx.forEach(([p, i], k) => { max = Math.max(max, Math.min(1, (m - k) * p)); out[i] = max; });
  return out;
}

// PRNG determinista (mulberry32) para la muestra sintética.
function prng(semilla) {
  let a = semilla >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
PHY.stats = { tendencia, holm, prng, media, mediana };
})();
