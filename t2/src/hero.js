// Visual de portada: curvas de nivel generadas + los siete puntos en su posición geográfica real.
import { $, el, ESTADO, nombreCorto } from "./util.js";
import { t } from "./i18n.js";

const NS = "http://www.w3.org/2000/svg";
const s = (tag, attrs = {}, texto) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (texto !== undefined) e.textContent = texto;
  return e;
};

function curvas(cx, cy) {
  const grupo = s("g", { class: "curvas", "aria-hidden": "true" });
  for (let i = 0; i < 17; i++) {
    const base = 26 + i * 17, fase = i * 0.55;
    const pts = [];
    for (let k = 0; k <= 96; k++) {
      const t = (k / 96) * Math.PI * 2;
      const r = base * (1 + 0.1 * Math.sin(3 * t + fase) + 0.06 * Math.sin(5 * t - fase * 1.7) + 0.035 * Math.sin(8 * t + fase));
      pts.push(`${(cx + r * 1.32 * Math.cos(t)).toFixed(1)},${(cy + r * 0.82 * Math.sin(t)).toFixed(1)}`);
    }
    grupo.append(s("polygon", { points: pts.join(" "), style: `--i:${i}`, class: "curva" }));
  }
  return grupo;
}

let yaDibujada = false; // las curvas se trazan solo la primera vez, no al cambiar de idioma

export function pintarHero(datos, onSelect) {
  const W = 560, H = 420;
  const lons = datos.sitios.map((x) => x.lon), lats = datos.sitios.map((x) => x.lat);
  const [x0, x1] = [Math.min(...lons) - 1.6, Math.max(...lons) + 1.6];
  const [y0, y1] = [Math.min(...lats) - 1.6, Math.max(...lats) + 1.6];
  const px = (lon) => 50 + ((lon - x0) / (x1 - x0)) * (W - 100);
  const py = (lat) => 40 + ((y1 - lat) / (y1 - y0)) * (H - 80);

  const g = s("svg", { viewBox: `0 0 ${W} ${H}`, class: yaDibujada ? "hero-svg quieta" : "hero-svg", role: "group", "aria-label": t("hero.svg_aria") });
  g.append(curvas(W / 2, H / 2));

  const ordenados = [...datos.sitios].sort((a, b) => b.lat - a.lat);
  g.append(s("polyline", { points: ordenados.map((p) => `${px(p.lon)},${py(p.lat)}`).join(" "), class: "ruta" }));

  for (const p of datos.sitios) {
    const est = ESTADO[p.estado];
    const gx = px(p.lon), gy = py(p.lat);
    const pin = s("g", { class: "hpin", tabindex: 0, role: "button", "aria-label": t("hero.pin_aria", { pais: nombreCorto(p), estado: est.texto }), transform: `translate(${gx} ${gy})` });
    const izq = p.lon > (x0 + x1) / 2 + 2; // etiqueta hacia el lado con más espacio
    pin.append(
      s("circle", { r: 15, class: "hpin-halo", fill: est.color }),
      s("circle", { r: 7, fill: est.color, stroke: "rgba(255,255,255,.9)", "stroke-width": 2 }),
      s("circle", { cx: -2.2, cy: -2.6, r: 2.2, fill: "rgba(255,255,255,.9)" }),
      s("text", { x: izq ? -14 : 14, y: 4, "text-anchor": izq ? "end" : "start", class: "hpin-t" }, p.id)
    );
    pin.addEventListener("click", () => onSelect(p.id));
    pin.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(p.id); } });
    g.append(pin);
  }
  $("hero-visual").replaceChildren(g);
  yaDibujada = true;

  // Conteo por estado
  const cont = (e) => datos.sitios.filter((x) => x.estado === e).length;
  $("hero-resumen").replaceChildren(
    ...Object.entries(ESTADO).map(([k, e]) => {
      const sw = el("span", { class: "muestra", "aria-hidden": "true" });
      sw.style.background = e.color;
      return el("li", {}, sw, el("strong", {}, String(cont(k))), el("span", {}, e.corto));
    })
  );
}
