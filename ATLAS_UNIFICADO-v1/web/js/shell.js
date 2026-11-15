/* Atlas unificado · «cáscara» de Phyllobytes alrededor del atlas.
 *
 * Une la interfaz de Phyllobytes (navegación lateral, idiomas, accesibilidad, asistente, portada,
 * Aprende y Método) con el atlas (atlas/app.js, data-tools.js, validacion.js), sin cambiar la lógica
 * de este último: el atlas sigue haciendo el análisis, los mapas y las figuras; aquí solo se conecta.
 * No hay datos inventados: si no hay servidor se avisa y no se muestra ningún resultado.
 */
(function () {
"use strict";
const { t, aplicar, setLang, onLang, getLang } = PHY.i18n;
const { $, el, ESTADO, fmt } = PHY.util;
const { crearAsistente } = PHY.asistente;
const a11y = PHY.a11y;
const atlas = () => (typeof state !== "undefined" ? state : null);   // «state» es el estado global del atlas (app.js)
let asistente, servidor = false;

/* ---------------- servidor ---------------- */
async function revisarServidor() {
  servidor = false;
  if (location.protocol.startsWith("http")) {
    try { const r = await fetch("/api/health", { cache: "no-store" }); const h = await r.json(); servidor = r.ok && h.status === "ok"; } catch { /* sin servidor */ }
  }
  const chip = $("chip-servidor");
  chip.classList.toggle("ok", servidor);
  chip.querySelector("span").textContent = t(servidor ? "srv.ok" : "srv.off");
  $("aviso-servidor").hidden = servidor;
}

/* ---------------- adaptador atlas → asistente ----------------
 * El asistente de Phyllobytes lee «sitios» con días de lluvia fuerte (> P95 de días lluviosos) y su tendencia.
 * El atlas calcula exactamente ese indicador en summary.extreme_count_trends["95"]. */
function sitios() {
  const s = atlas();
  if (!s || !s.result) return (s?.points ?? []).map((p, i) => ({ id: `P${i + 1}`, nombre: p.name, lat: p.lat, lon: p.lon, prov: null, datos: false, anios: [] }));
  return s.result.points.map((p, i) => {
    const tr = p.summary?.extreme_count_trends?.["95"] ?? {};
    let estado = tr.estado ?? "no_concluyente";
    if (!ESTADO[estado]) estado = "no_concluyente";
    const anios = (p.annual ?? []).filter((a) => a.total !== null && a.total !== undefined).map((a) => a.year);
    return {
      id: `P${i + 1}`, nombre: p.name, lat: p.lat, lon: p.lon, prov: p.cell_report?.country ?? null, datos: anios.length > 0, demo: false,
      anios: anios.length ? anios : [s.result.start_year, s.result.end_year], estado,
      tend: { pendienteDecada: tr.slope_per_decade ?? null, ic95Decada: tr.ci_low_per_decade != null ? [tr.ci_low_per_decade, tr.ci_high_per_decade] : null },
      pHolm: tr.kendall_p_holm ?? tr.kendall_p_hr ?? tr.kendall_p ?? null, umbral: p.thresholds?.["95"] ?? null, cobertura: p.summary?.coverage_pct ?? null,
    };
  });
}
const puntoActual = () => { const l = sitios(); const i = +($("focusedPoint")?.value || 0); return l[i] ?? l[0] ?? null; };

/* ---------------- avisos y pie ---------------- */
function pintarIdioma() {
  $("aviso-idioma").hidden = true;   // los textos del análisis ya se traducen (traductor-*.js)
  (window.atlasPaisEtiquetas ?? []).forEach(({ name, marker }) => { const e = marker.getElement?.(); if (e) e.querySelector("span").textContent = window.atlasNombrePais(name); });
  pintarPie();
}
function pintarPie() {
  const r = atlas()?.result;
  $("pie-fuente").textContent = t("foot.data", { f: r ? r.source_label : "NASA POWER (IMERG, MERRA-2), Copernicus ERA5, CHIRPS · CSV" });
}

/* ---------------- portada: mini mapa de los 7 países y resumen ---------------- */
const CA = ["Guatemala", "Belize", "El Salvador", "Honduras", "Nicaragua", "Costa Rica", "Panama"];
function heroMapa(countries) {
  const NS = "http://www.w3.org/2000/svg", S = (tag, at = {}) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(at)) e.setAttribute(k, v); return e; };
  const merc = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * 180 / Math.PI;
  const lon0 = -92.6, lon1 = -76.8, lat0 = 7.0, lat1 = 18.6, W = 1000;
  const H = Math.round(((merc(lat1) - merc(lat0)) / (lon1 - lon0)) * W);
  const P = (lon, lat) => [((lon - lon0) / (lon1 - lon0)) * W, ((merc(lat1) - merc(lat)) / (merc(lat1) - merc(lat0))) * H];
  const ruta = (geom) => (geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates).map((poly) => poly.map((ring) => "M" + ring.map(([x, y]) => P(x, y).map((v) => v.toFixed(1)).join(",")).join("L") + "Z").join("")).join("");
  const svg = S("svg", { viewBox: `0 0 ${W} ${H}`, class: "hero-ca", role: "group" });
  svg.setAttribute("aria-label", t("hero.visual_aria"));
  const vecinos = S("g", { class: "hero-vecinos", "aria-hidden": "true" }), paises = S("g", { class: "hero-paises" });
  for (const f of countries.features) {
    const nombre = f.properties.name, path = S("path", { d: ruta(f.geometry) });
    if (!CA.includes(nombre)) { vecinos.append(path); continue; }
    path.setAttribute("class", "hero-pais"); path.setAttribute("tabindex", "0"); path.setAttribute("role", "button");
    const titulo = S("title"); titulo.textContent = window.atlasNombrePais(nombre); path.append(titulo);
    path.dataset.pais = nombre;
    const ir = () => irAPais(f);
    path.addEventListener("click", ir);
    path.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ir(); } });
    paises.append(path);
  }
  svg.append(vecinos, paises);
  const caja = el("div", { class: "hero-mapa-caja" }, svg, el("img", { class: "marca-agua marca-agua-mapa mini", src: "assets/marca-agua.png", alt: "", "aria-hidden": "true", draggable: "false" }));
  $("hero-mapa").replaceChildren(caja);
  onLang(() => { svg.setAttribute("aria-label", t("hero.visual_aria")); svg.querySelectorAll(".hero-pais").forEach((p) => { p.querySelector("title").textContent = window.atlasNombrePais(p.dataset.pais); }); });
}
function irAPais(f) {
  $("mapa").scrollIntoView({ behavior: lento() ? "auto" : "smooth", block: "start" });
  const m = atlas()?.map;
  if (m && window.L) { try { m.fitBounds(L.geoJSON(f).getBounds(), { padding: [20, 20] }); } catch { /* sin Leaflet */ } }
}
function esperarFronteras(intento = 0) {
  const c = atlas()?.countries;
  if (c) return heroMapa(c);
  if (intento < 60) setTimeout(() => esperarFronteras(intento + 1), 250);
}
function pintarResumen() {
  const r = atlas()?.result, ul = $("hero-resumen");
  if (!r) { ul.hidden = true; return; }
  const n = (e) => r.points.filter((p) => (p.summary?.extreme_count_trends?.["95"]?.estado ?? "") === e).length;
  ul.replaceChildren(...[["creciente", "at.chip.up"], ["decreciente", "at.chip.dn"], ["no_concluyente", "at.chip.nc"]].map(([e, k]) => {
    const sw = el("span", { class: "muestra", "aria-hidden": "true" }); sw.style.background = ESTADO[e].color;
    return el("li", {}, sw, el("strong", {}, String(n(e))), el("span", {}, `${ESTADO[e].simbolo} ${t(k)}`));
  }));
  ul.hidden = false;
}

/* ---------------- Aprende y Método (contenido de Phyllobytes) ---------------- */
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
function pintarMetodo() {
  $("pasos").replaceChildren(...[1, 2, 3, 4].map((n) => el("li", { class: "panel" }, el("h3", {}, t(`paso${n}.t`)), el("p", {}, t(`paso${n}.d`)))));
  $("lista-si").replaceChildren(...[1, 2, 3].map((n) => el("li", {}, t(`si${n}`))));
  $("lista-no").replaceChildren(...[1, 2, 3, 4].map((n) => el("li", {}, t(`no${n}`))));
  $("lista-metodo-atlas").replaceChildren(...[1, 2, 3, 4, 5, 6].map((n) => el("li", {}, t(`at.met.${n}`))));
}

/* ---------------- accesibilidad (igual que Phyllobytes) ---------------- */
const lento = () => document.documentElement.dataset.movimiento === "reducido" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
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
// Las figuras toman colores y tamaño de letra al dibujarse: al cambiar contraste, daltonismo o letra se redibujan.
let redibujo = 0;
function redibujarFiguras() {
  clearTimeout(redibujo);
  redibujo = setTimeout(() => {
    const s = atlas();
    try { if (s?.result && typeof renderResult === "function") renderResult(); } catch (e) { console.warn("[shell] no se pudo redibujar", e); }
    pintarResumen();
  }, 60);
}

// Al cambiar de idioma las figuras se redibujan para que tema-plotly traduzca (o no) sus textos.
function redibujarTodo() {
  redibujarFiguras();
  setTimeout(() => {
    try { if (typeof val !== "undefined" && val.result && typeof valRerender === "function") valRerender(); } catch (e) { console.warn("[shell] validación", e); }
    try { if (typeof renderFloatChart === "function" && !$("floatingChart").hidden) renderFloatChart(); } catch { /* opcional */ }
  }, 120);
}

/* ---------------- navegación (Phyllobytes) ---------------- */
function navegacion() {
  const enlaces = [...document.querySelectorAll(".lateral-nav a.item, .pildoras a")];
  const ids = ["inicio", "mapa-seccion", "resultados", "panel", "comparacion", "verificacion", "validacion", "recursos", "aprende", "metodo"];
  const io = new IntersectionObserver((es) => { for (const x of es) if (x.isIntersecting) enlaces.forEach((a) => a.toggleAttribute("aria-current", a.getAttribute("href") === `#${x.target.id}`)); }, { rootMargin: "-40% 0px -55% 0px" });
  ids.map((i) => $(i)).filter(Boolean).forEach((s) => io.observe(s));
  // Secciones que solo existen con resultados: sin análisis, el enlace lleva a «Resultados» y lo explica.
  enlaces.forEach((a) => a.addEventListener("click", (ev) => {
    const id = a.getAttribute("href").slice(1), destino = $(id);
    if (destino && destino.closest("#results") && $("results").hidden) {
      ev.preventDefault(); $("resultados").scrollIntoView({ behavior: lento() ? "auto" : "smooth", block: "start" });
      const st = $("statusArea"); st.classList.add("destello"); setTimeout(() => st.classList.remove("destello"), 1600);
    }
  }));
  const lat = $("lateral"), velo = $("velo"), raiz = document.documentElement;
  const esMovil = () => window.matchMedia("(max-width: 1099px)").matches;
  const CLAVE = "phy-lateral";
  let modo = "completo";
  try { const g = localStorage.getItem(CLAVE); if (["completo", "mini", "oculto"].includes(g)) modo = g; } catch { /* sin almacenamiento */ }
  const rotular = () => {
    lat.querySelectorAll("a.item, button.item").forEach((x) => x.setAttribute("title", modo === "mini" ? x.querySelector("span")?.textContent ?? "" : ""));
    const mn = $("lat-min"); mn.setAttribute("aria-expanded", String(modo !== "mini"));
    const txt = t(modo === "mini" ? "side.expand" : "side.min"); mn.setAttribute("aria-label", txt); mn.setAttribute("title", txt);
    mn.querySelector("use").setAttribute("href", modo === "mini" ? "#i-chev-der" : "#i-chev-izq");
  };
  const ajustarMapa = () => setTimeout(() => { atlas()?.map?.invalidateSize?.(); window.dispatchEvent(new Event("resize")); }, 320);
  const poner = (m) => { modo = m; raiz.dataset.lateral = m; try { localStorage.setItem(CLAVE, m); } catch { /* */ } if (!esMovil()) $("btn-menu").setAttribute("aria-expanded", String(m !== "oculto")); rotular(); ajustarMapa(); };
  const cerrar = () => { lat.classList.remove("abierto"); velo.hidden = true; if (esMovil()) $("btn-menu").setAttribute("aria-expanded", "false"); };
  $("btn-menu").addEventListener("click", () => {
    if (esMovil()) { const ab = !lat.classList.contains("abierto"); lat.classList.toggle("abierto", ab); velo.hidden = !ab; $("btn-menu").setAttribute("aria-expanded", String(ab)); }
    else poner(modo === "oculto" ? "completo" : "oculto");
  });
  $("lat-min").addEventListener("click", () => poner(modo === "mini" ? "completo" : "mini"));
  $("lat-ocultar").addEventListener("click", () => (esMovil() ? cerrar() : poner("oculto")));
  velo.addEventListener("click", cerrar);
  lat.querySelectorAll("a.item").forEach((a) => a.addEventListener("click", () => esMovil() && cerrar()));
  window.matchMedia("(max-width: 1099px)").addEventListener("change", () => { cerrar(); $("btn-menu").setAttribute("aria-expanded", String(esMovil() ? false : modo !== "oculto")); });
  poner(modo);
  onLang(rotular);
  $("lat-asistente").addEventListener("click", () => { cerrar(); asistente.abrir(); });
  $("lat-acceso").addEventListener("click", () => { cerrar(); window.scrollTo({ top: 0, behavior: "smooth" }); alternarAcceso(true); });
}

/* ---------------- inicio ---------------- */
function iniciar() {
  aplicar(); a11y.aplicar();
  document.querySelectorAll(".idioma button").forEach((b) => b.addEventListener("click", () => setLang(b.dataset.lang)));
  $("btn-acceso").addEventListener("click", () => alternarAcceso());
  document.addEventListener("click", (ev) => { const p = $("panel-acceso"); if (!p.hidden && !ev.composedPath().includes(p) && !ev.target.closest("#btn-acceso, #lat-acceso")) alternarAcceso(false); });
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && !$("panel-acceso").hidden) { alternarAcceso(false); $("btn-acceso").focus(); } });
  asistente = crearAsistente({
    obtener: () => ({ sitios: sitios(), actual: puntoActual(), demo: false, servidor }),
    irASeccion: (id) => $(id)?.scrollIntoView({ behavior: lento() ? "auto" : "smooth", block: "start" }),
    abrirAcceso: () => { window.scrollTo({ top: 0, behavior: "smooth" }); alternarAcceso(true); },
  });
  $("abrir-asistente").addEventListener("click", () => asistente.abrir());
  navegacion();
  pintarAprende(); pintarMetodo(); pintarAcceso(); pintarIdioma(); pintarPie();
  esperarFronteras();
  // Al terminar un análisis el atlas muestra #results: se actualiza el resumen de la portada y el pie.
  new MutationObserver(() => { pintarResumen(); pintarPie(); }).observe($("results"), { attributes: true, attributeFilter: ["hidden"] });
  a11y.alCambiar((k) => { if (["daltonismo", "contraste", "letra"].includes(k)) redibujarFiguras(); });
  onLang(() => { pintarAprende(); pintarMetodo(); pintarAcceso(); pintarIdioma(); pintarResumen(); revisarServidor(); redibujarTodo(); });
  revisarServidor();
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar); else iniciar();
})();
