/* Atlas unificado · traduce al inglés el HTML que generan el atlas y el servidor (tarjetas, tablas, notas,
 * semáforo, ficha de celda, mensajes de estado) mientras la página está en inglés.
 * Guarda el texto original de cada nodo para restaurarlo al volver a español. No toca nada con data-i
 * (eso ya lo traduce i18n de Phyllobytes) ni el interior de las figuras (lo hace tema-plotly.js). */
(function () {
"use strict";
const { getLang, onLang } = PHY.i18n;
const T = PHY.traductor.traducir;
const ZONAS = "#mapa-seccion, #resultados, #validacion, #recursos, #cellCard, #figModal, .leaflet-pane, #hero-resumen";
const ATRIBUTOS = ["title", "placeholder", "aria-label"];
const original = new WeakMap();      // nodo de texto → texto en español
const origAttr = new WeakMap();      // elemento → {atributo: valor en español}
let aplicando = false;

// Un elemento con data-i lo traduce i18n; pero si el atlas le cambia el texto (p. ej. el botón «Analizar» al terminar),
// ese texto nuevo ya no es el de i18n y se traduce aquí.
const propioI18n = (el) => { const d = el && el.closest("[data-i]"); return !!d && d.textContent.trim() === PHY.i18n.t(d.dataset.i).trim(); };
const excluido = (el) => !el || el.closest(".js-plotly-plot, script, style, .chat") || propioI18n(el) || !el.closest(ZONAS);

function texto(n) {
  if (excluido(n.parentElement)) return;
  const actual = n.nodeValue;
  if (!original.has(n) || (original.has(n) && actual !== T(original.get(n)) && actual !== original.get(n))) original.set(n, actual);
  const es = original.get(n), en = T(es);
  if (en !== actual) n.nodeValue = en;
}
function atributos(el) {
  if (excluido(el) || el.closest("[data-ia]") && el.hasAttribute("data-ia")) return;
  const guard = origAttr.get(el) || {};
  for (const a of ATRIBUTOS) {
    const v = el.getAttribute(a); if (!v) continue;
    if (!(a in guard) || (v !== guard[a] && v !== T(guard[a]))) guard[a] = v;
    const en = T(guard[a]); if (en !== v) el.setAttribute(a, en);
  }
  origAttr.set(el, guard);
}
function recorrer(raiz) {
  if (raiz.nodeType === 3) return texto(raiz);
  if (raiz.nodeType !== 1) return;
  const w = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT); let n;
  while ((n = w.nextNode())) texto(n);
  [raiz, ...raiz.querySelectorAll("[title],[placeholder],[aria-label]")].forEach((e) => e.nodeType === 1 && atributos(e));
}
function traducirTodo() { aplicando = true; try { document.querySelectorAll(ZONAS).forEach(recorrer); } finally { aplicando = false; } }
function restaurar() {
  aplicando = true;
  try {
    document.querySelectorAll(ZONAS).forEach((z) => {
      const w = document.createTreeWalker(z, NodeFilter.SHOW_TEXT); let n;
      while ((n = w.nextNode())) if (original.has(n)) { n.nodeValue = original.get(n); original.delete(n); }
      z.querySelectorAll("*").forEach((e) => { const g = origAttr.get(e); if (g) { for (const [a, v] of Object.entries(g)) e.setAttribute(a, v); origAttr.delete(e); } });
    });
  } finally { aplicando = false; }
}
const obs = new MutationObserver((muts) => {
  if (aplicando || getLang() !== "en") return;
  aplicando = true;
  try {
    for (const m of muts) {
      if (m.type === "characterData") texto(m.target);
      else if (m.type === "attributes") atributos(m.target);
      else m.addedNodes.forEach(recorrer);
    }
  } finally { aplicando = false; }
});
obs.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATRIBUTOS });

// Al cambiar de idioma: el HTML se traduce o restaura aquí; las figuras se redibujan (shell.js) para que tema-plotly las traduzca.
onLang((l) => (l === "en" ? traducirTodo() : restaurar()));
if (getLang() === "en") traducirTodo();
PHY.traductorDom = { traducirTodo, restaurar };
})();
