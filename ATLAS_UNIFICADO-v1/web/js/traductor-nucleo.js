/* Atlas unificado · núcleo del traductor de textos generados por el análisis (español → inglés).
 *
 * El atlas y el servidor escriben sus frases en español (títulos de figuras, notas, avisos). En lugar de
 * cambiar esa lógica, cuando la página está en inglés cada texto visible pasa por traducir():
 *   1) se separa el HTML en etiquetas y trozos de texto (solo se traduce el texto);
 *   2) cada trozo se busca tal cual y como plantilla con comodines {} (cifras, nombres, frases);
 *   3) si no coincide entero, se traduce oración por oración (y por « · » / « • »);
 *   4) en etiquetas cortas se reemplazan términos sueltos, pero solo si no queda una mezcla de idiomas.
 * El diccionario está en traductor-diccionario.js. Lo que no se encuentra queda en español: nunca se inventa.
 */
(function () {
"use strict";
const PLANTILLAS = [];          // [{re, en, largo}]
const EXACTO = new Map();       // texto ES → EN
const FRASES = [];              // [re, en, largo] reemplazos parciales para etiquetas cortas
const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Fronteras de oración: tras . ! ? seguido de espacio y mayúscula/apertura. (El punto y coma NO corta.)
const ORACION = /(\s[·•]\s+|(?<=[.!?])\s+(?=[¿«"“A-ZÁÉÍÓÚÑ(]))/;

function registrar(es, en) {
  // Una plantilla debe tener texto propio (al menos 3 letras fuera de los comodines): «{}» o «{}.» coincidirían con todo.
  if ((es.replace(/\{\}/g, "").match(/\p{L}/gu) || []).length < 3) return;
  if (!es.includes("{}")) { if (!EXACTO.has(es)) EXACTO.set(es, en); return; }
  const partes = es.split("{}").map(escapar);
  // Un comodín no cruza el límite entre oraciones («. » seguido de mayúscula): así no arrastra la frase siguiente.
  const comodin = String.raw`((?:(?![.!?]\s+[¿«A-ZÁÉÍÓÚÑ])[\s\S])+?)`;
  PLANTILLAS.push({ re: new RegExp("^" + partes.join(comodin) + "$", "u"), en, largo: es.replace(/\{\}/g, "").length });
}
function cargar(pares, frases) {
  for (const [es, en] of pares) {
    registrar(es, en);
    // Además, cada oración por separado (si ambas versiones tienen el mismo número de oraciones y comodines).
    const a = es.split(ORACION).filter((x, i) => i % 2 === 0), b = en.split(ORACION).filter((x, i) => i % 2 === 0);
    if (a.length > 1 && a.length === b.length) a.forEach((s, i) => { const ns = (s.match(/\{\}/g) || []).length, nb = (b[i].match(/\{\d*\}/g) || []).length; if (ns === nb && !/\{\d/.test(b[i])) registrar(s.trim(), b[i].trim()); });
  }
  PLANTILLAS.sort((x, y) => y.largo - x.largo);
  for (const [es, en] of frases || []) FRASES.push([new RegExp("(^|[^\\p{L}])" + escapar(es) + "(?=$|[^\\p{L}])", "gu"), en, es.length]);
  FRASES.sort((x, y) => y[2] - x[2]);
}

function rellenar(en, grupos) {
  let i = 0;
  return en.replace(/\{(\d*)\}/g, (_, k) => (k !== "" ? grupos[+k] ?? "" : grupos[i++] ?? ""));
}

let profundidad = 0;
// Coincidencia exacta o por plantilla. Los comodines se traducen a su vez (p. ej. «Días > P95» dentro de un título).
function directo(core) {
  if (!core) return undefined;
  const e = EXACTO.get(core);
  if (e !== undefined) return e;
  for (const p of PLANTILLAS) {
    // Una plantilla corta («{} días», «Robustez: {}») no puede tragarse una frase larga: debe cubrir parte del texto.
    if (core.length > 60 && p.largo / core.length < 0.25) continue;
    const m = core.match(p.re);
    if (m) {
      if (profundidad > 3) return rellenar(p.en, m.slice(1));
      profundidad++;
      try { return rellenar(p.en, m.slice(1).map((g) => { const t = g.trim(); return t && /\p{L}{2,}/u.test(t) ? g.replace(t, trozo(t)) : g; })); }
      finally { profundidad--; }
    }
  }
  return undefined;
}
// Prueba también sin el punto / dos puntos final y sin separadores iniciales («· », «: »).
function conBordes(core) {
  let r = directo(core); if (r !== undefined) return r;
  const ini = core.match(/^([·•,;:\s]+)([\s\S]*)$/);              // 1) solo separadores iniciales
  if (ini) { r = directo(ini[2]); if (r !== undefined) return ini[1] + r; }
  const m = core.match(/^([·•,;:\s]*)([\s\S]*?)([.:,;·\s]+)$/);     // 2) también el signo final
  if (m) { r = directo(m[2]); if (r !== undefined) return m[1] + r + m[3]; }
  return undefined;
}
const MEZCLA = /(^|[^\p{L}])(de|del|la|las|el|los|por|con|en|y|que|para|una|uno|sin)(?=$|[^\p{L}])/u;
// Términos sueltos solo en etiquetas cortas (≤ 5 palabras) y solo si no queda una mezcla de idiomas.
function corto(x) {
  const t = x.trim();
  if (!t || t.split(/\s+/).length > 5) return x;
  let out = t;
  for (const [re, en] of FRASES) out = out.replace(re, (m0, pre) => pre + en);
  if (out === t || MEZCLA.test(out)) return x;
  return x.replace(t, out);
}

const cache = new Map();
function trozo(core) {
  if (!core || !/\p{L}/u.test(core)) return core;
  if (cache.has(core)) return cache.get(core);
  let out = conBordes(core);
  if (out === undefined) {
    const piezas = core.split(ORACION);
    if (piezas.length > 1) {
      let alguna = false;
      const t = piezas.map((x, i) => {
        if (i % 2) return x;
        const r = conBordes(x.trim());
        if (r !== undefined) { alguna = true; return x.replace(x.trim(), r); }
        return corto(x);
      });
      if (alguna) out = t.join("");
    }
  }
  if (out === undefined) out = corto(core);
  if (cache.size > 6000) cache.clear();
  cache.set(core, out);
  return out;
}

const decod = (s) => s.replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
const codif = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// En inglés la coma decimal pasa a punto («4,7» → «4.7»). No toca miles separados por espacio ni %{...} de Plotly.
const decimales = (s) => s.replace(/(^|[^\d,{])([-+−]?\d+),(\d+)(?![\d,])/g, "$1$2.$3");
function traducir(texto) {
  if (typeof texto !== "string" || !texto) return texto;
  if (!/[A-Za-zÁÉÍÓÚáéíóúñÑ]/.test(texto)) return /\d,\d/.test(texto) ? decimales(texto) : texto;
  return texto.split(/(<[^>]*>)/).map((parte) => {
    if (parte.startsWith("<")) return parte;
    const d = decod(parte), entidades = d !== parte;
    const m = d.match(/^(\s*)([\s\S]*?)(\s*)$/);
    const r = m[1] + decimales(trozo(m[2].replace(/ /g, " "))) + m[3];
    return entidades ? codif(r) : r;
  }).join("");
}

window.PHY = window.PHY || {};
PHY.traductor = { cargar, traducir, _exacto: EXACTO, _plantillas: PLANTILLAS };
})();
