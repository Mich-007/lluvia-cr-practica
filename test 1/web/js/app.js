// Phyllobytes · aplicación principal. Une el mapa, los datos (demostración o NASA vía servidor), las gráficas y el asistente.
import { t, aplicar, setLang, onLang, getLang } from "./i18n.js";
import { $, el, estadoDe, ESTADO, fmt, fmtP, fmtS, rango, coordTxt, descarga } from "./util.js";
import { PROVINCIAS, dentroDeCR, provinciaDe, distKm } from "./geo.js";
import { sitiosDemo, sitioPendiente, desdeServidor, enriquecer, valorIndicador, UMBRALES, SITIOS_BASE } from "./modelo.js";
import { renderCalor, RAMPAS, modoPaleta, colorEn, rgb } from "./calor.js";
import { crearMapa } from "./mapa.js";
import { montar, graficoExtremos, graficoLluvia, graficoClima, miniFijo, graficoBosque } from "./charts.js";
import { lectura, resumenRegional, fichaTexto, provNombre } from "./texto.js";
import { crearAsistente } from "./asistente.js";
import * as a11y from "./a11y.js";
import { FUENTES, descargar, calcular } from "./nasa.js";

const MAX = 8;
const E = { sitios: [], sel: null, demo: true, servidor: false, ind: "extremos", anio: "todos", estilo: "bandas", lugares: [], n: 0, jobId: null, resultado: null, analizando: false };
let mapa, mini, asistente, msgTimer = 0, calorTimer = 0;
const actual = () => E.sitios.find((s) => s.id === E.sel) ?? null;
const conDatos = () => E.sitios.filter((s) => s.datos);

/* ---------------- servidor (backend.py) ---------------- */
async function api(ruta, opciones = {}, ms = 8000) {
  const c = new AbortController(), id = setTimeout(() => c.abort(), ms);
  try { const r = await fetch(ruta, { ...opciones, signal: c.signal, cache: "no-store" }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`); return j; } finally { clearTimeout(id); }
}
async function revisarServidor() {
  E.servidor = false;
  if (location.protocol.startsWith("http")) { try { const h = await api("/api/health", {}, 1800); E.servidor = h.status === "ok" && String(h.version).startsWith("phyllobytes"); } catch { /* sin servidor */ } }
  const chip = $("chip-servidor");
  chip.classList.toggle("ok", E.servidor);
  chip.querySelector("span").textContent = t(E.servidor ? "srv.ok" : "srv.web");
  pintarNotaAnalisis();
}

/* ---------------- mensajes y pequeñas utilidades ---------------- */
function msg(texto, error = false) {
  const m = $("mensaje-puntos"); m.textContent = texto; m.classList.toggle("error", error);
  clearTimeout(msgTimer); if (texto) msgTimer = setTimeout(() => (m.textContent = ""), 9000);
}
const nombrePunto = (lat, lon, prov) => {
  const cerca = E.lugares.map((p) => ({ p, d: distKm(lat, lon, p.lat, p.lon) })).sort((a, b) => a.d - b.d)[0];
  if (cerca && cerca.d <= 8) return cerca.d <= 1.5 ? cerca.p.name : t("pts.near", { n: cerca.p.name });
  return t("pts.custom", { n: E.n + 1, prov: prov?.nombre ?? "" }).trim();
};
const fuenteTxt = () => (E.demo ? t("src.demo") : `NASA POWER · ${E.resultado?.source_label ?? "GPM IMERG"}`);

/* ---------------- puntos ---------------- */
function agregarPunto(lat, lon, nombre) {
  const prov = provinciaDe(lat, lon);
  if (!prov) return msg(t("pts.outside"), true);
  if (E.sitios.length >= MAX) return msg(t("pts.max", { n: MAX }), true);
  const igual = E.sitios.find((s) => Math.abs(s.lat - lat) < 0.02 && Math.abs(s.lon - lon) < 0.02);
  if (igual) { seleccionar(igual.id, { verDetalle: true }); return msg(t("pts.dup"), false); }
  const nom = nombre ?? nombrePunto(lat, lon, prov);
  E.n++;
  const s = sitioPendiente(`P${E.n}`, nom, +lat.toFixed(4), +lon.toFixed(4));
  E.sitios.push(s);
  seleccionar(s.id, { verDetalle: true });
  renderTodo();
  msg(t("pts.added", { n: s.nombre }));
}
function quitarPunto(id) {
  E.sitios = E.sitios.filter((s) => s.id !== id);
  if (E.sel === id) E.sel = E.sitios[0]?.id ?? null;
  renderTodo();
}

/* ---------------- selección ---------------- */
function seleccionar(id, o = {}) {
  const s = E.sitios.find((x) => x.id === id);
  if (!s) return;
  E.sel = id;
  pintarPines(); pintarLista(); pintarDetalle();
  document.querySelectorAll("#bosque .fila").forEach((f) => f.classList.toggle("activa", f.dataset.id === id));
  mapa.marcarProvincia(s.prov);
  if (!o.sinMover) mapa.centrarEn(s.lat, s.lon);
  const lento = document.documentElement.dataset.movimiento === "reducido" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const comportamiento = lento ? "auto" : "smooth";
  if (o.desplazar) $("resultados").scrollIntoView({ behavior: comportamiento, block: "start" });
  else if (o.verDetalle && window.innerWidth < 1180) $("resultados").scrollIntoView({ behavior: comportamiento, block: "start" });
}

/* ---------------- pintado ---------------- */
const descrPin = (s) => { const e = estadoDe(s); return { color: e.color, simbolo: e.simbolo, aria: t("map.pin_aria", { nombre: s.nombre, estado: e.texto }) }; };
function pintarPines() { mapa.puntos(E.sitios, E.sel, descrPin); mini.puntos(E.sitios, E.sel, descrPin); }

function pintarKpis() {
  const c = conDatos(), n = (e) => c.filter((s) => s.estado === e).length;
  const mExt = c.length ? c.reduce((a, s) => a + s.extMedia, 0) / c.length : null, mLl = c.length ? c.reduce((a, s) => a + s.totMedia, 0) / c.length : null;
  const k = [
    [t("kpi.points"), `${c.length}`, t("kpi.points.s", { r: c.length ? rango(c[0]) : "—" })],
    [t("kpi.up"), String(n("creciente")), t("kpi.evid"), ESTADO.creciente.color], [t("kpi.dn"), String(n("decreciente")), t("kpi.evid"), ESTADO.decreciente.color], [t("kpi.nc"), String(n("no_concluyente")), t("kpi.nc.s"), ESTADO.no_concluyente.color],
    [t("kpi.ext"), fmt(mExt), t("kpi.ext.s")], [t("kpi.rain"), fmt(mLl, 0), t("kpi.rain.s")],
  ];
  $("kpis").replaceChildren(...k.map(([ti, v, sub, col]) => { const nu = el("strong", {}, v); if (col) nu.style.color = col; return el("div", { class: "kpi" }, el("span", { class: "sub" }, ti), nu, el("span", { class: "sub" }, sub)); }));
  const cont = (e) => c.filter((s) => s.estado === e).length;
  $("hero-resumen").replaceChildren(...["creciente", "decreciente", "no_concluyente"].map((e) => { const sw = el("span", { class: "muestra", "aria-hidden": "true" }); sw.style.background = ESTADO[e].color; return el("li", {}, sw, el("strong", {}, String(cont(e))), el("span", {}, ESTADO[e].corto)); }));
}

function pintarLeyendaEstados() {
  $("leyenda").replaceChildren(...["creciente", "decreciente", "no_concluyente", "pendiente"].map((e) => { const sw = el("span", { class: "muestra", "aria-hidden": "true" }); sw.style.background = ESTADO[e].color; return el("li", {}, sw, `${ESTADO[e].simbolo} ${ESTADO[e].texto}`); }));
}

function pintarLista() {
  $("contador").textContent = `${E.sitios.length}/${MAX}`;
  $("lista-puntos").replaceChildren(...E.sitios.map((s, i) => {
    const e = estadoDe(s), q = el("button", { type: "button", class: "quitar", "aria-label": t("pts.remove", { n: s.nombre }), onclick: (ev) => { ev.stopPropagation(); quitarPunto(s.id); } }, "✕");
    const li = el("li", { class: "punto" + (s.id === E.sel ? " sel" : ""), "data-id": s.id, tabindex: 0, role: "button", "aria-pressed": String(s.id === E.sel), "aria-label": `${s.nombre}. ${e.texto}` },
      el("span", { class: "num" }, String(i + 1)), el("span", { class: "nom" }, el("strong", {}, s.nombre), el("span", {}, `${provNombre(s.prov) ?? "—"} · ${coordTxt(s.lat, s.lon)}`)), el("span", { class: "est", "aria-hidden": "true" }, e.simbolo), q);
    li.addEventListener("click", () => seleccionar(s.id, { verDetalle: true }));
    li.addEventListener("keydown", (ev) => { if (ev.target === li && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); seleccionar(s.id, { verDetalle: true }); } });
    return li;
  }));
}

/* ---- controles del mapa de calor ---- */
const INDICADORES = () => [
  ["extremos", t("ind.ext"), t("unit.dias_anio")], ["tendencia", t("ind.trend"), t("unit.dias_dec")], ["lluvia", t("ind.rain"), t("unit.mm_anio")],
  ...UMBRALES.map((u) => [`fijo:${u}`, t("ind.fijo", { u: fmt(u, 1) }), t("unit.dias_anio")]),
];
function llenarControles() {
  const si = $("sel-ind"), sa = $("sel-anio"), ind0 = E.ind, an0 = E.anio;
  si.replaceChildren(...INDICADORES().map(([v, l]) => el("option", { value: v }, l))); si.value = ind0;
  const anios = [...new Set(conDatos().flatMap((s) => s.anios))].sort((a, b) => b - a);
  sa.replaceChildren(el("option", { value: "todos" }, t("map.all_years")), ...anios.map((a) => el("option", { value: String(a) }, String(a))));
  sa.value = anios.includes(Number(an0)) || an0 === "todos" ? an0 : "todos"; E.anio = sa.value;
  sa.disabled = E.ind === "tendencia";
  document.querySelectorAll(".seg button[data-estilo]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.estilo === E.estilo)));
}
function pintarCalor() {
  cancelAnimationFrame(calorTimer);
  calorTimer = requestAnimationFrame(() => {
    const [, etiqueta, unidad] = INDICADORES().find(([v]) => v === E.ind) ?? INDICADORES()[0];
    const pts = conDatos().map((s) => ({ lat: s.lat, lon: s.lon, v: valorIndicador(s, E.ind, E.anio) }));
    const res = E.estilo === "off" ? null : renderCalor(pts, { divergente: E.ind === "tendencia", estilo: E.estilo });
    mapa.verCalor(res); mini.verCalor(res);
    const box = $("leyenda-calor"); box.replaceChildren();
    if (E.estilo === "off") return;
    if (!res) { box.append(el("p", { class: "nota" }, t("heat.need"))); return; }
    const stops = res.rampa, N = res.niveles;
    const barra = res.estilo === "bandas"
      ? el("div", { class: "barra-color bandas", role: "img", "aria-label": etiqueta }, ...Array.from({ length: N }, (_, i) => { const x = el("i"); x.style.background = rgb(colorEn(stops, (i + 0.5) / N)); return x; }))
      : el("div", { class: "barra-color", role: "img", "aria-label": etiqueta });
    if (res.estilo !== "bandas") barra.style.background = `linear-gradient(90deg, ${stops.join(",")})`;
    const extremos = el("div", { class: "extremos" }, el("span", {}, `${fmtS(res.divergente ? res.vmin : res.vmin, 1).replace("+", "")} ${unidad}`), res.divergente ? el("span", {}, "0") : null, el("span", {}, `${res.divergente ? fmtS(res.vmax) : fmt(res.vmax, 1)} ${unidad}`));
    box.append(el("strong", {}, etiqueta), barra, extremos, el("p", { class: "nota" }, t("heat.note", { n: pts.filter((p) => Number.isFinite(p.v)).length })));
  });
}

/* ---- detalle del punto ---- */
const tile = (ti, v, sub) => el("div", { class: "tile" }, el("span", { class: "sub" }, ti), el("strong", {}, v), sub ? el("span", { class: "sub" }, sub) : null);
function pintarDetalle() {
  const s = actual(), cont = $("detalle");
  if (!s) { cont.replaceChildren(el("div", { class: "vacio" }, el("strong", {}, t("det.none.t")), t("det.none.d"))); return; }
  const e = estadoDe(s), badge = el("span", { class: "badge" }, `${e.simbolo} ${e.texto}`); badge.style.setProperty("--c", e.color);
  const cab = el("div", { class: "detalle-cab" }, el("div", {}, el("h3", {}, s.nombre), el("p", { class: "sub" }, `${provNombre(s.prov) ?? "—"} · ${coordTxt(s.lat, s.lon)}`)), badge);
  if (!s.datos) {
    const btn = el("button", { type: "button", class: "btn btn-cian", onclick: () => { $("puntos-panel").scrollIntoView({ behavior: "smooth", block: "center" }); $("btn-analizar").focus(); } }, t("det.go_analyze"));
    cont.replaceChildren(cab, el("p", { class: "lectura" }, lectura(s)), el("div", { class: "detalle-pie" }, btn)); return;
  }
  const [lo, hi] = s.tend.ic95Decada ?? [];
  const tiles = el("div", { class: "tiles" },
    tile(t("det.change"), fmtS(s.tend.pendienteDecada), t("det.change.s")), tile(t("det.ci"), lo !== undefined ? `${fmt(lo)} / ${fmt(hi)}` : "—", t("det.ci.s")),
    tile(t("det.p"), fmtP(s.pHolm), s.pHolm < 0.05 ? t("det.p.lt") : t("det.p.ge")), tile(t("det.thr"), fmt(s.umbral, 1), t("det.thr.s")),
    tile(t("det.ext_mean"), fmt(s.extMedia), t("det.ext_mean.s")), tile(t("det.rain_mean"), fmt(s.totMedia, 0), t("det.rain_mean.s")),
    tile(t("det.years"), String(s.anios.length), rango(s)), tile(t("det.cov"), s.cobertura != null ? `${fmt(s.cobertura)} %` : "—", t("det.cov.s")));
  const leyG = el("ul", { class: "leyenda leyenda-g" }, el("li", {}, el("span", { class: "muestra barra-m", "aria-hidden": "true" }), t("leg.bars")), el("li", {}, el("span", { class: "muestra linea-m", "aria-hidden": "true" }), t("leg.line")), el("li", {}, el("span", { class: "muestra base-m", "aria-hidden": "true" }), t("leg.base")));
  const graf = (clase, titulo, sub, nodo, extra) => el("div", { class: `graf ${clase}` }, el("h4", {}, titulo), el("p", { class: "sub" }, sub), nodo, extra);
  const fijos = el("div", { class: "fijos" }, ...UMBRALES.map((u) => {
    const tr = s.fijosTend[String(u)], pct = tr.cambioPct, col = tr.p !== null && tr.p < 0.05 ? (tr.pendienteDecada > 0 ? ESTADO.creciente.color : ESTADO.decreciente.color) : ESTADO.no_concluyente.color;
    const c = el("span", { class: "pct", "aria-hidden": "true" }, pct === null ? "—" : `${pct > 0 ? "+" : ""}${Math.round(pct)}%`); c.style.setProperty("--c", col);
    return el("div", { class: "fijo" }, el("div", { class: "cab" }, el("strong", {}, `≥ ${fmt(u, 1)} mm`), c), el("span", { class: "sub" }, t("fijo.mean", { m: fmt(tr.media, 1) })),
      montar("mini-caja", (w) => miniFijo(s, u, w)), el("span", { class: "sub" }, t("fijo.trend", { b: fmtS(tr.pendienteDecada, 2), p: tr.p === null ? "—" : fmtP(tr.p) })));
  }));
  const copiar = el("button", { type: "button", class: "btn btn-cian" }, t("copy.btn"));
  copiar.addEventListener("click", async () => { try { await navigator.clipboard.writeText(fichaTexto(s, fuenteTxt())); copiar.textContent = t("copy.ok"); } catch { copiar.textContent = t("copy.fail"); } setTimeout(() => (copiar.textContent = t("copy.btn")), 2200); });
  const csv = el("button", { type: "button", class: "btn btn-fantasma", onclick: () => descarga(`phyllobytes_${s.nombre.replace(/[^\w]+/g, "_")}.csv`, csvDe(s), "text/csv") }, t("csv.btn"));
  const tabla = el("table", { class: "tabla" }, el("caption", {}, t("tab.cap")),
    el("thead", {}, el("tr", {}, el("th", { scope: "col" }, t("tab.year")), el("th", { scope: "col" }, t("tab.ext")), el("th", { scope: "col" }, t("tab.rain")))),
    el("tbody", {}, ...s.anios.map((a, i) => el("tr", {}, el("th", { scope: "row" }, String(a)), el("td", {}, String(s.extremos[i])), el("td", {}, fmt(s.totales[i], 0))))));
  cont.replaceChildren(cab, el("p", { class: "lectura" }, lectura(s)), tiles,
    el("div", { class: "graf-grid" },
      graf("g-ancho", t("g.ext.t"), t("g.ext.d", { u: fmt(s.umbral, 1) }), montar("grafico-caja", (w) => graficoExtremos(s, w)), leyG),
      graf("", t("g.rain.t"), t("g.rain.d"), montar("grafico-caja", (w) => graficoLluvia(s, w))),
      graf("", t("g.clim.t"), t("g.clim.d"), montar("grafico-caja", (w) => graficoClima(s, w))),
      graf("g-ancho", t("g.fijo.t"), t("g.fijo.d"), fijos)),
    el("div", { class: "detalle-pie" }, copiar, csv), el("details", { class: "datos-tabla" }, el("summary", {}, t("tab.sum")), tabla));
}
function csvDe(s) {
  const cab = ["year", "extreme_days_p95", "total_mm", ...UMBRALES.map((u) => `days_ge_${u}_mm`)];
  const filas = s.anios.map((a, i) => [a, s.extremos[i], s.totales[i], ...UMBRALES.map((u) => s.fijos[String(u)][i])]);
  return [`# Phyllobytes · ${s.nombre} · ${s.lat}, ${s.lon} · ${fuenteTxt()}`, cab.join(";"), ...filas.map((f) => f.join(";"))].join("\n");
}

/* ---- comparación ---- */
function pintarComparacion() {
  $("bosque").replaceChildren(conDatos().length ? montar("grafico-caja", (w) => graficoBosque(E.sitios, w, E.sel, (id) => seleccionar(id, { desplazar: true }))) : el("div", { class: "vacio" }, el("strong", {}, t("det.none.t")), t("cmp.none")));
  const c = conDatos();
  $("tabla-sitios").replaceChildren(el("table", { class: "tabla sitios" }, el("caption", {}, t("cmp.cap")),
    el("thead", {}, el("tr", {}, ...["cmp.point", "cmp.prov", "cmp.ext", "cmp.change", "cmp.ci", "cmp.p", "cmp.state"].map((k) => el("th", { scope: "col" }, t(k))))),
    el("tbody", {}, ...c.map((s) => { const e = estadoDe(s); return el("tr", {}, el("th", { scope: "row" }, el("button", { type: "button", class: "enlace-btn", onclick: () => seleccionar(s.id, { desplazar: true }) }, s.nombre)), el("td", {}, provNombre(s.prov) ?? "—"), el("td", {}, fmt(s.extMedia)), el("td", {}, fmtS(s.tend.pendienteDecada)), el("td", {}, `${fmt(s.tend.ic95Decada?.[0])} / ${fmt(s.tend.ic95Decada?.[1])}`), el("td", {}, fmtP(s.pHolm)), el("td", {}, `${e.simbolo} ${e.texto}`)); }))));
}

/* ---- aprende ---- */
function pintarAprende() {
  const pasos = [1, 2, 3, 4, 5].map((n) => el("li", {}, el("strong", {}, t(`apr.flow.${n}.t`)), el("span", {}, t(`apr.flow.${n}.d`))));
  const uso = [1, 2, 3, 4].map((n) => el("li", {}, t(`apr.use.${n}`)));
  const gl = ["extremo", "percentil", "tendencia", "intervalo", "pvalor", "celda", "calor", "demo"].map((k) => el("div", {}, el("dt", {}, t(`apr.g.${k}.t`)), el("dd", {}, t(`apr.g.${k}.d`))));
  const preguntar = el("button", { type: "button", class: "btn btn-cian", onclick: () => asistente.abrir() }, t("apr.cta.btn"));
  $("aprende-contenido").replaceChildren(
    el("div", { class: "aprende-grid" },
      el("div", { class: "panel g-2 apr-intro" }, el("img", { src: "assets/rana.png", alt: "", width: 96, height: 114 }), el("div", {}, el("h3", {}, t("apr.intro.t")), el("p", {}, t("apr.intro.p")))),
      el("div", { class: "panel" }, el("h3", {}, t("apr.flow.h")), el("p", { class: "sub", style: "margin:.3rem 0 1rem" }, t("apr.flow.sub")), el("ol", { class: "camino" }, ...pasos)),
      el("div", { class: "panel" }, el("h3", {}, t("apr.use.h")), el("p", { class: "sub", style: "margin:.3rem 0 1rem" }, t("apr.use.sub")), el("ol", { class: "cuatro", style: "grid-template-columns:1fr" }, ...uso),
        el("h3", { style: "margin-top:1.4rem" }, t("apr.heat.h")), el("p", { style: "margin:.4rem 0" }, t("apr.heat.p1")), el("p", { class: "sub" }, t("apr.heat.p2"))),
      el("div", { class: "panel g-2" }, el("h3", {}, t("apr.gloss.h")), el("dl", { class: "glosario", style: "margin-top:.8rem;grid-template-columns:repeat(auto-fit,minmax(15rem,1fr))" }, ...gl)),
      el("div", { class: "consejo g-2" }, el("b", { "aria-hidden": "true" }, "●"), el("p", {}, t("apr.eco"))),
      el("div", { class: "panel g-2 apr-cta" }, el("p", {}, t("apr.cta.t")), preguntar)));
}

/* ---- método y fuente ---- */
function pintarMetodo() {
  $("pasos").replaceChildren(...[1, 2, 3, 4].map((n) => el("li", { class: "panel" }, el("h3", {}, t(`paso${n}.t`)), el("p", {}, t(`paso${n}.d`)))));
  $("lista-si").replaceChildren(...[1, 2, 3].map((n) => el("li", {}, t(`si${n}`))));
  $("lista-no").replaceChildren(...[1, 2, 3, 4].map((n) => el("li", {}, t(`no${n}`))));
  const r = E.resultado, c = conDatos()[0];
  const items = [[t("src.product"), fuenteTxt()], [t("src.res"), t("src.resv")], [t("src.period"), c ? rango(c) : "—"], [t("src.unit"), "mm/día"],
    [t("src.generated"), E.demo ? t("src.demo_gen") : (r?.generated_at ?? "—").replace("T", " ")]];
  $("metodo-lista").replaceChildren(...items.map(([k, v]) => el("li", {}, el("span", { class: "sub" }, k), el("strong", {}, v))), el("li", { class: "nota-f" }, el("span", { class: "sub" }, t("src.note")), el("strong", {}, E.demo ? t("src.demo_note") : t("src.real_note"))));
  $("pie-fuente").textContent = t("foot.data", { f: fuenteTxt() });
}
function pintarAviso() {
  const a = $("aviso-demo"); a.hidden = !E.demo;
  if (E.demo) a.textContent = t(E.servidor ? "aviso.demo.srv" : "aviso.demo.nosrv");
}
function pintarNotaAnalisis() {
  $("nota-analisis").textContent = t(E.servidor ? "an.note.ok" : "an.note.off");
  $("btn-demo").hidden = E.demo;
  pintarAviso();
}

/* ---------------- análisis real (servidor Python → NASA POWER) ---------------- */
async function analizar() {
  if (E.analizando) return;
  if (!E.servidor) await revisarServidor();
  if (!E.sitios.length) return msg(t("an.nopoints"), true);
  const ini = parseInt($("in-ini").value, 10), fin = parseInt($("in-fin").value, 10);
  if (!(ini >= 1998 && fin >= ini + 12 && fin <= new Date().getFullYear())) return msg(t("an.years"), true);
  const cuerpo = { source: $("sel-fuente").value, start_year: ini, end_year: fin, ref_start: ini, ref_end: Math.min(fin, ini + 19), population: "wet", wet_min: 1, points: E.sitios.map((s) => ({ name: s.nombre, lat: s.lat, lon: s.lon })) };
  E.analizando = true; $("btn-analizar").disabled = true; $("progreso").hidden = false; $("barra-prog").style.width = "4%"; $("texto-prog").textContent = t("an.starting"); $("descargas").hidden = true;
  try {
    if (!E.servidor) { await analizarDirecto(cuerpo); return; }
    const { job_id: id } = await api("/api/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) }, 15000);
    for (;;) {
      await new Promise((r) => setTimeout(r, 1600));
      const j = await api(`/api/status?id=${encodeURIComponent(id)}`, {}, 10000);
      const hechos = (j.progress ?? []).filter((l) => l.startsWith("Calculados")).length;
      $("barra-prog").style.width = `${Math.max(6, Math.round((100 * (hechos + (j.state === "running" ? 0.35 : 0))) / E.sitios.length))}%`;
      $("texto-prog").textContent = t("an.progress", { a: Math.min(hechos + 1, E.sitios.length), b: E.sitios.length }) + " " + (j.progress?.[j.progress.length - 1] ?? "");
      if (j.state === "error") throw new Error(j.error ?? "error");
      if (j.state === "done") { terminarAnalisis(id, j.result); break; }
    }
  } catch (err) { msg(t(E.servidor ? "an.error" : "an.web_error", { m: err.message }), true); $("progreso").hidden = true; }
  finally { E.analizando = false; $("btn-analizar").disabled = false; }
}
function terminarAnalisis(id, out) {
  const previos = E.sitios;
  E.sitios = out.points.map((p, i) => ({ ...desdeServidor(p, previos[i]?.id ?? `P${++E.n}`), nombre: previos[i]?.nombre ?? p.name }));
  enriquecer(E.sitios);
  E.demo = false; E.resultado = out; E.jobId = id;
  if (!E.sitios.some((s) => s.id === E.sel)) E.sel = E.sitios[0]?.id ?? null;
  $("barra-prog").style.width = "100%"; $("texto-prog").textContent = t("an.done");
  const nombres = (out.exports ?? []).map((x) => x.name);
  const zip = nombres.find((n) => n.endsWith(".zip"));
  const enlaces = [];
  if (zip) enlaces.push(el("a", { href: `/api/download?id=${id}&name=${encodeURIComponent(zip)}`, download: zip }, `⬇ ${t("an.dl_zip")}`));
  nombres.filter((n) => n !== zip).slice(0, 3).forEach((n) => enlaces.push(el("a", { href: `/api/download?id=${id}&name=${encodeURIComponent(n)}`, download: n }, `⬇ ${n}`)));
  $("descargas").replaceChildren(...enlaces); $("descargas").hidden = !enlaces.length;
  renderTodo(); msg(t("an.ok", { n: E.sitios.length }));
  $("resultados").scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ---------------- análisis directo en el navegador (sin servidor de Python) ---------------- */
const leerCache = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const guardarCache = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } };
async function analizarDirecto(c) {
  const cfg = FUENTES[c.source], n = E.sitios.length, res = [];
  if (c.start_year < cfg.min) throw new Error(t("an.min_year", { y: cfg.min }));
  for (let i = 0; i < n; i++) {
    const s = E.sitios[i], clave = `phy-web:${c.source}:${s.lat}:${s.lon}:${c.start_year}-${c.end_year}`;
    let r = leerCache(clave);
    if (!r) {
      const datos = await descargar(c.source, s.lat, s.lon, c.start_year, c.end_year, (b, tot, rango) => {
        $("barra-prog").style.width = `${Math.max(6, Math.round((100 * (i + b / tot)) / n))}%`;
        $("texto-prog").textContent = `${t("an.progress", { a: i + 1, b: n })} ${rango ? t("an.web_dl", { a: rango[0], b: rango[1] }) : ""}`;
      });
      r = calcular(datos, c.start_year, c.end_year, c.ref_start, c.ref_end, 1);
      guardarCache(clave, r);
    }
    if (!r.anios.length) throw new Error(t("an.nodata", { n: s.nombre }));
    res.push(r);
  }
  E.sitios = E.sitios.map((s, i) => ({ id: s.id, nombre: s.nombre, lat: s.lat, lon: s.lon, prov: s.prov, demo: false, datos: true, ...res[i] }));
  enriquecer(E.sitios);
  E.demo = false; E.jobId = null; E.resultado = { source_label: cfg.label, generated_at: new Date().toISOString().slice(0, 19), web: true };
  $("barra-prog").style.width = "100%"; $("texto-prog").textContent = t("an.done"); $("descargas").hidden = true;
  renderTodo(); msg(t("an.ok", { n: E.sitios.length }));
  $("resultados").scrollIntoView({ behavior: "smooth", block: "start" });
}

function volverDemo() {
  E.sitios = enriquecer(sitiosDemo()); E.demo = true; E.resultado = null; E.sel = E.sitios[0].id; E.n = 0;
  $("descargas").hidden = true; $("progreso").hidden = true; renderTodo();
}

/* ---------------- búsqueda y coordenadas ---------------- */
function buscarLugar(ev) {
  ev.preventDefault();
  const q = $("buscar").value.trim(); if (!q) return;
  const n = (x) => x.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const p = E.lugares.find((l) => n(l.name) === n(q)) ?? E.lugares.find((l) => n(l.name).includes(n(q)));
  if (!p) return msg(t("pts.notfound"), true);
  $("buscar").value = ""; agregarPunto(p.lat, p.lon, p.name);
}
function añadirCoords(ev) {
  ev.preventDefault();
  const num = (v) => parseFloat(String(v).replace(",", ".").trim());
  let lat = num($("in-lat").value), lon = num($("in-lon").value);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return msg(t("pts.badcoord"), true);
  if (lon > 0) lon = -lon; // se acepta longitud escrita como "84.08"
  if (!dentroDeCR(lat, lon)) return msg(t("pts.outside"), true);
  $("in-lat").value = $("in-lon").value = ""; agregarPunto(lat, lon);
}

/* ---------------- accesibilidad ---------------- */
function pintarAcceso() {
  const e = a11y.leer(), p = $("panel-acceso");
  const sw = (clave, titulo, desc) => { const b = el("button", { type: "button", class: "interruptor", role: "switch", "aria-checked": String(!!e[clave]), "aria-label": titulo, onclick: () => { a11y.poner(clave, !a11y.leer()[clave]); pintarAcceso(); } }); return el("div", { class: "opcion" }, el("div", {}, el("strong", {}, titulo), el("small", {}, desc)), b); };
  const tam = el("div", { class: "opcion" }, el("div", {}, el("strong", {}, t("a11y.size")), el("small", {}, t("a11y.size.d"))),
    el("div", { class: "seg", role: "group", "aria-label": t("a11y.size") }, ...[[0, "A"], [1, "A+"], [2, "A++"]].map(([v, l]) => el("button", { type: "button", "aria-pressed": String(e.letra === v), "aria-label": t(`a11y.size.${v}`), onclick: () => { a11y.poner("letra", v); pintarAcceso(); } }, l))));
  p.replaceChildren(el("h3", {}, t("a11y.title")), sw("contraste", t("a11y.contrast"), t("a11y.contrast.d")), tam, sw("daltonismo", t("a11y.cvd"), t("a11y.cvd.d")), sw("movimiento", t("a11y.motion"), t("a11y.motion.d")),
    el("button", { type: "button", class: "btn btn-fantasma", onclick: () => { ["contraste", "daltonismo", "movimiento"].forEach((k) => a11y.poner(k, false)); a11y.poner("letra", 0); pintarAcceso(); } }, t("a11y.reset")));
}
function alternarAcceso(abrir) {
  const p = $("panel-acceso"); abrir = abrir ?? p.hidden; p.hidden = !abrir; $("btn-acceso").setAttribute("aria-expanded", String(abrir));
  if (abrir) { pintarAcceso(); p.querySelector("button")?.focus(); }
}

/* ---------------- navegación ---------------- */
function navegacion() {
  const enlaces = [...document.querySelectorAll(".lateral-nav a.item, .pildoras a")];
  const secs = ["inicio", "mapa-seccion", "resultados", "comparacion", "aprende", "metodo"].map((i) => $(i)).filter(Boolean);
  const io = new IntersectionObserver((es) => { for (const x of es) if (x.isIntersecting) enlaces.forEach((a) => a.toggleAttribute("aria-current", a.getAttribute("href") === `#${x.target.id}`)); }, { rootMargin: "-40% 0px -55% 0px" });
  secs.forEach((s) => io.observe(s));
  const lat = $("lateral"), velo = $("velo");
  const cerrar = () => { lat.classList.remove("abierto"); velo.hidden = true; $("btn-menu").setAttribute("aria-expanded", "false"); };
  $("btn-menu").addEventListener("click", () => { const ab = !lat.classList.contains("abierto"); lat.classList.toggle("abierto", ab); velo.hidden = !ab; $("btn-menu").setAttribute("aria-expanded", String(ab)); });
  velo.addEventListener("click", cerrar);
  lat.querySelectorAll("a.item").forEach((a) => a.addEventListener("click", cerrar));
  $("lat-asistente").addEventListener("click", () => { cerrar(); asistente.abrir(); });
  $("lat-acceso").addEventListener("click", () => { cerrar(); window.scrollTo({ top: 0, behavior: "smooth" }); alternarAcceso(true); });
}

/* ---------------- orquestación ---------------- */
function renderTodo() {
  enriquecer(E.sitios);
  llenarControles(); pintarKpis(); pintarLeyendaEstados(); pintarLista(); pintarPines(); pintarCalor(); pintarDetalle(); pintarComparacion(); pintarMetodo(); pintarNotaAnalisis();
  if (E.sel) mapa.marcarProvincia(actual()?.prov);
  $("lugares").replaceChildren(...E.lugares.map((l) => el("option", { value: l.name })));
}
function textosEstaticos() { aplicar(); $("buscar").setAttribute("placeholder", t("pts.search_ph")); }

async function iniciar() {
  aplicar(); a11y.aplicar();
  document.querySelectorAll(".idioma button").forEach((b) => b.addEventListener("click", () => setLang(b.dataset.lang)));
  try { E.lugares = await (await fetch("assets/places.json")).json(); } catch { E.lugares = []; }
  E.sitios = enriquecer(sitiosDemo()); E.sel = E.sitios[0].id;
  mapa = crearMapa($("mapa"), {
    aria: t("aria.mapa"), alClicPunto: (id) => seleccionar(id, { verDetalle: true }),
    alClicMapa: ({ lat, lon, prov }) => { if (!prov) return msg(t("pts.outside"), true); agregarPunto(lat, lon); },
  });
  mini = crearMapa($("hero-mapa"), { mini: true, aria: t("hero.visual_aria"), alClicPunto: (id) => seleccionar(id, { desplazar: true }) });
  $("estado-carga").hidden = true; $("app").hidden = false;
  document.querySelectorAll(".seg button[data-estilo]").forEach((b) => b.addEventListener("click", () => { E.estilo = b.dataset.estilo; llenarControles(); pintarCalor(); }));
  $("sel-ind").addEventListener("change", (e) => { E.ind = e.target.value; llenarControles(); pintarCalor(); });
  $("sel-anio").addEventListener("change", (e) => { E.anio = e.target.value; pintarCalor(); });
  $("form-buscar").addEventListener("submit", buscarLugar); $("form-coord").addEventListener("submit", añadirCoords);
  $("btn-analizar").addEventListener("click", analizar); $("btn-demo").addEventListener("click", volverDemo);
  $("btn-acceso").addEventListener("click", () => alternarAcceso());
  document.addEventListener("click", (ev) => { const p = $("panel-acceso"); if (!p.hidden && !ev.composedPath().includes(p) && !ev.target.closest("#btn-acceso, #lat-acceso")) alternarAcceso(false); });
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && !$("panel-acceso").hidden) { alternarAcceso(false); $("btn-acceso").focus(); } });
  asistente = crearAsistente({ obtener: () => ({ sitios: E.sitios, actual: actual(), demo: E.demo, servidor: E.servidor }), seleccionar });
  $("abrir-asistente").addEventListener("click", () => asistente.abrir());
  navegacion();
  textosEstaticos(); renderTodo(); pintarAprende(); pintarAcceso();
  seleccionar(E.sel, { sinMover: true });
  a11y.alCambiar((k) => { if (k === "daltonismo" || k === "contraste") renderTodo(); });
  onLang(() => { textosEstaticos(); renderTodo(); pintarAprende(); pintarAcceso(); revisarServidor(); });
  revisarServidor();
}
iniciar();
