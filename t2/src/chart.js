// Gráficos SVG sin dependencias. Se redibujan al cambiar el ancho para que el texto siga legible en móvil.
import { t } from "./i18n.js";
import { ESTADO, fmt, nombreCorto, nombreLargo } from "./util.js";

const NS = "http://www.w3.org/2000/svg";
function svg(tag, attrs = {}, texto) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (texto !== undefined) e.textContent = texto;
  return e;
}
const mediana = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// Contenedor que vuelve a dibujar cuando cambia su ancho.
export function montar(clase, dibujar) {
  const caja = document.createElement("div");
  caja.className = clase;
  let ultimo = 0;
  const pintar = () => {
    const w = Math.round(caja.clientWidth);
    if (!w || w === ultimo) return;
    ultimo = w;
    caja.replaceChildren(dibujar(w));
  };
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(pintar).observe(caja);
  else window.addEventListener("resize", pintar);
  requestAnimationFrame(pintar);
  return caja;
}

// Barras de conteo anual + recta de Theil–Sen + franja del periodo base (2001–2020).
export function graficoSerie(sitio, W = 640) {
  const H = Math.round(Math.max(210, Math.min(300, W * 0.5)));
  const m = { t: 14, r: 10, b: 30, l: 34 };
  const { anios, conteos } = sitio;
  const n = anios.length;
  const ymax = Math.max(4, ...conteos) * 1.12;
  const paso = ymax > 40 ? 10 : ymax > 20 ? 5 : 2;
  const x = (i) => m.l + ((i + 0.5) * (W - m.l - m.r)) / n;
  const y = (v) => H - m.b - (v / ymax) * (H - m.t - m.b);
  const bw = Math.max(3, ((W - m.l - m.r) / n) * 0.62);

  const g = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", class: "grafico" });
  g.append(
    svg("title", {}, t("chart.title", { nombre: nombreLargo(sitio) })),
    svg("desc", {}, t("chart.desc", { n, b: fmt(sitio.pendiente_dias_decada) }))
  );

  // Franja del periodo base usado para calcular el umbral
  const ultimoBase = anios.reduce((acc, a, i) => (a <= 2020 ? i : acc), -1);
  if (ultimoBase > 0) {
    const x0 = m.l, x1 = m.l + ((ultimoBase + 1) * (W - m.l - m.r)) / n;
    g.append(svg("rect", { x: x0, y: m.t, width: x1 - x0, height: H - m.t - m.b, class: "base" }));
  }
  for (let v = 0; v <= ymax; v += paso) {
    g.append(
      svg("line", { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: "rejilla-lin" }),
      svg("text", { x: m.l - 6, y: y(v) + 4, "text-anchor": "end", class: "eje" }, v)
    );
  }
  conteos.forEach((c, i) => {
    const r = svg("rect", { x: x(i) - bw / 2, y: y(c), width: bw, height: Math.max(0, y(0) - y(c)), rx: Math.min(3, bw / 3), class: "barra" });
    r.append(svg("title", {}, t("chart.bar", { a: anios[i], c })));
    g.append(r);
  });
  const cada = W < 420 ? 8 : 5;
  anios.forEach((a, i) => {
    if (i % cada === 0 || i === n - 1) g.append(svg("text", { x: x(i), y: H - 10, "text-anchor": "middle", class: "eje" }, a));
  });
  if (typeof sitio.pendiente_dias_decada === "number") {
    const b = sitio.pendiente_dias_decada / 10;
    const a0 = mediana(conteos.map((c, i) => c - b * (anios[i] - anios[0])));
    const f = (i) => a0 + b * (anios[i] - anios[0]);
    g.append(svg("line", { x1: x(0), y1: y(f(0)), x2: x(n - 1), y2: y(f(n - 1)), class: "recta" }));
  }
  return g;
}

// Pendiente ± IC 95 % de todos los sitios (comparación regional). Cada fila es clicable.
export function graficoBosque(sitios, W, seleccionId, onSelect) {
  const fila = 44, m = { t: 8, r: 16, b: 40, l: W < 520 ? 92 : 150 };
  const H = m.t + fila * sitios.length + m.b;
  const los = sitios.map((s) => s.ic95_dias_decada?.[0] ?? s.pendiente_dias_decada);
  const his = sitios.map((s) => s.ic95_dias_decada?.[1] ?? s.pendiente_dias_decada);
  const xmin = Math.floor(Math.min(...los, 0) - 1), xmax = Math.ceil(Math.max(...his, 0) + 1);
  const x = (v) => m.l + ((v - xmin) / (xmax - xmin)) * (W - m.l - m.r);

  const g = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "grafico bosque", role: "group", "aria-label": t("chart.bosque") });
  const paso = xmax - xmin > 14 ? 4 : 2;
  for (let v = Math.ceil(xmin / paso) * paso; v <= xmax; v += paso) {
    g.append(
      svg("line", { x1: x(v), x2: x(v), y1: m.t, y2: H - m.b, class: v === 0 ? "cero" : "rejilla-lin" }),
      svg("text", { x: x(v), y: H - m.b + 16, "text-anchor": "middle", class: "eje" }, v)
    );
  }
  g.append(svg("text", { x: (m.l + W - m.r) / 2, y: H - 6, "text-anchor": "middle", class: "eje" }, t("chart.bosque.x")));

  sitios.forEach((s, i) => {
    const cy = m.t + fila * i + fila / 2;
    const est = ESTADO[s.estado];
    const [lo, hi] = s.ic95_dias_decada ?? [s.pendiente_dias_decada, s.pendiente_dias_decada];
    const fg = svg("g", {
      class: "fila" + (s.id === seleccionId ? " activa" : ""), tabindex: 0, role: "button",
      "aria-label": t("chart.row", { pais: nombreCorto(s), estado: est.texto, b: fmt(s.pendiente_dias_decada), lo: fmt(lo), hi: fmt(hi) }),
      "data-id": s.id,
    });
    fg.append(
      svg("rect", { x: 0, y: cy - fila / 2 + 2, width: W, height: fila - 4, rx: 10, class: "fila-fondo" }),
      svg("text", { x: m.l - 12, y: cy + 4, "text-anchor": "end", class: "etiqueta" }, nombreCorto(s)),
      svg("line", { x1: x(lo), x2: x(hi), y1: cy, y2: cy, stroke: est.color, "stroke-width": 3.5, "stroke-linecap": "round" }),
      svg("circle", { cx: x(s.pendiente_dias_decada), cy, r: 6.5, fill: est.color, stroke: "rgba(255,255,255,.85)", "stroke-width": 2 }),
      svg("text", { x: x(s.pendiente_dias_decada), y: cy - 12, "text-anchor": "middle", class: "valor" }, `${est.simbolo} ${fmt(s.pendiente_dias_decada)}`)
    );
    const abrir = () => onSelect(s.id);
    fg.addEventListener("click", abrir);
    fg.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); abrir(); } });
    g.append(fg);
  });
  return g;
}
