/* Atlas unificado · tema de Phyllobytes para TODAS las figuras Plotly del atlas.
 *
 * Por qué así: el atlas tiene ~40 figuras construidas con colores claros (#fff, tinta #111…). En lugar de
 * reescribirlas, este archivo envuelve Plotly.newPlot / Plotly.react: antes de dibujar, traduce los colores
 * de fondo, texto, ejes y leyendas a la paleta de Phyllobytes (variables CSS, así respeta contraste alto y
 * daltonismo), usa la letra de la página, escala el texto con la opción «letra grande» y añade la marca de
 * agua de Phyllobytes en la esquina superior derecha del área de datos. Los datos, trazos, interacción
 * (zoom, hover, descarga PNG) y la lógica de cada figura no cambian. La descarga PNG incluye la marca.
 */
(function () {
"use strict";
if (!window.Plotly) return;
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const MARCA = "assets/marca-agua.png";
const RATIO = 271 / 952;                       // proporción de marca-agua.png

function paleta() {
  const alto = document.documentElement.dataset.contraste === "alto";
  return {
    fondo: alto ? "#000000" : "#0d1f24",         // sólido: la PNG descargada se lee igual fuera de la página
    texto: css("--texto") || "#eef7f7", suave: css("--suave") || "rgba(226,240,240,.76)",
    marco: alto ? "#ffffff" : "rgba(255,255,255,.30)", rejilla: alto ? "#555555" : "rgba(255,255,255,.09)",
    leyenda: alto ? "#000000" : "rgba(10,26,31,.92)", hover: alto ? "#000000" : "#10272d",
    fuente: css("--fuente") || "system-ui, sans-serif",
  };
}

// Colores "tinta" (casi negros / grises oscuros) que en fondo claro eran texto o líneas neutras.
const OSCUROS = /^(#(0{3}|1{3}|2{3}|3{3}|4{3}|000000|111111|1a1a1a|202020|202b23|222222|2a2a2a|303030|333333|3d3d3d|444444|4d4d4d|555555)|black|rgb\(\s*(\d|[12]\d|3\d)\s*,\s*(\d|[12]\d|3\d)\s*,\s*(\d|[12]\d|3\d)\s*\))$/i;
const CLAROS = /^(#(fff|ffffff|fafafa|f7f7f7|f5f5f5|f7f8f4)|white|rgba?\(\s*255\s*,\s*255\s*,\s*255\s*(,\s*(0?\.9\d*|1(\.0+)?)\s*)?\))$/i;
const GRISES_MARCO = /^#(bdbdbd|c4c4c4|cfcfcf|b8b8b8|9a9a9a|8a8a8a|ebebeb|e6e6e6|eeeeee|dddddd|d9d9d9|cccccc)$/i;

// Velos oscuros semitransparentes (bandas de IC, sombras): en fondo oscuro se vuelven velos claros con la misma opacidad.
const VELO_OSCURO = /^rgba\(\s*(\d{1,2}|1[0-1]\d)\s*,\s*(\d{1,2}|1[0-1]\d)\s*,\s*(\d{1,2}|1[0-1]\d)\s*,\s*(0?\.\d+)\s*\)$/i;

function recolor(v, P, rol) {
  if (typeof v !== "string") return v;
  const c = v.trim();
  const velo = c.match(VELO_OSCURO);
  if (velo) return `rgba(235,247,247,${Math.min(0.35, parseFloat(velo[4]) * 1.4).toFixed(3)})`;
  if (/^#161616$/i.test(c)) return rol === "fondo" ? P.fondo : P.texto;
  if (OSCUROS.test(c)) return rol === "fondo" ? P.fondo : P.texto;
  if (CLAROS.test(c)) return rol === "fondo" ? P.fondo : rol === "linea" ? P.texto : c;
  if (GRISES_MARCO.test(c)) return rol === "rejilla" ? P.rejilla : P.marco;
  return v;
}

// Recorre trazos y layout cambiando SOLO propiedades de color conocidas.
function tematizar(obj, P, escala, ruta = "") {
  if (Array.isArray(obj)) { obj.forEach((x, i) => tematizar(x, P, escala, ruta)); return obj; }
  if (!obj || typeof obj !== "object") return obj;
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v && typeof v === "object") {
      if (k === "font" && !Array.isArray(v)) {
        if (typeof v.color === "string") v.color = recolor(v.color, P, "texto");
        if (typeof v.size === "number" && escala !== 1) v.size = +(v.size * escala).toFixed(1);
        v.family = P.fuente;
      }
      tematizar(v, P, escala, k);
      continue;
    }
    if (typeof v !== "string") continue;
    if (k === "paper_bgcolor" || k === "plot_bgcolor") obj[k] = P.fondo;
    else if (k === "bgcolor") obj[k] = ruta === "legend" ? P.leyenda : ruta === "hoverlabel" ? P.hover : ruta === "modebar" ? "rgba(0,0,0,0)" : recolor(v, P, "fondo");
    else if (k === "gridcolor") obj[k] = recolor(v, P, "rejilla") === v && !OSCUROS.test(v) ? P.rejilla : recolor(v, P, "rejilla");
    else if (k === "linecolor" || k === "tickcolor" || k === "zerolinecolor" || k === "bordercolor") obj[k] = recolor(v, P, "marco");
    else if (k === "color" || k === "fillcolor" || k === "outliercolor") obj[k] = recolor(v, P, ruta === "line" || ruta === "marker" ? "linea" : "texto");
  }
  return obj;
}

function conMarca(layout) {
  const imgs = (layout.images || []).filter((im) => im.name !== "marca-phyllobytes");
  const w = 0.17;
  // Si la figura lleva el círculo de % arriba a la derecha (paneles de umbral, tendencia anual), la marca va a la izquierda.
  const circulo = (layout.shapes || []).some((sh) => sh.type === "circle" && sh.xsizemode === "pixel");
  const izq = circulo;
  imgs.push({ name: "marca-phyllobytes", source: MARCA, xref: "paper", yref: "paper", x: izq ? 0.005 : 0.995, y: 0.99, xanchor: izq ? "left" : "right", yanchor: "top",
    sizex: w, sizey: w * RATIO * 2.2, sizing: "contain", opacity: 0.22, layer: "below" });
  layout.images = imgs;
  return layout;
}

/* ---------- traducción de los textos de la figura (solo en inglés) ---------- */
const enIngles = () => !!(window.PHY && PHY.i18n && PHY.i18n.getLang && PHY.i18n.getLang() === "en" && PHY.traductor);
// Los subtítulos vienen partidos en líneas (<br>) a mitad de frase: se unen, se traducen y se vuelven a partir.
function traducirConLineas(txt) {
  const T = PHY.traductor.traducir;
  if (typeof txt !== "string" || !txt.includes("<br>")) return T(txt);
  const lineas = txt.split("<br>");
  const conEtiqueta = [], planas = [];
  for (const l of lineas) (/^\s*<span/.test(l) || (planas.length === 0 && /^\s*<b>/.test(l)) ? conEtiqueta : planas).push(l);
  if (!planas.length) return lineas.map(T).join("<br>");
  const ancho = Math.max(40, ...planas.map((l) => l.replace(/<[^>]+>/g, "").length));
  const unido = T(planas.join(" ").replace(/\s+/g, " "));
  const out = []; let linea = "";
  for (const w of unido.split(" ")) { if ((linea + " " + w).trim().length > ancho) { out.push(linea.trim()); linea = w; } else linea += " " + w; }
  if (linea.trim()) out.push(linea.trim());
  return conEtiqueta.map(T).concat(out).join("<br>");
}
const CAMPOS_TEXTO = new Set(["text", "name", "hovertemplate", "texttemplate"]);
function traducirFigura(obj, clave = "") {
  if (Array.isArray(obj)) {
    if ((clave === "ticktext" || clave === "text") && obj.every((x) => typeof x !== "object")) return obj.map((x) => (typeof x === "string" ? PHY.traductor.traducir(x) : x));
    obj.forEach((x) => traducirFigura(x, clave)); return obj;
  }
  if (!obj || typeof obj !== "object") return obj;
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    // Solo los títulos/subtítulos se unen y se vuelven a partir; textos emergentes y nombres se traducen línea por línea.
    if (typeof v === "string" && (CAMPOS_TEXTO.has(k) || k === "title")) obj[k] = (k === "title" || (k === "text" && (clave === "title" || clave === "subtitle"))) ? traducirConLineas(v) : PHY.traductor.traducir(v);
    else if (Array.isArray(v) && (k === "ticktext" || (k === "text" && v.every((x) => typeof x !== "object")))) obj[k] = traducirFigura(v, k);
    else if (Array.isArray(v) && (k === "x" || k === "y") && v.length && v.length <= 40 && v.every((x) => typeof x === "string" && /\p{L}/u.test(x) && x.length <= 30)) obj[k] = v.map((x) => PHY.traductor.traducir(x));
    else if (v && typeof v === "object" && !["customdata", "z", "colorscale"].includes(k)) traducirFigura(v, k);
  }
  return obj;
}

function preparar(gd, data, layout, config) {
  // Figuras «sin ejes» muy pequeñas (sparklines de tarjetas) no llevan marca: no cabe y taparía el dato.
  const P = paleta();
  const escala = (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16) / 16;
  const lo = tematizar(JSON.parse(JSON.stringify(layout || {})), P, escala);
  lo.paper_bgcolor = P.fondo; lo.plot_bgcolor = P.fondo;
  lo.font = { ...(lo.font || {}), family: P.fuente, color: (lo.font && lo.font.color) || P.texto };
  lo.hoverlabel = { ...(lo.hoverlabel || {}), bgcolor: P.hover, bordercolor: P.marco, font: { ...((lo.hoverlabel || {}).font || {}), color: P.texto, family: P.fuente } };
  lo.modebar = { ...(lo.modebar || {}), bgcolor: "rgba(0,0,0,0)", color: P.suave, activecolor: P.texto };
  const alto = (gd && gd.clientHeight) || lo.height || 400;
  if (alto >= 170) conMarca(lo);
  let tr = tematizar(Array.isArray(data) ? data.map((t) => ({ ...t })) : data, P, 1);
  if (enIngles()) { traducirFigura(lo); tr = Array.isArray(tr) ? tr.map((t) => traducirFigura(JSON.parse(JSON.stringify(t, (k, v) => (v instanceof Float64Array ? Array.from(v) : v))))) : tr; }
  const cfg = { ...(config || {}) };
  if (cfg.toImageButtonOptions) cfg.toImageButtonOptions = { ...cfg.toImageButtonOptions, filename: String(cfg.toImageButtonOptions.filename || "grafico").replace(/^NASA_/, "Phyllobytes_") };
  return [tr, lo, cfg];
}

const original = { newPlot: Plotly.newPlot.bind(Plotly), react: Plotly.react.bind(Plotly) };
Plotly.newPlot = function (gd, data, layout, config) {
  if (data && !Array.isArray(data) && data.data) return original.newPlot(gd, ...preparar(typeof gd === "string" ? document.getElementById(gd) : gd, data.data, data.layout, data.config));
  return original.newPlot(gd, ...preparar(typeof gd === "string" ? document.getElementById(gd) : gd, data, layout, config));
};
Plotly.react = function (gd, data, layout, config) {
  if (data && !Array.isArray(data) && data.data) return original.react(gd, ...preparar(typeof gd === "string" ? document.getElementById(gd) : gd, data.data, data.layout, data.config));
  return original.react(gd, ...preparar(typeof gd === "string" ? document.getElementById(gd) : gd, data, layout, config));
};
window.PHY = window.PHY || {};
PHY.temaPlotly = { paleta, tematizar };
})();
