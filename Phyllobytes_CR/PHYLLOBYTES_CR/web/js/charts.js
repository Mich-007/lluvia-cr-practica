// Gráficos SVG propios (sin librerías). Los colores salen de variables CSS: cambian con el tema sin redibujar.
import { t, locale } from "./i18n.js";
import { estadoDe, fmt, fmtS, clamp } from "./util.js";

const NS = "http://www.w3.org/2000/svg";
const S = (tag, a = {}, txt) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(a)) e.setAttribute(k, String(v)); if (txt !== undefined) e.textContent = txt; return e; };
let uid = 0;

// ---- información flotante ----
let tipEl = null;
function tip() { if (!tipEl) { tipEl = document.createElement("div"); tipEl.className = "tip"; tipEl.setAttribute("role", "status"); document.body.append(tipEl); } return tipEl; }
function mostrarTip(ev, lineas) {
  const e = tip(); e.replaceChildren(...lineas.map((l, i) => { const p = document.createElement(i ? "span" : "strong"); p.textContent = l; return p; }));
  e.style.display = "grid";
  const w = e.offsetWidth, h = e.offsetHeight;
  e.style.left = `${clamp(ev.clientX + 14, 8, window.innerWidth - w - 8)}px`;
  e.style.top = `${clamp(ev.clientY - h - 12, 8, window.innerHeight - h - 8)}px`;
}
const ocultarTip = () => { if (tipEl) tipEl.style.display = "none"; };

// Contenedor que se redibuja al cambiar de ancho (texto legible en móvil).
export function montar(clase, dibujar) {
  const caja = document.createElement("div"); caja.className = clase;
  let ultimo = 0;
  const pintar = () => { const w = Math.round(caja.clientWidth); if (!w || w === ultimo) return; ultimo = w; caja.replaceChildren(dibujar(w)); };
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(pintar).observe(caja); else window.addEventListener("resize", pintar);
  requestAnimationFrame(pintar);
  return caja;
}

function paso(max) { const objetivo = max / 5; return [1, 2, 5, 10, 20, 25, 50, 100, 200, 500].find((n) => n >= objetivo) ?? 500; }
function ejes(g, m, W, H, ymax, y, unidad) {
  const p = paso(ymax);
  for (let v = 0; v <= ymax; v += p) {
    g.append(S("line", { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: "g-rejilla" }), S("text", { x: m.l - 7, y: y(v) + 4, "text-anchor": "end", class: "g-eje" }, fmt(v, 0)));
  }
  if (unidad) g.append(S("text", { x: m.l - 7, y: m.t - 5, "text-anchor": "end", class: "g-eje g-unidad" }, unidad));
}
function etiquetasAnio(g, m, W, H, anios, x) {
  const cada = W < 420 ? 8 : W < 640 ? 5 : 4;
  anios.forEach((a, i) => { if (i % cada === 0 || i === anios.length - 1) g.append(S("text", { x: x(i), y: H - 9, "text-anchor": "middle", class: "g-eje" }, a)); });
}
// Cruce interactivo: línea vertical, punto y texto flotante. lineas(i) -> [titulo, ...detalles]; punto(i) -> y
function cruce(svg, m, W, H, n, x, punto, lineas) {
  const lin = S("line", { class: "g-cruce", y1: m.t, y2: H - m.b, visibility: "hidden" });
  const pto = S("circle", { class: "g-punto", r: 5.5, visibility: "hidden" });
  const capa = S("rect", { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, fill: "transparent", class: "g-capa" });
  const ir = (ev) => {
    const r = svg.getBoundingClientRect(), px = ((ev.clientX - r.left) / r.width) * W;
    const i = clamp(Math.round(((px - m.l) / (W - m.l - m.r)) * n - 0.5), 0, n - 1);
    lin.setAttribute("x1", x(i)); lin.setAttribute("x2", x(i)); pto.setAttribute("cx", x(i)); pto.setAttribute("cy", punto(i));
    lin.setAttribute("visibility", "visible"); pto.setAttribute("visibility", "visible");
    mostrarTip(ev, lineas(i));
  };
  const salir = () => { lin.setAttribute("visibility", "hidden"); pto.setAttribute("visibility", "hidden"); ocultarTip(); };
  capa.addEventListener("pointermove", ir); capa.addEventListener("pointerdown", ir); capa.addEventListener("pointerleave", salir);
  svg.append(lin, pto, capa);
}
function degradado(svg, id, c1, c2) {
  const d = S("defs"), g = S("linearGradient", { id, x1: 0, x2: 0, y1: 0, y2: 1 });
  g.append(S("stop", { offset: "0%", style: `stop-color:var(${c1})` }), S("stop", { offset: "100%", style: `stop-color:var(${c2})` }));
  d.append(g); svg.append(d);
}

// 1) Días extremos por año: barras con degradado + recta de Theil–Sen + franja del periodo base.
export function graficoExtremos(s, W = 640) {
  const id = `g${++uid}`;
  const H = Math.round(clamp(W * 0.5, 220, 320)), m = { t: 20, r: 12, b: 30, l: 38 };
  const { anios, extremos: v } = s, n = anios.length;
  const ymax = Math.max(4, ...v) * 1.15;
  const x = (i) => m.l + ((i + 0.5) * (W - m.l - m.r)) / n, y = (val) => H - m.b - (val / ymax) * (H - m.t - m.b);
  const bw = Math.max(3, ((W - m.l - m.r) / n) * 0.64);
  const svg = S("svg", { viewBox: `0 0 ${W} ${H}`, class: "grafico", role: "img" });
  svg.append(S("title", {}, t("ch.ext.title", { nombre: s.nombre })), S("desc", {}, t("ch.ext.desc", { n, b: fmt(s.tend.pendienteDecada) })));
  degradado(svg, `${id}b`, "--c-barra-a", "--c-barra-b");
  const ultimoBase = anios.reduce((acc, a, i) => (a <= 2020 ? i : acc), -1);
  if (ultimoBase > 0) svg.append(S("rect", { x: m.l, y: m.t, width: ((ultimoBase + 1) * (W - m.l - m.r)) / n, height: H - m.t - m.b, class: "g-base" }));
  ejes(svg, m, W, H, ymax, y, t("ch.ext.unit"));
  v.forEach((c, i) => svg.append(S("rect", { x: x(i) - bw / 2, y: y(c), width: bw, height: Math.max(0, y(0) - y(c)), rx: Math.min(4, bw / 2.4), fill: `url(#${id}b)`, class: "g-barra" })));
  etiquetasAnio(svg, m, W, H, anios, x);
  const b = s.tend.pendienteDecada / 10, a0 = s.tend.intercepto, f = (i) => a0 + b * anios[i];
  if (s.tend.pendienteDecada !== null) svg.append(S("line", { x1: x(0), y1: y(f(0)), x2: x(n - 1), y2: y(f(n - 1)), class: "g-recta" }));
  cruce(svg, m, W, H, n, x, (i) => y(v[i]), (i) => [String(anios[i]), t("ch.ext.val", { c: v[i] }), t("ch.tend.val", { v: fmt(f(i)) })]);
  return svg;
}

// 2) Lluvia anual: línea con relleno punteado (estilo "tablero") + tendencia discontinua.
export function graficoLluvia(s, W = 640) {
  const id = `g${++uid}`;
  const H = Math.round(clamp(W * 0.42, 200, 280)), m = { t: 20, r: 12, b: 30, l: 44 };
  const { anios, totales: v } = s, n = anios.length;
  const lo = Math.min(...v) * 0.85, hi = Math.max(...v) * 1.08;
  const x = (i) => m.l + (i * (W - m.l - m.r)) / (n - 1), y = (val) => H - m.b - ((val - lo) / (hi - lo)) * (H - m.t - m.b);
  const svg = S("svg", { viewBox: `0 0 ${W} ${H}`, class: "grafico", role: "img" });
  svg.append(S("title", {}, t("ch.rain.title", { nombre: s.nombre })), S("desc", {}, t("ch.rain.desc", { b: fmt(s.tendTot.pendienteDecada, 0) })));
  const defs = S("defs"), pat = S("pattern", { id: `${id}p`, width: 4.5, height: 4.5, patternUnits: "userSpaceOnUse" });
  pat.append(S("circle", { cx: 1.2, cy: 1.2, r: 0.95, class: "g-puntito" })); defs.append(pat); svg.append(defs);
  const p = Math.max(100, Math.round((hi - lo) / 4 / 100) * 100);
  for (let val = Math.ceil(lo / p) * p; val <= hi; val += p) svg.append(S("line", { x1: m.l, x2: W - m.r, y1: y(val), y2: y(val), class: "g-rejilla" }), S("text", { x: m.l - 7, y: y(val) + 4, "text-anchor": "end", class: "g-eje" }, fmt(val, 0)));
  svg.append(S("text", { x: m.l - 7, y: m.t - 6, "text-anchor": "end", class: "g-eje g-unidad" }, "mm"));
  const linea = v.map((val, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(val).toFixed(1)}`).join("");
  svg.append(S("path", { d: `${linea}L${x(n - 1)},${y(lo)}L${x(0)},${y(lo)}Z`, fill: `url(#${id}p)`, class: "g-area" }), S("path", { d: linea, class: "g-linea" }));
  etiquetasAnio(svg, m, W, H, anios, x);
  const b = s.tendTot.pendienteDecada / 10, a0 = s.tendTot.intercepto;
  if (s.tendTot.pendienteDecada !== null) svg.append(S("line", { x1: x(0), y1: y(a0 + b * anios[0]), x2: x(n - 1), y2: y(a0 + b * anios[n - 1]), class: "g-recta g-disc" }));
  cruce(svg, m, W, H, n, x, (i) => y(v[i]), (i) => [String(anios[i]), t("ch.rain.val", { c: fmt(v[i], 0) })]);
  return svg;
}

// 3) Climatología: lluvia media por mes.
export function graficoClima(s, W = 640) {
  const id = `g${++uid}`;
  const H = Math.round(clamp(W * 0.42, 190, 260)), m = { t: 20, r: 12, b: 28, l: 44 };
  const v = s.clim.map((c) => (Number.isFinite(c) ? c : 0)), n = 12, ymax = Math.max(10, ...v) * 1.15;
  const x = (i) => m.l + ((i + 0.5) * (W - m.l - m.r)) / n, y = (val) => H - m.b - (val / ymax) * (H - m.t - m.b);
  const bw = ((W - m.l - m.r) / n) * 0.6;
  const svg = S("svg", { viewBox: `0 0 ${W} ${H}`, class: "grafico", role: "img" });
  svg.append(S("title", {}, t("ch.clim.title", { nombre: s.nombre })), S("desc", {}, t("ch.clim.desc")));
  degradado(svg, `${id}b`, "--c-clima-a", "--c-clima-b");
  ejes(svg, m, W, H, ymax, y, "mm");
  const fm = new Intl.DateTimeFormat(locale(), { month: W < 460 ? "narrow" : "short" });
  v.forEach((c, i) => {
    svg.append(S("rect", { x: x(i) - bw / 2, y: y(c), width: bw, height: Math.max(0, y(0) - y(c)), rx: 4, fill: `url(#${id}b)`, class: "g-barra" }));
    svg.append(S("text", { x: x(i), y: H - 8, "text-anchor": "middle", class: "g-eje" }, fm.format(new Date(2001, i, 1)).replace(".", "")));
  });
  cruce(svg, m, W, H, n, x, (i) => y(v[i]), (i) => [new Intl.DateTimeFormat(locale(), { month: "long" }).format(new Date(2001, i, 1)), t("ch.rain.mean", { c: fmt(v[i], 0) })]);
  return svg;
}

// 4) Mini gráfico de un umbral fijo (curva anual + recta + círculo con el cambio %).
export function miniFijo(s, umbral, W = 240) {
  const k = String(umbral), v = s.fijos[k], tr = s.fijosTend[k];
  const H = 96, m = { t: 8, r: 6, b: 8, l: 6 }, n = v.length;
  const max = Math.max(2, ...v.filter((q) => q !== null)) * 1.1;
  const x = (i) => m.l + (i * (W - m.l - m.r)) / (n - 1), y = (val) => H - m.b - (val / max) * (H - m.t - m.b);
  const svg = S("svg", { viewBox: `0 0 ${W} ${H}`, class: "grafico mini", role: "img" });
  svg.append(S("title", {}, t("ch.fijo.title", { u: fmt(umbral, 1), nombre: s.nombre })));
  const pts = v.map((val, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(val ?? 0).toFixed(1)}`).join("");
  svg.append(S("path", { d: pts, class: "g-linea fino" }));
  if (tr.pendienteDecada !== null) { const b = tr.pendienteDecada / 10; svg.append(S("line", { x1: x(0), y1: y(tr.intercepto + b * s.anios[0]), x2: x(n - 1), y2: y(tr.intercepto + b * s.anios[n - 1]), class: "g-recta fino" })); }
  return svg;
}

// 5) Comparación regional: cambio estimado ± IC 95 % de todos los sitios con datos. Filas clicables.
export function graficoBosque(sitios, W, selId, alElegir) {
  const lista = sitios.filter((q) => q.datos);
  const fila = 46, m = { t: 8, r: 18, b: 44, l: W < 520 ? 96 : 150 };
  const H = m.t + fila * lista.length + m.b;
  const los = lista.map((q) => q.tend.ic95Decada?.[0] ?? q.tend.pendienteDecada), his = lista.map((q) => q.tend.ic95Decada?.[1] ?? q.tend.pendienteDecada);
  const xmin = Math.floor(Math.min(...los, 0) - 1), xmax = Math.ceil(Math.max(...his, 0) + 1);
  const x = (v) => m.l + ((v - xmin) / (xmax - xmin)) * (W - m.l - m.r);
  const g = S("svg", { viewBox: `0 0 ${W} ${H}`, class: "grafico bosque", role: "group", "aria-label": t("ch.bosque") });
  const p = xmax - xmin > 14 ? 4 : 2;
  for (let v = Math.ceil(xmin / p) * p; v <= xmax; v += p) g.append(S("line", { x1: x(v), x2: x(v), y1: m.t, y2: H - m.b, class: v === 0 ? "g-cero" : "g-rejilla" }), S("text", { x: x(v), y: H - m.b + 16, "text-anchor": "middle", class: "g-eje" }, v));
  g.append(S("text", { x: (m.l + W - m.r) / 2, y: H - 6, "text-anchor": "middle", class: "g-eje" }, t("ch.bosque.x")));
  lista.forEach((q, i) => {
    const cy = m.t + fila * i + fila / 2, est = estadoDe(q), [lo, hi] = q.tend.ic95Decada ?? [q.tend.pendienteDecada, q.tend.pendienteDecada];
    const fg = S("g", { class: "fila" + (q.id === selId ? " activa" : ""), tabindex: 0, role: "button", "data-id": q.id,
      "aria-label": t("ch.row", { nombre: q.nombre, estado: est.texto, b: fmt(q.tend.pendienteDecada), lo: fmt(lo), hi: fmt(hi) }) });
    fg.append(S("rect", { x: 0, y: cy - fila / 2 + 2, width: W, height: fila - 4, rx: 12, class: "fila-fondo" }),
      S("text", { x: m.l - 12, y: cy + 4, "text-anchor": "end", class: "g-etiqueta" }, q.nombre),
      S("line", { x1: x(lo), x2: x(hi), y1: cy, y2: cy, style: `stroke:${est.color}`, "stroke-width": 4, "stroke-linecap": "round" }),
      S("circle", { cx: x(q.tend.pendienteDecada), cy, r: 7, style: `fill:${est.color}`, class: "g-borde-punto" }),
      S("text", { x: x(q.tend.pendienteDecada), y: cy - 13, "text-anchor": "middle", class: "g-valor" }, `${est.simbolo} ${fmtS(q.tend.pendienteDecada)}`));
    const abrir = () => alElegir(q.id);
    fg.addEventListener("click", abrir); fg.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); abrir(); } });
    g.append(fg);
  });
  return g;
}
