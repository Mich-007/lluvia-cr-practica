// Frases sencillas generadas SOLO con cifras ya calculadas. No atribuyen causas ni predicen.
import { t } from "./i18n.js";
import { fmt, fmtP, fmtS, rango, estadoDe, coordTxt } from "./util.js";
import { PROVINCIAS } from "./geo.js";

export const provNombre = (id) => PROVINCIAS.find((p) => p.id === id)?.nombre ?? null;

export function lectura(s) {
  if (!s.datos) return t("lect.pend");
  const [lo, hi] = s.tend.ic95Decada ?? [];
  const ic = typeof lo === "number" ? t("lect.ic", { lo: fmt(lo), hi: fmt(hi) }) : "";
  const p = t("lect.p", { p: fmtP(s.pHolm) });
  const clave = s.estado === "creciente" ? "lect.up" : s.estado === "decreciente" ? "lect.dn" : "lect.nc";
  const b = s.estado === "no_concluyente" ? fmt(s.tend.pendienteDecada) : fmt(Math.abs(s.tend.pendienteDecada));
  return t(clave, { nombre: s.nombre, rango: rango(s), b, ic, p });
}

export function resumenRegional(sitios) {
  const con = sitios.filter((s) => s.datos);
  const por = (e) => con.filter((s) => s.estado === e);
  const linea = (e, k) => { const a = por(e); return a.length ? t(`res.${k}`, { n: a.length, l: a.map((s) => s.nombre).join(", ") }) : t(`res.none.${k}`); };
  return [t("res.head", { n: con.length }), linea("creciente", "up"), linea("decreciente", "dn"), linea("no_concluyente", "nc"), t("res.foot")].join("\n");
}

export function fichaTexto(s, fuente) {
  const [lo, hi] = s.tend?.ic95Decada ?? [];
  const prov = provNombre(s.prov);
  return [
    t("fi.head", { nombre: s.nombre, prov: prov ?? "—" }),
    t("fi.coord", { c: coordTxt(s.lat, s.lon) }),
    t("fi.state", { l: lectura(s) }),
    s.datos ? t("fi.change", { b: fmtS(s.tend.pendienteDecada), lo: fmt(lo), hi: fmt(hi), p: fmtP(s.pHolm) }) : "",
    s.datos ? t("fi.thr", { u: fmt(s.umbral, 1), rango: rango(s), c: fmt(s.cobertura) }) : "",
    t("fi.src", { f: fuente }),
    s.demo ? t("fi.demo") : "",
    t("fi.limits"),
  ].filter(Boolean).join("\n");
}
