// Frases en lenguaje sencillo generadas SOLO a partir de cifras ya calculadas.
// No atribuyen causas ni predicen: describen lo observado en la serie.
import { t } from "./i18n.js";
import { fmt, fmtP, rango, nombreCorto, nombreLargo } from "./util.js";

// Metadatos listos para mostrar (traduce los textos de la muestra sintética).
export function metaVista(meta, sitios) {
  const sint = !!meta.sintetico;
  const limpio = (v) => (v && v !== "n/a" ? v : null);
  return {
    producto: sint ? t("src.synth.product") : limpio(meta.producto) ?? "—",
    version: limpio(meta.version) ?? t("src.tbd"),
    periodo: sint && sitios?.[0] ? t("src.synth.period", { rango: rango(sitios[0]) }) : meta.periodo ?? "—",
    resolucion: meta.resolucion ?? "0.1° (~10 km)",
    unidad: sint ? t("src.synth.unit") : meta.unidad ?? "mm/día",
    fecha: meta.fecha_descarga ?? "—",
    nota: sint ? t("src.synth.note") : meta.nota ?? "",
  };
}

export function lectura(s) {
  const [lo, hi] = s.ic95_dias_decada ?? [];
  const b = s.pendiente_dias_decada;
  const ic = typeof lo === "number" ? t("lect.ic", { lo: fmt(lo), hi: fmt(hi) }) : "";
  const p = t("lect.p", { p: fmtP(s.p_holm) });
  const clave = s.estado === "creciente" ? "lect.up" : s.estado === "decreciente" ? "lect.dn" : "lect.nc";
  const bTxt = s.estado === "no_concluyente" ? fmt(b) : fmt(Math.abs(b));
  return t(clave, { pais: nombreCorto(s), rango: rango(s), b: bTxt, ic, p });
}

export function resumenRegional(sitios) {
  const por = (e) => sitios.filter((s) => s.estado === e);
  const lista = (a) => a.map(nombreCorto).join(", ");
  const linea = (e, k) => { const a = por(e); return a.length ? t(`res.${k}`, { n: a.length, l: lista(a) }) : t(`res.none.${k}`); };
  return [t("res.head", { n: sitios.length }), linea("creciente", "up"), linea("decreciente", "dn"), linea("no_concluyente", "nc"), t("res.foot")].join("\n");
}

export function fichaTexto(s, meta, sitios) {
  const [lo, hi] = s.ic95_dias_decada ?? [];
  const m = metaVista(meta, sitios);
  return [
    t("fi.head", { nombre: nombreLargo(s), pais: nombreCorto(s) }),
    t("fi.state", { l: lectura(s) }),
    t("fi.change", { b: fmt(s.pendiente_dias_decada), lo: fmt(lo), hi: fmt(hi), p: fmtP(s.p_holm) }),
    t("fi.thr", { u: fmt(s.umbral_mm, 1), rango: rango(s), c: fmt(s.cobertura_pct) }),
    t("fi.src", { prod: m.producto, ver: m.version, res: m.resolucion, desc: m.fecha }),
    meta.sintetico ? t("fi.synth") : "",
    t("fi.limits"),
  ].filter(Boolean).join("\n");
}
