/* Phyllobytes · módulo «util» (script clásico: funciona al abrir index.html con doble clic, sin servidor). */
(function () {
"use strict";
// Utilidades compartidas. El texto de los datos siempre se inserta con textContent/append (nunca innerHTML).
const { t, locale, getLang } = PHY.i18n;

const $ = (id) => document.getElementById(id);
function el(tag, props = {}, ...hijos) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const h of hijos) if (h !== undefined && h !== null) e.append(h);
  return e;
}
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

// Colores y textos de cada estado. Los colores salen del tema activo (CSS), así cambian con el modo daltonismo / contraste.
const estado = (k, v, simbolo) => ({
  get color() { return css(v); }, simbolo,
  get texto() { return t(`estado.${k}.texto`); },
  get corto() { return t(`estado.${k}.corto`); },
});
const ESTADO = {
  creciente: estado("creciente", "--c-up", "▲"),
  decreciente: estado("decreciente", "--c-down", "▼"),
  no_concluyente: estado("no_concluyente", "--c-nc", "●"),
  pendiente: { get color() { return css("--c-nc"); }, simbolo: "?", get texto() { return t("estado.pendiente.texto"); }, get corto() { return t("estado.pendiente.corto"); } },
};
const estadoDe = (s) => (s.datos ? ESTADO[s.estado] : ESTADO.pendiente);

const fmt = (n, d = 1) => (typeof n === "number" && Number.isFinite(n) ? n.toLocaleString(locale(), { minimumFractionDigits: 0, maximumFractionDigits: d }) : "—");
const fmtP = (p) => (typeof p !== "number" ? "—" : p < 0.001 ? (getLang() === "en" ? "< 0.001" : "< 0,001") : fmt(p, 3));
const fmtS = (n, d = 1) => (typeof n === "number" && Number.isFinite(n) ? (n > 0 ? "+" : "") + fmt(n, d) : "—"); // con signo
const normaliza = (x) => String(x).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9ñ\s.%-]/g, " ").replace(/\s+/g, " ").trim();
const rango = (s) => `${s.anios[0]}–${s.anios[s.anios.length - 1]}`;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const coordTxt = (lat, lon) => `${fmt(lat, 3)}° N, ${fmt(Math.abs(lon), 3)}° ${getLang() === "en" ? "W" : "O"}`;
function descarga(nombre, texto, tipo = "text/plain") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([texto], { type: `${tipo};charset=utf-8` }));
  a.download = nombre; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
PHY.util = { el, descarga, $, css, ESTADO, estadoDe, fmt, fmtP, fmtS, normaliza, rango, clamp, coordTxt };
})();
