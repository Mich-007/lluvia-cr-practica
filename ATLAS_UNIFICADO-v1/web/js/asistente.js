/* Phyllobytes · asistente con OPCIONES y RESPUESTAS PRESCRITAS (no hay cuadro de texto).
 *
 * Todo el contenido vive en web/data/asistente.json (ver web/data/ASISTENTE_LEEME.md): para cambiar preguntas o
 * respuestas solo se edita ese JSON. Este archivo únicamente lee el JSON y dibuja la conversación.
 *
 * Origen de los datos, en este orden:
 *   1) fetch("data/asistente.json")      → cuando la página se sirve por http (servidor de Python, Live Server, etc.)
 *   2) window.PHY_ASISTENTE_JSON         → copia generada en data/asistente.json.js (para abrir index.html con doble clic;
 *                                          INICIAR_PHYLLOBYTES.py y SINCRONIZAR_ASISTENTE.py la regeneran desde el JSON)
 *   3) un árbol mínimo interno           → si el JSON falta o está mal escrito, la página sigue funcionando.
 */
(function () {
"use strict";
const { el, fmt, fmtP, fmtS } = PHY.util;
const { t, onLang, getLang } = PHY.i18n;
const { lectura, resumenRegional, provNombre } = PHY.texto;

const MINIMO = {
  inicio: "inicio",
  textos: {},
  nodos: { inicio: { mensaje: { es: "El asistente aún no tiene contenido. Agregue data/asistente.json.", en: "The assistant has no content yet. Add data/asistente.json." }, opciones: [] } },
};

/* ---------- textos (cadena, lista de líneas o {es, en}) ---------- */
function txt(v) {
  if (v === undefined || v === null) return "";
  if (Array.isArray(v)) return v.join("\n");
  if (typeof v === "object") { const l = v[getLang()] ?? v.es ?? v.en ?? Object.values(v)[0]; return txt(l); }
  return String(v);
}

/* ---------- lectura y validación del JSON ---------- */
function validar(d) {
  if (!d || typeof d !== "object" || !d.nodos || typeof d.nodos !== "object") return null;
  const inicio = d.inicio && d.nodos[d.inicio] ? d.inicio : Object.keys(d.nodos)[0];
  if (!inicio) return null;
  for (const [id, n] of Object.entries(d.nodos)) {
    if (!n || typeof n !== "object") { console.warn(`[asistente] el nodo «${id}» no es un objeto.`); delete d.nodos[id]; }
  }
  for (const [id, n] of Object.entries(d.nodos)) {
    n.opciones = (Array.isArray(n.opciones) ? n.opciones : []).filter((o) => {
      if (!o || o.texto === undefined) { console.warn(`[asistente] opción sin «texto» en el nodo «${id}».`); return false; }
      if (o.ir && !d.nodos[o.ir]) { console.warn(`[asistente] la opción «${txt(o.texto)}» (nodo «${id}») apunta a «${o.ir}», que no existe.`); return false; }
      return true;
    });
  }
  return { ...d, inicio, textos: d.textos ?? {} };
}
async function cargarArbol() {
  let datos = null;
  if (location.protocol.startsWith("http")) {
    try { const r = await fetch("data/asistente.json", { cache: "no-store" }); if (r.ok) datos = await r.json(); } catch { /* se usa la copia incrustada */ }
  }
  return validar(datos) ?? validar(window.PHY_ASISTENTE_JSON) ?? validar(JSON.parse(JSON.stringify(MINIMO)));
}

/* ---------- marcadores {{...}} que se rellenan con lo que hay en pantalla ---------- */
const con = (ctx) => ctx.sitios.filter((s) => s.datos);
const extremo = (lista, signo) => [...lista].sort((a, b) => signo * (b.tend.pendienteDecada - a.tend.pendienteDecada))[0];
const MARCADORES = {
  lectura_punto: (c) => (c.actual ? lectura(c.actual) : t("b.nosel")),
  resumen_regional: (c) => resumenRegional(c.sitios),
  lista_puntos: (c) => t("b.lista", { n: c.sitios.length, l: c.sitios.map((s) => `• ${s.nombre}${provNombre(s.prov) ? ` (${provNombre(s.prov)})` : ""}`).join("\n") }),
  estado_demo: (c) => t(c.demo ? "b.demo.si" : "b.demo.no"),
  estado_analisis: (c) => t(c.servidor ? "b.analizar.si" : "b.analizar.no"),
  n_puntos: (c) => String(c.sitios.length),
  mayor_aumento: (c) => { const l = con(c); if (!l.length) return t("b.sindatos"); const s = extremo(l, 1); return t(s.estado === "creciente" ? "b.aum.ok" : "b.aum.no", { nombre: s.nombre, b: fmtS(s.tend.pendienteDecada), lo: fmt(s.tend.ic95Decada?.[0]), hi: fmt(s.tend.ic95Decada?.[1]) }); },
  mayor_disminucion: (c) => { const l = con(c); if (!l.length) return t("b.sindatos"); const s = extremo(l, -1); return t(s.estado === "decreciente" ? "b.dis.ok" : "b.dis.no", { nombre: s.nombre, b: fmtS(s.tend.pendienteDecada), lo: fmt(s.tend.ic95Decada?.[0]), hi: fmt(s.tend.ic95Decada?.[1]) }); },
};
const rellenar = (texto, ctx) => texto.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => (MARCADORES[k] ? MARCADORES[k](ctx) : m));

/* ---------- ventana del asistente ---------- */
function crearAsistente({ obtener, irASeccion, abrirAcceso }) {
  let arbol = validar(JSON.parse(JSON.stringify(MINIMO))), actual = null;
  const log = el("div", { class: "chat-log", role: "log", "aria-live": "polite" });
  const opcionesBox = el("div", { class: "chat-opciones", role: "group" });
  const cerrarBtn = el("button", { type: "button", class: "chat-cerrar" }, "✕");
  const titulo = el("strong"), sub = el("span", { class: "sub" });
  const panel = el("section", { class: "chat", id: "asistente", role: "dialog", hidden: true }, el("header", { class: "chat-cab" }, el("div", {}, titulo, sub), cerrarBtn), log, opcionesBox);
  const fabTxt = el("span");
  const fab = el("button", { type: "button", class: "chat-fab", "aria-expanded": "false", "aria-controls": "asistente" }, el("span", { class: "chat-fab-punto", "aria-hidden": "true" }), fabTxt);
  document.body.append(panel, fab);

  const T = (clave, def) => txt(arbol.textos[clave]) || def;
  const reducido = () => document.documentElement.dataset.movimiento === "reducido" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const burbuja = (quien, texto) => { log.append(el("p", { class: `msj msj-${quien}` }, texto)); log.scrollTop = log.scrollHeight; };
  const movil = () => window.innerWidth < 900;

  function etiquetas() {
    titulo.textContent = T("titulo", t("chat.title")); sub.textContent = T("subtitulo", t("chat.sub"));
    cerrarBtn.setAttribute("aria-label", t("chat.close")); fabTxt.textContent = t("chat.fab");
    panel.setAttribute("aria-label", t("chat.dialog")); log.setAttribute("aria-label", t("chat.log")); opcionesBox.setAttribute("aria-label", T("elige", t("chat.pick")));
  }
  function pintarOpciones(nodo) {
    const botones = nodo.opciones.map((o) => el("button", { type: "button", class: "chip", onclick: () => elegir(o) }, txt(o.texto)));
    if (actual !== arbol.inicio) botones.push(el("button", { type: "button", class: "chip chip-menu", onclick: () => elegir({ texto: T("menu", t("chat.menu")), ir: arbol.inicio }) }, T("menu", t("chat.menu"))));
    opcionesBox.replaceChildren(...botones);
    opcionesBox.scrollTop = 0;
  }
  function mostrarNodo(id, conRetardo) {
    const nodo = arbol.nodos[id]; if (!nodo) return;
    actual = id;
    const poner = () => { burbuja("bot", rellenar(txt(nodo.mensaje), obtener())); pintarOpciones(nodo); };
    conRetardo && !reducido() ? setTimeout(poner, 220) : poner();
  }
  function elegir(op) {
    burbuja("yo", txt(op.texto));
    if (op.accion === "ir_seccion" && op.valor) { irASeccion?.(op.valor); if (movil()) alternar(false); }
    else if (op.accion === "abrir_accesibilidad") { if (movil()) alternar(false); abrirAcceso?.(); }
    else if (op.accion === "enlace" && /^https?:\/\//.test(op.valor ?? "")) window.open(op.valor, "_blank", "noopener,noreferrer");
    if (op.ir) mostrarNodo(op.ir, true);
  }
  const reiniciar = () => { log.replaceChildren(); etiquetas(); mostrarNodo(arbol.inicio, false); };

  function alternar(abrir = panel.hidden) {
    panel.hidden = !abrir;
    fab.setAttribute("aria-expanded", String(abrir));
    fab.classList.toggle("oculto", abrir && movil());
    if (abrir) (opcionesBox.querySelector("button") ?? cerrarBtn).focus({ preventScroll: true }); else fab.focus({ preventScroll: true });
  }
  fab.addEventListener("click", () => alternar());
  cerrarBtn.addEventListener("click", () => alternar(false));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !panel.hidden) alternar(false); });
  onLang(reiniciar);
  etiquetas(); reiniciar();
  cargarArbol().then((a) => { arbol = a; reiniciar(); });
  return { abrir: () => alternar(true), alternar, reiniciar };
}

PHY.asistente = { crearAsistente, cargarArbol, txt };
})();
