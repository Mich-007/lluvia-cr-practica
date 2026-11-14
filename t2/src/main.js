import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./style.css";
import { normalizar } from "./adapter.js";
import { $, el, ESTADO, fmt, fmtP, rango, nombreCorto, nombreLargo } from "./util.js";
import { t, aplicar, setLang, onLang } from "./i18n.js";
import { montar, graficoSerie, graficoBosque } from "./chart.js";
import { pintarHero } from "./hero.js";
import { crearAsistente } from "./asistente.js";
import { lectura, fichaTexto, metaVista } from "./texto.js";

let datos, mapa, asistente, seleccionado = null;
const pines = {}, marcadores = {};

async function cargar() {
  // BASE_URL = "./" gracias a base: "./" en vite.config.js; funciona en cualquier hosting.
  const r = await fetch(`${import.meta.env.BASE_URL}data/resultados.json`, { cache: "no-cache" });
  if (!r.ok) throw new Error(`resultados.json (HTTP ${r.status})`);
  return normalizar(await r.json());
}

function pintarAviso() {
  const a = $("aviso-sintetico");
  a.hidden = !datos.meta.sintetico;
  if (datos.meta.sintetico) a.textContent = t("aviso.sint");
}

function pintarKpis() {
  const s = datos.sitios;
  const cuenta = (e) => s.filter((x) => x.estado === e).length;
  const mayor = [...s].sort((a, b) => b.pendiente_dias_decada - a.pendiente_dias_decada)[0];
  const media = s.reduce((acc, x) => acc + x.conteos.reduce((a, b) => a + b, 0) / x.conteos.length, 0) / s.length;
  const tarjetas = [
    [t("kpi.sites"), String(s.length), t("kpi.sites.s", { rango: rango(s[0]) })],
    [t("kpi.up"), String(cuenta("creciente")), t("kpi.evid"), ESTADO.creciente.color],
    [t("kpi.dn"), String(cuenta("decreciente")), t("kpi.evid"), ESTADO.decreciente.color],
    [t("kpi.nc"), String(cuenta("no_concluyente")), t("kpi.nc.s"), ESTADO.no_concluyente.color],
    [t("kpi.avg"), fmt(media), t("kpi.avg.s")],
    [t("kpi.max"), fmt(mayor.pendiente_dias_decada), t("kpi.max.s", { pais: nombreCorto(mayor) })],
  ];
  $("kpis").replaceChildren(...tarjetas.map(([ti, v, sub, c]) => {
    const num = el("strong", {}, v);
    if (c) num.style.color = c;
    return el("div", { class: "kpi" }, el("span", { class: "sub" }, ti), num, el("span", { class: "sub" }, sub));
  }));
}

// Pin con aspecto de gota de agua: brillo especular + halo de vidrio.
function pinElemento(s) {
  const e = el("div", { class: "pin" }, el("span", { class: "pin-halo" }), el("span", { class: "pin-nucleo" }), el("span", { class: "pin-codigo" }, s.id));
  e.style.setProperty("--c", ESTADO[s.estado].color);
  return e;
}

function textosMarcador(s) {
  const est = ESTADO[s.estado];
  const titulo = t("pin.title", { pais: nombreCorto(s), estado: est.texto });
  return { titulo, tip: t("pin.tip", { pais: nombreCorto(s), simbolo: est.simbolo, estado: est.texto }) };
}

function pintarMapa() {
  mapa = L.map("mapa", { scrollWheelZoom: false, zoomControl: true }).setView([12.5, -85.5], 5);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 12,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>',
  }).addTo(mapa);

  const puntos = [];
  for (const s of datos.sitios) {
    const elem = pinElemento(s);
    const tx = textosMarcador(s);
    const m = L.marker([s.lat, s.lon], {
      icon: L.divIcon({ html: elem, className: "pin-wrap", iconSize: [56, 56], iconAnchor: [28, 28] }),
      title: tx.titulo, alt: tx.titulo, keyboard: true,
    }).addTo(mapa);
    m.bindTooltip(el("span", {}, tx.tip), { direction: "top", offset: [0, -14] });
    m.on("click", () => seleccionar(s.id, { verDetalle: true }));
    pines[s.id] = elem; marcadores[s.id] = m;
    puntos.push([s.lat, s.lon]);
  }
  if (puntos.length > 1) mapa.fitBounds(puntos, { padding: [50, 50] });
}

function actualizarMarcadores() {
  for (const s of datos.sitios) {
    const tx = textosMarcador(s), m = marcadores[s.id];
    m.setTooltipContent(el("span", {}, tx.tip));
    const e = m.getElement?.();
    if (e) { e.setAttribute("title", tx.titulo); e.setAttribute("alt", tx.titulo); }
  }
}

function pintarLeyenda() {
  $("leyenda").replaceChildren(...Object.values(ESTADO).map((e) => {
    const sw = el("span", { class: "muestra", "aria-hidden": "true" });
    sw.style.background = e.color;
    return el("li", {}, sw, `${e.simbolo} ${e.texto}`);
  }));
}

function pintarLista() {
  $("lista-sitios").replaceChildren(...datos.sitios.map((s) => {
    const est = ESTADO[s.estado];
    const sw = el("span", { class: "muestra", "aria-hidden": "true" });
    sw.style.background = est.color;
    const b = el("button", { type: "button", "data-id": s.id, "aria-current": String(s.id === seleccionado), onclick: () => seleccionar(s.id, { verDetalle: true }) },
      sw, el("span", {}, el("strong", {}, nombreCorto(s)), el("span", { class: "sub" }, `${est.simbolo} ${est.corto}`)));
    return el("li", {}, b);
  }));
}

function tile(titulo, valor, sub) {
  return el("div", { class: "tile" }, el("span", { class: "sub" }, titulo), el("strong", {}, valor), sub ? el("span", { class: "sub" }, sub) : null);
}

function pintarDetalle(s) {
  const est = ESTADO[s.estado];
  const [lo, hi] = s.ic95_dias_decada ?? [];
  const badge = el("span", { class: "badge" }, `${est.simbolo} ${est.texto}`);
  badge.style.setProperty("--c", est.color);

  const tabla = el("table", { class: "tabla" },
    el("caption", {}, t("tab.cap")),
    el("thead", {}, el("tr", {}, el("th", { scope: "col" }, t("tab.year")), el("th", { scope: "col" }, t("tab.days")))),
    el("tbody", {}, ...s.anios.map((a, i) => el("tr", {}, el("th", { scope: "row" }, String(a)), el("td", {}, String(s.conteos[i]))))));

  const copiar = el("button", { type: "button", class: "btn btn-lima" }, t("copy.btn"));
  copiar.addEventListener("click", () => copiarFicha(s, copiar));

  const leyendaGrafico = el("ul", { class: "leyenda leyenda-g" },
    el("li", {}, el("span", { class: "muestra barra-m", "aria-hidden": "true" }), t("leg.bars")),
    el("li", {}, el("span", { class: "muestra linea-m", "aria-hidden": "true" }), t("leg.line")),
    el("li", {}, el("span", { class: "muestra base-m", "aria-hidden": "true" }), t("leg.base")));

  $("detalle").replaceChildren(
    el("div", { class: "detalle-cab" }, el("div", {}, el("h3", {}, nombreCorto(s)), el("p", { class: "sub" }, `${nombreLargo(s)} (${s.id})`)), badge),
    el("p", { class: "lectura" }, lectura(s)),
    montar("grafico-caja", (w) => graficoSerie(s, w)),
    leyendaGrafico,
    el("div", { class: "tiles" },
      tile(t("det.change"), fmt(s.pendiente_dias_decada), t("det.change.s")),
      tile(t("det.ci"), lo !== undefined ? `${fmt(lo)} / ${fmt(hi)}` : "—", t("det.ci.s")),
      tile(t("det.p"), fmtP(s.p_holm), s.p_holm < 0.05 ? t("det.p.lt") : t("det.p.ge")),
      tile(t("det.thr"), fmt(s.umbral_mm, 1), t("det.thr.s")),
      tile(t("det.years"), String(s.anios.length), rango(s)),
      tile(t("det.cov"), s.cobertura_pct !== undefined ? `${fmt(s.cobertura_pct)} %` : "—", t("det.cov.s", { lat: fmt(s.lat, 3), lon: fmt(s.lon, 3) }))),
    el("div", { class: "detalle-pie" }, copiar),
    el("details", { class: "datos-tabla" }, el("summary", {}, t("tab.sum")), tabla));
}

function seleccionar(id, opciones = {}) {
  const s = datos.sitios.find((x) => x.id === id);
  if (!s) return;
  seleccionado = id;
  document.querySelectorAll("#lista-sitios button").forEach((b) => b.setAttribute("aria-current", String(b.dataset.id === id)));
  Object.entries(pines).forEach(([k, p]) => p.classList.toggle("activo", k === id));
  document.querySelectorAll("#bosque .fila").forEach((f) => f.classList.toggle("activa", f.dataset.id === id));
  if (!opciones.sinMover) mapa.panTo([s.lat, s.lon]);
  pintarDetalle(s);

  const reducido = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (opciones.verDetalle && window.innerWidth < 1000) $("detalle").scrollIntoView({ behavior: reducido ? "auto" : "smooth", block: "start" });
  if (opciones.desplazar) $("mapa-seccion").scrollIntoView({ behavior: reducido ? "auto" : "smooth", block: "start" });
}

async function copiarFicha(s, btn) {
  try { await navigator.clipboard.writeText(fichaTexto(s, datos.meta, datos.sitios)); btn.textContent = t("copy.ok"); }
  catch { btn.textContent = t("copy.fail"); }
  setTimeout(() => (btn.textContent = t("copy.btn")), 2000);
}

function pintarBosque() {
  $("bosque").replaceChildren(montar("grafico-caja", (w) => graficoBosque(datos.sitios, w, seleccionado, (id) => seleccionar(id, { desplazar: true }))));
}

function pintarMetodo() {
  const m = metaVista(datos.meta, datos.sitios);
  $("pasos").replaceChildren(...[1, 2, 3, 4].map((n) => el("li", { class: "panel" }, el("h3", {}, t(`paso${n}.t`)), el("p", {}, t(`paso${n}.d`)))));
  $("lista-si").replaceChildren(...[1, 2, 3].map((n) => el("li", {}, t(`si${n}`))));
  $("lista-no").replaceChildren(...[1, 2, 3, 4].map((n) => el("li", {}, t(`no${n}`))));
  const items = [
    [t("src.product"), `${m.producto} (${m.version})`], [t("src.res"), m.resolucion], [t("src.period"), m.periodo], [t("src.unit"), m.unidad], [t("src.download"), m.fecha],
  ];
  $("metodo-lista").replaceChildren(...items.map(([k, v]) => el("li", {}, el("span", { class: "sub" }, k), el("strong", {}, v))),
    ...(m.nota ? [el("li", { class: "nota-fuente" }, el("span", { class: "sub" }, t("src.note")), el("strong", {}, m.nota))] : []));
  $("pie-fuente").textContent = t("foot.data", { v: m.version });
}

function resaltarNavegacion() {
  const enlaces = [...document.querySelectorAll(".nav a")];
  const secciones = enlaces.map((a) => document.querySelector(a.getAttribute("href"))).filter(Boolean);
  if (typeof IntersectionObserver === "undefined") return;
  const io = new IntersectionObserver((entradas) => {
    for (const e of entradas) if (e.isIntersecting) enlaces.forEach((a) => a.toggleAttribute("aria-current", a.getAttribute("href") === `#${e.target.id}`));
  }, { rootMargin: "-45% 0px -50% 0px" });
  secciones.forEach((s) => io.observe(s));
}

// Vuelve a dibujar todo lo que contiene texto traducible.
function repintar() {
  // Al redibujar la página puede encogerse un instante: se fija la altura y se restaura el scroll.
  const y = window.scrollY;
  document.body.style.minHeight = `${document.documentElement.scrollHeight}px`;
  pintarAviso(); pintarKpis(); pintarLeyenda(); pintarLista(); pintarMetodo();
  pintarHero(datos, (id) => seleccionar(id, { desplazar: true }));
  actualizarMarcadores();
  pintarBosque();
  if (seleccionado) seleccionar(seleccionado, { sinMover: true });
  const volver = () => window.scrollTo({ top: y, behavior: "instant" });
  volver();
  requestAnimationFrame(() => requestAnimationFrame(volver));
  setTimeout(() => { volver(); document.body.style.minHeight = ""; }, 250);
}

async function iniciar() {
  aplicar();
  document.querySelectorAll(".idioma button").forEach((b) => b.addEventListener("click", () => setLang(b.dataset.lang)));
  resaltarNavegacion();
  try {
    datos = await cargar();
    $("estado-carga").hidden = true;
    $("app").hidden = false;
    pintarMapa();
    seleccionado = datos.sitios[0].id;
    repintar();
    asistente = crearAsistente({ datos, seleccionar, actual: () => datos.sitios.find((s) => s.id === seleccionado) });
    $("abrir-asistente").addEventListener("click", () => asistente.abrir());
    onLang(repintar);
    mapa.invalidateSize();
  } catch (err) {
    const c = $("estado-carga");
    c.hidden = false;
    c.textContent = t("ui.error", { msg: err.message });
    c.className = "aviso";
  }
}
iniciar();
