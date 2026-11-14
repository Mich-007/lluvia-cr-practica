// Utilidades compartidas. Todo el texto de datos se inserta con textContent/append (nunca innerHTML).
import { t, locale, getLang } from "./i18n.js";

export const $ = (id) => document.getElementById(id);

export function el(tag, props = {}, ...hijos) {
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

// Los textos son getters: cambian solos cuando cambia el idioma.
const estado = (k, color, simbolo) => ({
  color, simbolo,
  get texto() { return t(`estado.${k}.texto`); },
  get corto() { return t(`estado.${k}.corto`); },
});
export const ESTADO = {
  creciente: estado("creciente", "#ff8a65", "▲"),
  decreciente: estado("decreciente", "#80cfff", "▼"),
  no_concluyente: estado("no_concluyente", "#c3ccd2", "●"),
};

export const fmt = (n, d = 1) =>
  typeof n === "number" && Number.isFinite(n) ? n.toLocaleString(locale(), { minimumFractionDigits: 0, maximumFractionDigits: d }) : "—";

// p-valor: muestra "< 0,001" en vez de 0 cuando es muy pequeño.
export const fmtP = (p) => (typeof p !== "number" ? "—" : p < 0.001 ? "< 0.001".replace(".", getLang() === "en" ? "." : ",") : fmt(p, 3));

// Minúsculas sin tildes, para comparar texto escrito por la persona.
export const normaliza = (x) =>
  String(x).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9ñ\s.%-]/g, " ").replace(/\s+/g, " ").trim();

export const rango = (s) => `${s.anios[0]}–${s.anios[s.anios.length - 1]}`;

export const PAISES_EN = { Belice: "Belize", "Panamá": "Panama" };
export const paisTxt = (pais) => (getLang() === "en" ? PAISES_EN[pais] ?? pais : pais);
export const nombreCorto = (s) => paisTxt(s.pais) ?? s.nombre;
// "Aeropuerto Internacional de Tocumen" -> "Tocumen International Airport" en inglés.
export const nombreLargo = (s) =>
  getLang() === "en" ? s.nombre.replace(/^Aeropuerto Internacional (?:de )?(.+)$/, "$1 International Airport") : s.nombre;
