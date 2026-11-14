// Asistente virtual del atlas. Funciona SIN internet y SIN API de IA: responde con textos preparados
// (src/i18n.js) y con cifras leídas de resultados.json. No calcula tendencias, no pronostica y no atribuye causas.
// Entiende preguntas en español e inglés y responde en el idioma de la interfaz.
// (Si más adelante quieren conectar un modelo de IA, `responder()` es el único punto a reemplazar.)
import { el, fmt, fmtP, normaliza, nombreCorto, nombreLargo } from "./util.js";
import { t, onLang } from "./i18n.js";
import { lectura, resumenRegional, metaVista } from "./texto.js";

const SUGERENCIAS = ["q.resumen", "q.extremo", "q.nc", "q.pron", "q.aum"];
const ALIAS_PAIS = { Belice: ["belize"], "Panamá": ["panama"] };

function alias(s) {
  const resto = normaliza(s.nombre).replace(/^aeropuerto (internacional )?(de )?/, "");
  const palabras = resto.split(" ").filter((w) => w.length >= 6);
  const pais = normaliza(s.pais ?? "");
  return [...new Set([pais, ...(ALIAS_PAIS[s.pais] ?? []), normaliza(s.id), resto, ...palabras])].filter(Boolean);
}
const escapar = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function sitiosMencionados(txt, sitios) {
  const hallados = [];
  for (const s of sitios) {
    let pos = -1;
    for (const a of alias(s)) {
      const m = new RegExp(`(^|\\s)${escapar(a)}(\\s|$)`).exec(txt);
      if (m && (pos === -1 || m.index < pos)) pos = m.index;
    }
    if (pos !== -1) hallados.push({ s, pos });
  }
  return hallados.sort((a, b) => a.pos - b.pos).map((h) => h.s);
}

function comparar(a, b) {
  const sentido = (s) => t(s.estado === "creciente" ? "b.cmp.up" : s.estado === "decreciente" ? "b.cmp.dn" : "b.cmp.nc");
  const filas = [a, b].map((s) => t("b.cmp.row", { pais: nombreCorto(s), sentido: sentido(s), b: fmt(s.pendiente_dias_decada), lo: fmt(s.ic95_dias_decada?.[0]), hi: fmt(s.ic95_dias_decada?.[1]), p: fmtP(s.p_holm), u: fmt(s.umbral_mm) }));
  const solapan = a.ic95_dias_decada && b.ic95_dias_decada && a.ic95_dias_decada[0] <= b.ic95_dias_decada[1] && b.ic95_dias_decada[0] <= a.ic95_dias_decada[1];
  return `${filas.join("\n")}\n${t(solapan ? "b.cmp.ov" : "b.cmp.nov")}\n${t("b.cmp.foot")}`;
}

const extremo = (sitios, signo) => [...sitios].sort((a, b) => signo * (b.pendiente_dias_decada - a.pendiente_dias_decada))[0];
const txt = (clave, s) => () => ({ t: t(clave), s });

// Cada intención tiene un patrón en español (es) y otro en inglés (en); el texto se compara sin tildes.
// Se prueban los dos idiomas siempre; la respuesta sale en el idioma de la interfaz.
const INTENCIONES = [
  { es: /^(hola|buenas|buenos dias|buenas tardes|buenas noches|hey|saludos|que tal)\b/, en: /^(hello|hi|hey|good (morning|afternoon|evening)|greetings)\b/, r: txt("b.hola") },
  { es: /(que puedes|que sabes|ayuda|ayudame|que haces|opciones|como funcionas)/, en: /(what can you|\bhelp|what do you do|options|how do you work)/, r: txt("b.ayuda") },
  { es: /(pronostic|predic|futuro|proxim[oa]|alerta|despeg|aterriz|vuelo|cerrar|cierre|seguro volar|autoriz|operacion)/, en: /(\bforecast|\bpredict|\bfuture|\balert|takeoff|landing|flight|closure|will .* close|safe to fly|authori[sz]|\boperation)/, r: txt("b.pron", ["q.escala", "q.limites"]) },
  { es: /(cambio climatico|calentamiento|causa|culpa|por que (aument|llueve|llovio)|el nino|huracan|tormenta)/, en: /(climate change|\bwarming|\bcause|\bblame|why (is|does|did).*(rain|increas)|el nino|\bhurricane|\bstorm)/, r: txt("b.causa", ["q.limites", "q.extremo"]) },
  { es: /(ficha|copiar|exportar|compartir)/, en: /(evidence (sheet|card)|\bcopy|\bexport|\bshare)/, r: txt("b.ficha") },
  { es: /(este sitio|este punto|este aeropuerto|sitio seleccionado|el seleccionado|este resultado|interpreta|que dice)/, en: /(this site|this point|this \bairport|\bselected site|\bselected one|this result|interpret|what does it say)/, r: (c) => ({ t: c.actual ? lectura(c.actual) : t("b.nosel") }) },
  { es: /(resumen|panorama|vision general|todos los sitios|toda centroamerica|region)/, en: /(\bsummary|\boverview|all sites|all of central america|\bregion)/, r: (c) => ({ t: resumenRegional(c.datos.sitios), s: ["q.aum", "q.dis"] }) },
  { es: /(donde|cual|que sitio|que pais).*(aument|crec|subi|mas dias)|(mayor|mas).*(aument|crecimiento|incremento)/, en: /(where|which).*(increas|rose|grew|more days)|(biggest|largest|greatest|most).*(increase|growth|rise)/,
    r: (c) => { const s = extremo(c.datos.sitios, 1); const ok = s.estado === "creciente"; return { t: t(ok ? "b.aum.ok" : "b.aum.no", { pais: nombreCorto(s), b: fmt(s.pendiente_dias_decada), lo: fmt(s.ic95_dias_decada?.[0]), hi: fmt(s.ic95_dias_decada?.[1]) }), ir: s.id }; } },
  { es: /(donde|cual|que sitio|que pais).*(disminu|baj|decre|menos dias)|(mayor|mas).*(disminucion|descenso|caida)/, en: /(where|which).*(decreas|declin|fell|drop|fewer days)|(biggest|largest|greatest|most).*(decrease|decline|drop)/,
    r: (c) => { const s = extremo(c.datos.sitios, -1); const ok = s.estado === "decreciente"; return { t: t(ok ? "b.dis.ok" : "b.dis.no", { pais: nombreCorto(s), b: fmt(s.pendiente_dias_decada), lo: fmt(s.ic95_dias_decada?.[0]), hi: fmt(s.ic95_dias_decada?.[1]) }), ir: s.id }; } },
  { es: /(cuantos sitios|que sitios|cuales sitios|que paises|lista|que aeropuertos)/, en: /(how many sites|which sites|which countries|list|which airports)/,
    r: (c) => ({ t: t("b.lista", { n: c.datos.sitios.length, l: c.datos.sitios.map((s) => `• ${nombreCorto(s)}: ${nombreLargo(s)}`).join("\n") }), s: ["q.resumen"] }) },
  { es: /(no concluyente|inconclus|sin evidencia|color gris|gris)/, en: /(\binconclusive|no evidence|not enough evidence|grey|gray)/, r: txt("b.nc") },
  { es: /(percentil|umbral|dia extremo|dias extremos|lluvia extrema|extremo)/, en: /(\bpercentile|\bthreshold|extreme day|extreme days|extreme rain)/, r: txt("b.perc", ["q.grafico", "q.theil"]) },
  { es: /(theil|pendiente|dias por decada|tasa de cambio)/, en: /(theil|\bslope|days per decade|rate of change)/, r: txt("b.theil", ["q.mann", "q.ic"]) },
  { es: /(mann|kendall|prueba de tendencia)/, en: /(mann|kendall|trend test)/, r: txt("b.mann", ["q.p", "q.holm"]) },
  { es: /(holm|multiple|ajustad|bonferroni|varios sitios)/, en: /(holm|\bmultiple|\badjust|bonferroni|several sites)/, r: txt("b.holm") },
  { es: /(valor p|p valor|p-valor|significan|significativ|significancia)/, en: /(p.?value|significan)/, r: txt("b.p") },
  { es: /(intervalo|confianza|ic ?95|incertidumbre)/, en: /(\binterval|\bconfidence|ci ?95|\buncertainty)/, r: txt("b.ic", ["q.nc"]) },
  { es: /(resolucion|10 ?km|celda|pixel|pista|terminal|escala|precision)/, en: /(\bresolution|10 ?km|\bcell|pixel|\brunway|\bterminal|\bscale|\bprecision)/, r: txt("b.res") },
  { es: /(sintetic|simulad|practica|inventad|son reales|datos reales|verdader|confiable|fiable)/, en: /(synthetic|simulated|practice|fake|real data|are (they|these) real|reliable|trustworthy)/,
    r: (c) => { const m = metaVista(c.datos.meta, c.datos.sitios); return { t: c.datos.meta.sintetico ? t("b.sint.si") : t("b.sint.no", { prod: m.producto, ver: m.version }) }; } },
  { es: /(fuente|nasa|imerg|gpm|version|de donde|descarg|satelit|datos)/, en: /(source|nasa|imerg|gpm|version|where (is|does|do).*(from|come)|download|satellite|data)/,
    r: (c) => ({ t: t("b.fuente", { ver: metaVista(c.datos.meta, c.datos.sitios).version }) }) },
  { es: /(periodo|anos|anios|2001|2020|base|cobertura|faltante)/, en: /(\bperiod|\byears|2001|2020|\bbaseline|\bcoverage|\bmissing)/, r: (c) => ({ t: t("b.periodo", { per: metaVista(c.datos.meta, c.datos.sitios).periodo }) }) },
  { es: /(grafic|barras|linea|leer|leo |lectura|como se lee|interpretar)/, en: /(\bchart|\bgraph|\bbars|\bline|\bread|\breading|how to \bread)/, r: txt("b.grafico", ["q.theil", "q.nc"]) },
  { es: /(siete|\b7\b|por que.*(pais|aeropuerto|sitio)|aeropuerto|conectividad|nodo)/, en: /(\bseven|\b7\b|why.*(countr|\bairport|site)|\bairport|\bconnectivity|\bnode)/, r: txt("b.siete") },
  { es: /(limite|limitacion|que no (puede|muestra|dice|concluy)|no puede concluir|no sirve)/, en: /(\blimit|\blimitation|what (can ?t|cannot|does not|doesn ?t)|cannot conclude|can ?t be concluded)/, r: txt("b.limites") },
  { es: /(quien|para que sirve|utilidad|usuario|planificacion|proteccion civil|decision|impacto)/, en: /(\bwho|what is it for|useful|\busers|\bplanning|civil protection|\bdecision|\bimpact)/, r: txt("b.usuarios") },
  { es: /(que es|de que trata|proyecto|atlas|mesoamerica|objetivo|pregunta)/, en: /(what is|what ?s|\babout|\bproject|atlas|mesoamerica|\bgoal|question)/, r: txt("b.que", ["q.resumen", "q.extremo"]) },
  { es: /(como uso|como navego|donde (toco|hago|veo)|mapa|clic|click|tocar|seleccionar)/, en: /(how do i use|how to navigate|where (do i|can i)|\bmap|\bclick|\btap|\bselect)/, r: txt("b.nav") },
];
const coincide = (i, texto) => i.es.test(texto) || i.en.test(texto);

export function responder(texto, ctx) {
  const n = normaliza(texto);
  if (!n) return { t: t("b.empty") };
  // Seguridad: saludo, ayuda, pronóstico y causas se responden antes que cualquier lectura de sitio.
  for (const i of INTENCIONES.slice(0, 4)) if (coincide(i, n)) return i.r(ctx);

  const sitios = sitiosMencionados(n, ctx.datos.sitios);
  if (sitios.length >= 2) return { t: comparar(sitios[0], sitios[1]), ir: sitios[0].id, s: ["q.resumen"] };
  if (sitios.length === 1) {
    const s = sitios[0];
    return { t: t("b.sitio", { lect: lectura(s), u: fmt(s.umbral_mm) }), ir: s.id, s: ["q.comp", "q.grafico"] };
  }
  if (/compara|compare/.test(n)) return { t: t("b.comp.pide") };
  for (const i of INTENCIONES.slice(4)) if (coincide(i, n)) return i.r(ctx);
  return { t: t("b.fallback"), s: SUGERENCIAS };
}

export function crearAsistente({ datos, seleccionar, actual }) {
  const log = el("div", { class: "chat-log", role: "log", "aria-live": "polite" });
  const chips = el("div", { class: "chat-chips" });
  const entrada = el("input", { type: "text", id: "chat-entrada", autocomplete: "off", maxlength: "200" });
  const enviar = el("button", { type: "submit", class: "btn btn-lima" });
  const form = el("form", { class: "chat-form" }, entrada, enviar);
  const cerrarBtn = el("button", { type: "button", class: "chat-cerrar" }, "✕");
  const titulo = el("strong"), sub = el("span", { class: "sub" });
  const panel = el("section", { class: "chat", id: "asistente", role: "dialog", hidden: true },
    el("header", { class: "chat-cab" }, el("div", {}, titulo, sub), cerrarBtn), log, chips, form);
  const fabTxt = el("span");
  const fab = el("button", { type: "button", class: "chat-fab", "aria-expanded": "false", "aria-controls": "asistente" },
    el("span", { class: "chat-fab-punto", "aria-hidden": "true" }), fabTxt);
  document.body.append(panel, fab);

  const reducido = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const burbuja = (quien, texto) => { log.append(el("p", { class: `msj msj-${quien}` }, texto)); log.scrollTop = log.scrollHeight; };
  // Las sugerencias se guardan como claves: así se re-traducen solas al cambiar de idioma.
  let sugeridas = SUGERENCIAS;
  const sugerir = (claves) => { sugeridas = claves; chips.replaceChildren(...claves.map((k) => el("button", { type: "button", class: "chip", onclick: () => preguntar(t(k)) }, t(k)))); };

  function etiquetas() {
    titulo.textContent = t("chat.title"); sub.textContent = t("chat.sub");
    cerrarBtn.setAttribute("aria-label", t("chat.close")); fabTxt.textContent = t("chat.fab");
    panel.setAttribute("aria-label", t("chat.dialog")); log.setAttribute("aria-label", t("chat.log"));
    entrada.placeholder = t("chat.ph"); entrada.setAttribute("aria-label", t("chat.input")); enviar.textContent = t("chat.send");
  }
  function saludo() {
    log.replaceChildren();
    burbuja("bot", t("chat.hello", { sint: datos.meta.sintetico ? t("chat.sint") : "" }));
    sugerir(SUGERENCIAS);
  }

  function preguntar(q) {
    const texto = (q ?? entrada.value).trim();
    if (!texto) return;
    entrada.value = "";
    burbuja("yo", texto);
    const res = responder(texto, { datos, actual: actual() });
    const mostrar = () => {
      burbuja("bot", res.t);
      if (res.ir) { seleccionar(res.ir, { desplazar: window.innerWidth >= 720 }); if (window.innerWidth < 720) alternar(false); }
      sugerir(res.s ?? SUGERENCIAS);
    };
    reducido ? mostrar() : setTimeout(mostrar, 250);
  }

  function alternar(abrir = panel.hidden) {
    panel.hidden = !abrir;
    fab.setAttribute("aria-expanded", String(abrir));
    fab.classList.toggle("oculto", abrir && window.innerWidth < 720);
    if (abrir) entrada.focus(); else fab.focus({ preventScroll: true });
  }
  form.addEventListener("submit", (e) => { e.preventDefault(); preguntar(); });
  fab.addEventListener("click", () => alternar());
  cerrarBtn.addEventListener("click", () => alternar(false));
  panel.addEventListener("keydown", (e) => { if (e.key === "Escape") alternar(false); });

  etiquetas(); saludo();
  onLang(() => { etiquetas(); saludo(); });
  return { abrir: () => alternar(true), alternar };
}
