/* Phyllobytes · módulo «calor» (script clásico: funciona al abrir index.html con doble clic, sin servidor). */
(function () {
"use strict";
// Mapa de calor: interpolación IDW de los valores de los puntos sobre el contorno de Costa Rica,
// dibujada como bandas tipo curvas de nivel (o degradado suave). Es una ILUSTRACIÓN de cómo cambian los
// valores entre puntos medidos; no es una medición píxel a píxel (para eso se necesitan los campos de grilla).
const { CAJA, ANCHO, ALTO, CR_CONTORNO, proyectar, invertir } = PHY.geo;

// Rampas con luminosidad creciente (legibles en escala de grises y con daltonismo).
const RAMPAS = {
  logo: { sec: ["#0c3a4b", "#136a87", "#2aa5c6", "#74d8ef", "#cdf1e2", "#fff0b5"], div: ["#1593c4", "#6fcbe8", "#e9f6f6", "#ffc58a", "#ff8a24", "#c25800"] },
  daltonismo: { sec: ["#00204d", "#2b4a7c", "#5a6e8a", "#8f8a78", "#c4b56a", "#ffe945"], div: ["#0a4f93", "#5d9fd6", "#f2f2f2", "#f0b56a", "#d9700f", "#8a3b00"] },
  contraste: { sec: ["#000000", "#2b2b6b", "#2f7fff", "#00e0d0", "#fff200", "#ffffff"], div: ["#00b7ff", "#7fe0ff", "#ffffff", "#ffd27f", "#ff9a00", "#ff4d00"] },
};
const modoPaleta = () => {
  const d = document.documentElement.dataset;
  return d.paleta === "daltonismo" ? "daltonismo" : d.contraste === "alto" ? "contraste" : "logo";
};
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
function colorEn(stops, t) {
  t = Math.max(0, Math.min(1, t));
  const x = t * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(x)), f = x - i;
  const a = hex(stops[i]), b = hex(stops[i + 1]);
  return a.map((v, k) => Math.round(v + (b[k] - v) * f));
}
const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;

// puntos: [{lat, lon, v}]. opciones: {divergente, niveles, estilo: "bandas"|"suave", escala}
function renderCalor(puntos, { divergente = false, niveles = 8, estilo = "bandas", escala = 1.5 } = {}) {
  const pts = puntos.filter((p) => Number.isFinite(p.v));
  if (pts.length < 2) return null;
  const W = Math.round(ANCHO * escala), H = Math.round(ALTO * escala);
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  // máscara con el contorno del país
  ctx.beginPath();
  CR_CONTORNO.forEach(([lo, la], i) => { const [x, y] = proyectar(lo, la); i ? ctx.lineTo(x * escala, y * escala) : ctx.moveTo(x * escala, y * escala); });
  ctx.closePath(); ctx.fillStyle = "#000"; ctx.fill();
  const mask = ctx.getImageData(0, 0, W, H).data;
  const img = ctx.createImageData(W, H), out = img.data;

  const vals = pts.map((p) => p.v);
  let vmin = Math.min(...vals), vmax = Math.max(...vals);
  if (divergente) { const m = Math.max(Math.abs(vmin), Math.abs(vmax)) || 1; vmin = -m; vmax = m; }
  else if (vmax - vmin < 1e-9) { vmin -= 1; vmax += 1; }
  const rampa = RAMPAS[modoPaleta()][divergente ? "div" : "sec"];
  // posiciones de los puntos en píxeles
  const P = pts.map((p) => { const [x, y] = proyectar(p.lon, p.lat); return [x * escala, y * escala, p.v]; });
  const eps = (0.05 * ANCHO * escala) ** 2 * 0.02;
  const nivel = new Int16Array(W * H).fill(-1);
  const t = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const k = y * W + x;
    if (mask[k * 4 + 3] < 128) continue;
    let sw = 0, sv = 0;
    for (let j = 0; j < P.length; j++) { const dx = x - P[j][0], dy = y - P[j][1]; const w = 1 / (dx * dx + dy * dy + eps) ** 1.25; sw += w; sv += w * P[j][2]; }
    const tt = (sv / sw - vmin) / (vmax - vmin);
    t[k] = tt;
    nivel[k] = Math.max(0, Math.min(niveles - 1, Math.floor(tt * niveles)));
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const k = y * W + x;
    if (nivel[k] < 0) continue;
    const c = estilo === "bandas" ? colorEn(rampa, (nivel[k] + 0.5) / niveles) : colorEn(rampa, t[k]);
    let r = c[0], g = c[1], b = c[2];
    if (estilo === "bandas") {
      // línea de contorno donde cambia el nivel; cada tercer nivel es una "curva maestra" más gruesa
      const kr = x + 1 < W ? nivel[k + 1] : nivel[k], kd = y + 1 < H ? nivel[k + W] : nivel[k];
      const cambia = (kr >= 0 && kr !== nivel[k]) || (kd >= 0 && kd !== nivel[k]);
      if (cambia) {
        const mayor = Math.max(nivel[k], kr, kd) % 3 === 0;
        const f = mayor ? 0.45 : 0.72;
        r *= f; g *= f; b *= f;
      }
    }
    out[k * 4] = r; out[k * 4 + 1] = g; out[k * 4 + 2] = b; out[k * 4 + 3] = 235;
  }
  ctx.putImageData(img, 0, 0);
  return { url: cv.toDataURL("image/png"), vmin, vmax, niveles, rampa, divergente, estilo };
}
PHY.calor = { colorEn, renderCalor, RAMPAS, modoPaleta, rgb };
})();
