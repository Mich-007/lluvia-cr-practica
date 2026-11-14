// Asistente de Phyllobytes. Funciona SIN internet y SIN API de IA: responde con textos preparados (i18n.js)
// y con cifras leídas de los resultados que ya están en pantalla. No calcula tendencias, no pronostica y no atribuye causas.
// Entiende español e inglés y responde en el idioma de la interfaz. Para conectar un modelo de IA en el futuro,
// `responder()` es el único punto que habría que reemplazar.
import { el, fmt, fmtP, fmtS, normaliza } from "./util.js";
import { t, onLang } from "./i18n.js";
import { lectura, resumenRegional, provNombre } from "./texto.js";
import { PROVINCIAS } from "./geo.js";

const SUGERENCIAS = ["q.que", "q.datos", "q.punto", "q.extremo", "q.nc"];

function sitiosMencionados(txt, sitios) {
  const hallados = [];
  for (const s of sitios) {
    const nombres = [normaliza(s.nombre), normaliza(provNombre(s.prov) ?? ""), normaliza(s.id)].filter((x) => x.length >= 2);
    let pos = -1;
    for (const a of new Set(nombres)) {
      const m = new RegExp(`(^|\\s)${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`).exec(txt);
      if (m && (pos === -1 || m.index < pos)) pos = m.index;
    }
    if (pos !== -1) hallados.push({ s, pos });
  }
  return hallados.sort((a, b) => a.pos - b.pos).map((h) => h.s);
}
const con = (ctx) => ctx.sitios.filter((s) => s.datos);
const extremo = (lista, signo) => [...lista].sort((a, b) => signo * (b.tend.pendienteDecada - a.tend.pendienteDecada))[0];
const txt = (clave, s) => () => ({ t: t(clave), s });

function comparar(a, b) {
  if (!a.datos || !b.datos) return t("b.cmp.sin");
  const sentido = (s) => t(s.estado === "creciente" ? "b.cmp.up" : s.estado === "decreciente" ? "b.cmp.dn" : "b.cmp.nc");
  const fila = (s) => t("b.cmp.row", { nombre: s.nombre, sentido: sentido(s), b: fmtS(s.tend.pendienteDecada), lo: fmt(s.tend.ic95Decada?.[0]), hi: fmt(s.tend.ic95Decada?.[1]), p: fmtP(s.pHolm), u: fmt(s.umbral) });
  const [a1, a2] = a.tend.ic95Decada ?? [], [b1, b2] = b.tend.ic95Decada ?? [];
  const solapan = a1 <= b2 && b1 <= a2;
  return `${fila(a)}\n${fila(b)}\n${t(solapan ? "b.cmp.ov" : "b.cmp.nov")}\n${t("b.cmp.foot")}`;
}

// Cada intención: patrón en español (es) y en inglés (en), sobre texto sin tildes. Se prueban ambos idiomas.
const I = [
  { es: /^(hola|buenas|buenos dias|buenas tardes|buenas noches|hey|saludos|que tal)\b/, en: /^(hello|hi|hey|good (morning|afternoon|evening)|greetings)\b/, r: txt("b.hola") },
  { es: /(que puedes|que sabes|ayuda|ayudame|que haces|opciones|como funcionas)/, en: /(what can you|\bhelp\b|what do you do|options|how do you work)/, r: txt("b.ayuda") },
  { es: /(pronostic|predic|futuro|proxim[oa]|alerta|inundacion|deslizamiento|riesgo|peligro|evacu)/, en: /(\bforecast|\bpredict|\bfuture|\balert|\bflood|landslide|\brisk|\bdanger|\bevacuat)/, r: txt("b.pron", ["q.limites", "q.extremo"]) },
  { es: /(cambio climatico|calentamiento|causa|culpa|por que (aument|llueve|llovio)|el nino|huracan|tormenta)/, en: /(climate change|\bwarming|\bcause|\bblame|why (is|does|did).*(rain|increas)|el nino|\bhurricane|\bstorm)/, r: txt("b.causa", ["q.limites", "q.extremo"]) },
  { es: /(ficha|copiar|exportar|compartir)/, en: /(evidence (sheet|card)|\bcopy|\bexport|\bshare)/, r: txt("b.ficha") },
  { es: /(este sitio|este punto|sitio seleccionado|el seleccionado|este resultado|interpreta|que dice)/, en: /(this site|this point|selected site|selected one|this result|\binterpret|what does it say)/, r: (c) => ({ t: c.actual ? lectura(c.actual) : t("b.nosel") }) },
  { es: /(resumen|panorama|vision general|todos los sitios|todo el pais|region)/, en: /(\bsummary|\boverview|all sites|whole country|\bregion)/, r: (c) => ({ t: resumenRegional(c.sitios), s: ["q.aum", "q.dis"] }) },
  { es: /(donde|cual|que sitio|que provincia).*(aument|crec|subi|mas dias)|(mayor|mas).*(aument|crecimiento|incremento)/, en: /(where|which).*(increas|rose|grew|more days)|(biggest|largest|greatest|most).*(increase|growth|rise)/,
    r: (c) => { const l = con(c); if (!l.length) return { t: t("b.sindatos") }; const s = extremo(l, 1); return { t: t(s.estado === "creciente" ? "b.aum.ok" : "b.aum.no", { nombre: s.nombre, b: fmtS(s.tend.pendienteDecada), lo: fmt(s.tend.ic95Decada?.[0]), hi: fmt(s.tend.ic95Decada?.[1]) }), ir: s.id }; } },
  { es: /(donde|cual|que sitio|que provincia).*(disminu|baj|decre|menos dias)|(mayor|mas).*(disminucion|descenso|caida)/, en: /(where|which).*(decreas|declin|fell|drop|fewer days)|(biggest|largest|greatest|most).*(decrease|decline|drop)/,
    r: (c) => { const l = con(c); if (!l.length) return { t: t("b.sindatos") }; const s = extremo(l, -1); return { t: t(s.estado === "decreciente" ? "b.dis.ok" : "b.dis.no", { nombre: s.nombre, b: fmtS(s.tend.pendienteDecada), lo: fmt(s.tend.ic95Decada?.[0]), hi: fmt(s.tend.ic95Decada?.[1]) }), ir: s.id }; } },
  { es: /(cuantos (sitios|puntos)|que (sitios|puntos|provincias)|cuales (sitios|puntos|provincias)|lista|provincias)/, en: /(how many (sites|points)|which (sites|points|provinces)|\blist\b|provinces)/,
    r: (c) => ({ t: t("b.lista", { n: c.sitios.length, l: c.sitios.map((s) => `• ${s.nombre}${provNombre(s.prov) ? ` (${provNombre(s.prov)})` : ""}`).join("\n") }), s: ["q.resumen"] }) },
  { es: /(no concluyente|inconclus|sin evidencia|color gris|gris)/, en: /(inconclusive|no evidence|not enough evidence|\bgrey|\bgray)/, r: txt("b.nc") },
  { es: /(mapa de calor|calor|curvas de nivel|bandas|colores del mapa|interpolacion)/, en: /(heat ?map|\bheat\b|contour|\bbands|map colou?rs|interpolat)/, r: txt("b.calor", ["q.punto", "q.daltonismo"]) },
  { es: /(agregar|anadir|elegir|escoger|poner|quitar|borrar).*(punto|coordenada|sitio|lugar)|como (elijo|agrego|pongo|selecciono)|coordenada/, en: /(add|choose|pick|select|remove|delete|place).*(point|coordinate|site|place)|how (do i|to) (choose|add|pick|select)|\bcoordinate/, r: txt("b.punto", ["q.analizar", "q.calor"]) },
  { es: /(analiz|analisis real|servidor|spyder|descargar datos|no funciona|no carga|python)/, en: /(\banaly[sz]e|real analysis|\bserver|spyder|download data|not working|doesn t work|\bpython)/, r: (c) => ({ t: t(c.servidor ? "b.analizar.si" : "b.analizar.no"), s: ["q.datos"] }) },
  { es: /(como (se )?(recolect|obtien|consigu|llegan)|de donde (vienen|salen|sacan)|recoleccion|nasa power|satelit|fuente|imerg|gpm|merra|datos de nasa)/, en: /(how (is|are|do|does).*(collect|obtain|gather|come|get)|where (do|does|is|are).*(from|come)|collection|nasa power|satellite|\bsource|imerg|gpm|merra)/, r: txt("b.datos", ["q.demo", "q.extremo"]) },
  { es: /(sintetic|simulad|demostracion|demo|son reales|datos reales|verdader|confiable|fiable)/, en: /(synthetic|simulated|demonstration|\bdemo\b|(is|are) (they|these|it|the data|the results).{0,12}real|real data|reliable|trustworthy)/, r: (c) => ({ t: t(c.demo ? "b.demo.si" : "b.demo.no"), s: ["q.analizar"] }) },
  { es: /(daltonismo|daltonico|ceguera de color|colores aptos|contraste|letra grande|accesibilidad|tamano de letra|lector de pantalla)/, en: /(colou?r ?blind|daltonism|contrast|large text|big text|accessib|font size|screen reader)/, r: txt("b.a11y") },
  { es: /(idioma|ingles|espanol|traducir)/, en: /(language|english|spanish|translate)/, r: txt("b.idioma") },
  { es: /(percentil|umbral|dia extremo|dias extremos|lluvia extrema|lluvia fuerte|extremo)/, en: /(percentile|threshold|extreme day|extreme days|extreme rain|heavy.?rain|strong rain)/, r: txt("b.perc", ["q.grafico", "q.theil"]) },
  { es: /(theil|pendiente|dias por decada|tasa de cambio|tendencia)/, en: /(theil|\bslope|days per decade|rate of change|\btrend)/, r: txt("b.theil", ["q.mann", "q.ic"]) },
  { es: /(mann|kendall|prueba de tendencia)/, en: /(mann|kendall|trend test)/, r: txt("b.mann", ["q.p", "q.holm"]) },
  { es: /(holm|multiple|ajustad|bonferroni|varios sitios)/, en: /(holm|\bmultiple|\badjust|bonferroni|several sites)/, r: txt("b.holm") },
  { es: /(valor p|p valor|p-valor|significan|significativ|significancia)/, en: /(p.?value|significan)/, r: txt("b.p") },
  { es: /(intervalo|confianza|ic ?95|incertidumbre)/, en: /(\binterval|\bconfidence|ci ?95|\buncertainty)/, r: txt("b.ic", ["q.nc"]) },
  { es: /(resolucion|10 ?km|celda|pixel|escala|precision|exacta)/, en: /(\bresolution|10 ?km|\bcell|\bpixel|\bscale|\bprecision|\bexact)/, r: txt("b.res") },
  { es: /(periodo|anos|anios|2001|2020|base|cobertura|faltante)/, en: /(\bperiod|\byears|2001|2020|\bbaseline|\bcoverage|\bmissing)/, r: txt("b.periodo") },
  { es: /(grafic|barras|linea|leer|leo |lectura|como se lee|interpretar)/, en: /(\bchart|\bgraph|\bbars|\bline\b|\bread\b|\breading|how to read)/, r: txt("b.grafico", ["q.theil", "q.nc"]) },
  { es: /(limite|limitacion|que no (puede|muestra|dice|concluy)|no puede concluir|no sirve)/, en: /(\blimit|\blimitation|what (can ?t|cannot|does not|doesn ?t)|cannot conclude|can ?t be concluded)/, r: txt("b.limites") },
  { es: /(quien|para que sirve|utilidad|usuario|planificacion|proteccion civil|decision|impacto|agua|ambiente)/, en: /(\bwho\b|what is it for|\buseful|\busers|\bplanning|civil protection|\bdecision|\bimpact|\bwater|environment)/, r: txt("b.usuarios") },
  { es: /(que es|de que trata|proyecto|phyllobytes|rana|objetivo|pregunta)/, en: /(what is|what ?s|\babout\b|\bproject|phyllobytes|\bfrog|\bgoal|\bquestion)/, r: txt("b.que", ["q.datos", "q.punto"]) },
  { es: /(como uso|como navego|donde (toco|hago|veo)|mapa|clic|click|tocar|seleccionar|aprende|aprender)/, en: /(how do i use|how to navigate|where (do i|can i)|\bmap\b|\bclick|\btap\b|\bselect|\blearn)/, r: txt("b.nav") },
];
const coincide = (i, x) => i.es.test(x) || i.en.test(x);

export function responder(texto, ctx) {
  const n = normaliza(texto);
  if (!n) return { t: t("b.empty") };
  for (const i of I.slice(0, 4)) if (coincide(i, n)) return i.r(ctx); // saludo, ayuda, pronóstico y causas siempre primero
  const sitios = sitiosMencionados(n, ctx.sitios);
  if (sitios.length >= 2) return { t: comparar(sitios[0], sitios[1]), ir: sitios[0].id, s: ["q.resumen"] };
  if (sitios.length === 1) {
    const s = sitios[0];
    return { t: `${lectura(s)}\n${t("b.sitio.fin", { u: s.datos ? fmt(s.umbral) : "—" })}`, ir: s.id, s: ["q.comp", "q.grafico"] };
  }
  if (/compara|compare/.test(n)) return { t: t("b.comp.pide") };
  for (const i of I.slice(4)) if (coincide(i, n)) return i.r(ctx);
  return { t: t("b.fallback"), s: SUGERENCIAS };
}

export function crearAsistente({ obtener, seleccionar, abrirSeccion }) {
  const log = el("div", { class: "chat-log", role: "log", "aria-live": "polite" });
  const chips = el("div", { class: "chat-chips" });
  const entrada = el("input", { type: "text", id: "chat-entrada", autocomplete: "off", maxlength: "200" });
  const enviar = el("button", { type: "submit", class: "btn btn-cian" });
  const form = el("form", { class: "chat-form" }, entrada, enviar);
  const cerrarBtn = el("button", { type: "button", class: "chat-cerrar" }, "✕");
  const titulo = el("strong"), sub = el("span", { class: "sub" });
  const panel = el("section", { class: "chat", id: "asistente", role: "dialog", hidden: true }, el("header", { class: "chat-cab" }, el("div", {}, titulo, sub), cerrarBtn), log, chips, form);
  const fabTxt = el("span");
  const fab = el("button", { type: "button", class: "chat-fab", "aria-expanded": "false", "aria-controls": "asistente" }, el("span", { class: "chat-fab-punto", "aria-hidden": "true" }), fabTxt);
  document.body.append(panel, fab);

  const reducido = () => document.documentElement.dataset.movimiento === "reducido" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const burbuja = (quien, texto) => { log.append(el("p", { class: `msj msj-${quien}` }, texto)); log.scrollTop = log.scrollHeight; };
  const sugerir = (claves) => chips.replaceChildren(...claves.map((k) => el("button", { type: "button", class: "chip", onclick: () => preguntar(t(k)) }, t(k))));
  const etiquetas = () => {
    titulo.textContent = t("chat.title"); sub.textContent = t("chat.sub"); cerrarBtn.setAttribute("aria-label", t("chat.close")); fabTxt.textContent = t("chat.fab");
    panel.setAttribute("aria-label", t("chat.dialog")); log.setAttribute("aria-label", t("chat.log"));
    entrada.placeholder = t("chat.ph"); entrada.setAttribute("aria-label", t("chat.input")); enviar.textContent = t("chat.send");
  };
  const saludo = () => { log.replaceChildren(); burbuja("bot", t("chat.hello")); sugerir(SUGERENCIAS); };

  function preguntar(q) {
    const texto = (q ?? entrada.value).trim();
    if (!texto) return;
    entrada.value = "";
    burbuja("yo", texto);
    const res = responder(texto, obtener());
    const mostrar = () => {
      burbuja("bot", res.t);
      if (res.ir) { seleccionar(res.ir, { desplazar: window.innerWidth >= 900 }); if (window.innerWidth < 900) alternar(false); }
      sugerir(res.s ?? SUGERENCIAS);
    };
    reducido() ? mostrar() : setTimeout(mostrar, 250);
  }
  function alternar(abrir = panel.hidden) {
    panel.hidden = !abrir;
    fab.setAttribute("aria-expanded", String(abrir));
    fab.classList.toggle("oculto", abrir && window.innerWidth < 900);
    if (abrir) entrada.focus(); else fab.focus({ preventScroll: true });
  }
  form.addEventListener("submit", (e) => { e.preventDefault(); preguntar(); });
  fab.addEventListener("click", () => alternar());
  cerrarBtn.addEventListener("click", () => alternar(false));
  panel.addEventListener("keydown", (e) => { if (e.key === "Escape") alternar(false); });
  etiquetas(); saludo();
  onLang(() => { etiquetas(); saludo(); });
  return { abrir: () => alternar(true), alternar, preguntar };
}
