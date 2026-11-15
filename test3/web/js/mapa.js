/* Phyllobytes · módulo «mapa» (script clásico: funciona al abrir index.html con doble clic, sin servidor). */
(function () {
"use strict";
// Mapa de Costa Rica propio (SVG + imagen de calor). Funciona sin internet; el estilo «OpenStreetMap» añade las teselas
// de OpenStreetMap (necesita conexión). Provincias con límites ilustrativos; clic en cualquier punto de Costa Rica para elegir una coordenada.
const { ANCHO, ALTO, CR_CONTORNO, NICARAGUA, PANAMA, PROVINCIAS, proyectar, invertir, rutaSVG, rutaProvincia, provinciaDe, dentroDeCR, CAJA } = PHY.geo;
const { el } = PHY.util;

const NS = "http://www.w3.org/2000/svg";
const s = (tag, attrs = {}, texto) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (texto !== undefined) e.textContent = texto;
  return e;
};
let uid = 0;

// opciones: mini (portada, sin zoom ni rejilla), alClicPunto(id), alClicMapa({lat,lon,prov}), alMover({lat,lon,prov}|null), etiquetas(fn id->{color,simbolo,texto})
function crearMapa(host, opciones = {}) {
  const mini = !!opciones.mini;
  const id = `m${++uid}`;
  const caja = el("div", { class: "mapa-caja" + (mini ? " mini" : "") });
  const svg = s("svg", { viewBox: `0 0 ${ANCHO} ${ALTO}`, class: "mapa-svg", role: "group", "aria-label": opciones.aria ?? "Mapa de Costa Rica" });
  const defs = s("defs");
  const clip = s("clipPath", { id: `${id}-cr` });
  clip.append(s("path", { d: rutaSVG(CR_CONTORNO) }));
  defs.append(clip);
  svg.append(defs);

  const gVec = s("g", { class: "vecinos", "aria-hidden": "true" });
  gVec.append(s("path", { d: rutaSVG(NICARAGUA) }), s("path", { d: rutaSVG(PANAMA) }));
  const tierra = s("path", { d: rutaSVG(CR_CONTORNO), class: "cr-tierra" });
  const calor = s("image", { class: "calor", "clip-path": `url(#${id}-cr)`, width: ANCHO, height: ALTO, x: 0, y: 0, preserveAspectRatio: "none", visibility: "hidden" });
  calor.setAttribute("aria-hidden", "true");
  const gProv = s("g", { class: "provincias", "clip-path": `url(#${id}-cr)` });
  for (const p of PROVINCIAS) {
    const path = s("path", { d: rutaProvincia(p), class: "prov", "data-id": p.id, "fill-rule": "nonzero" });
    path.append(s("title", {}, p.nombre));
    gProv.append(path);
  }
  const borde = s("path", { d: rutaSVG(CR_CONTORNO), class: "cr-borde" });
  const gEti = s("g", { class: "prov-etiquetas", "aria-hidden": "true" });
  if (!mini) for (const p of PROVINCIAS) {
    const [lo, la] = p.etiqueta; const [x, y] = proyectar(lo, la);
    gEti.append(s("text", { x, y, class: "prov-nombre", "data-x": x, "data-y": y }, p.nombre));
  }
  const gRej = s("g", { class: "rejilla-geo", "aria-hidden": "true" });
  if (!mini) {
    for (let lo = -86; lo <= -82.5; lo += 1) { const [x] = proyectar(lo, 0); gRej.append(s("line", { x1: x, x2: x, y1: 0, y2: ALTO }), s("text", { x: x + 4, y: ALTO - 6 }, `${Math.abs(lo)}°O`)); }
    for (let la = 8; la <= 11; la += 1) { const [, y] = proyectar(0, la); gRej.append(s("line", { x1: 0, x2: ANCHO, y1: y, y2: y }), s("text", { x: 6, y: y - 5 }, `${la}°N`)); }
  }
  const gPuntos = s("g", { class: "puntos" });
  const cursor = s("g", { class: "cursor", visibility: "hidden", "aria-hidden": "true" });
  cursor.append(s("circle", { r: 9 }), s("line", { x1: -16, x2: -4 }), s("line", { x1: 4, x2: 16 }), s("line", { y1: -16, y2: -4 }), s("line", { y1: 4, y2: 16 }));
  const gTeselas = s("g", { class: "teselas", "aria-hidden": "true" });
  svg.append(gTeselas, gVec, tierra, calor, gProv, borde, gEti, gRej, gPuntos, cursor);
  caja.append(svg);

  // ---- zoom / desplazamiento (viewBox) ----
  let vb = { x: 0, y: 0, w: ANCHO, h: ALTO };
  const aplicarVB = () => {
    vb.w = Math.max(ANCHO / 8, Math.min(ANCHO, vb.w)); vb.h = vb.w * (ALTO / ANCHO);
    vb.x = Math.max(0, Math.min(ANCHO - vb.w, vb.x)); vb.y = Math.max(0, Math.min(ALTO - vb.h, vb.y));
    svg.setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
    const k = vb.w / ANCHO;
    caja.style.setProperty("--k", k.toFixed(4));
    caja.classList.toggle("zoomed", k < 0.6);
    gPuntos.querySelectorAll(".pin").forEach((g) => g.setAttribute("transform", `translate(${g.dataset.x} ${g.dataset.y}) scale(${(k * (mini ? 1.25 : 1)).toFixed(3)})`));
    gEti.querySelectorAll("text").forEach((t) => { t.setAttribute("transform", `translate(${t.dataset.x} ${t.dataset.y}) scale(${k.toFixed(3)}) translate(${-t.dataset.x} ${-t.dataset.y})`); });
    zoomTxt && (zoomTxt.textContent = `${Math.round((ANCHO / vb.w) * 100)} %`);
    if (baseOSM) pintarTeselas();
  };
  const zoom = (f, cx = vb.x + vb.w / 2, cy = vb.y + vb.h / 2) => {
    const nw = Math.max(ANCHO / 8, Math.min(ANCHO, vb.w / f)), r = nw / vb.w;
    vb = { x: cx - (cx - vb.x) * r, y: cy - (cy - vb.y) * r, w: nw, h: nw * (ALTO / ANCHO) };
    aplicarVB();
  };
  let zoomTxt = null;
  if (!mini) {
    zoomTxt = el("span", { class: "zoom-txt" }, "100 %");
    const btn = (txt, aria, fn) => el("button", { type: "button", class: "mapa-btn", "aria-label": aria, onclick: fn }, txt);
    const ctrl = el("div", { class: "mapa-ctrl", role: "group", "aria-label": opciones.zoomAria ?? "Zoom" }, btn("+", "+", () => zoom(1.5)), btn("−", "−", () => zoom(1 / 1.5)), btn("⟲", "reset", () => { vb = { x: 0, y: 0, w: ANCHO, h: ALTO }; aplicarVB(); }), zoomTxt);
    caja.append(ctrl);
  }
  caja.append(el("img", { class: "marca-agua marca-agua-mapa" + (mini ? " mini" : ""), src: "assets/marca-agua.png", alt: "", "aria-hidden": "true", draggable: "false" }));
  const atribucion = el("a", { class: "mapa-atrib", href: "https://www.openstreetmap.org/copyright", target: "_blank", rel: "noopener noreferrer" }, "© OpenStreetMap contributors");
  atribucion.hidden = true;
  if (!mini) caja.append(atribucion);
  const lectura = el("div", { class: "mapa-lectura", "aria-live": "off" });
  if (!mini) caja.append(lectura);

  const aCoord = (ev) => {
    const r = svg.getBoundingClientRect();
    const x = vb.x + ((ev.clientX - r.left) / r.width) * vb.w, y = vb.y + ((ev.clientY - r.top) / r.height) * vb.h;
    const [lon, lat] = invertir(x, y);
    return { x, y, lat, lon };
  };
  // arrastrar para mover (solo con zoom) y clic para elegir
  let arrastre = null, movido = false;
  if (!mini) {
    svg.addEventListener("pointerdown", (ev) => { if (ev.button !== 0) return; arrastre = { cx: ev.clientX, cy: ev.clientY, vx: vb.x, vy: vb.y }; movido = false; });
    svg.addEventListener("pointermove", (ev) => {
      if (arrastre && vb.w < ANCHO - 1) {
        const r = svg.getBoundingClientRect(), dx = ev.clientX - arrastre.cx, dy = ev.clientY - arrastre.cy;
        if (Math.hypot(dx, dy) > 4) { movido = true; vb.x = arrastre.vx - (dx / r.width) * vb.w; vb.y = arrastre.vy - (dy / r.height) * vb.h; aplicarVB(); }
      }
      const c = aCoord(ev), pr = dentroDeCR(c.lat, c.lon) ? provinciaDe(c.lat, c.lon) : null;
      if (pr) { cursor.setAttribute("visibility", "visible"); cursor.setAttribute("transform", `translate(${c.x} ${c.y}) scale(${(vb.w / ANCHO).toFixed(3)})`); } else cursor.setAttribute("visibility", "hidden");
      lectura.textContent = pr ? `${c.lat.toFixed(3)}° N, ${Math.abs(c.lon).toFixed(3)}° ${document.documentElement.lang === "en" ? "W" : "O"} · ${pr.nombre}` : "";
      opciones.alMover?.(pr ? { lat: c.lat, lon: c.lon, prov: pr } : null);
    });
    svg.addEventListener("pointerleave", () => { arrastre = null; cursor.setAttribute("visibility", "hidden"); lectura.textContent = ""; });
    svg.addEventListener("pointerup", (ev) => {
      const fue = arrastre; arrastre = null;
      if (!fue || movido || ev.target.closest?.(".pin")) return;
      const c = aCoord(ev);
      opciones.alClicMapa?.({ lat: c.lat, lon: c.lon, prov: dentroDeCR(c.lat, c.lon) ? provinciaDe(c.lat, c.lon) : null });
    });
    svg.addEventListener("wheel", (ev) => { if (!(ev.ctrlKey || ev.metaKey)) return; ev.preventDefault(); const c = aCoord(ev); zoom(ev.deltaY < 0 ? 1.25 : 0.8, c.x, c.y); }, { passive: false });
  }


  // ---- estilo OpenStreetMap: teselas «slippy map» (Web Mercator) estiradas sobre la proyección del atlas ----
  // En una tesela (≈1° de alto) la diferencia entre Mercator y la proyección del atlas es de menos de 1 píxel.
  let baseOSM = false;
  const teselasPuestas = new Map();
  const lonDeX = (x, z) => (x / 2 ** z) * 360 - 180;
  const latDeY = (y, z) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;
  const xDeLon = (lon, z) => ((lon + 180) / 360) * 2 ** z;
  const yDeLat = (lat, z) => ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** z;
  let teselaTimer = 0;
  function pintarTeselas() {
    cancelAnimationFrame(teselaTimer);
    teselaTimer = requestAnimationFrame(() => {
      const r = svg.getBoundingClientRect();
      if (!r.width) return;
      const [lonA, latA] = invertir(vb.x, vb.y), [lonB, latB] = invertir(vb.x + vb.w, vb.y + vb.h);
      const gradosPorPx = Math.abs(lonB - lonA) / r.width;
      let z = Math.max(6, Math.min(15, Math.round(Math.log2(360 / (256 * gradosPorPx)) + 0.7)));
      let x0, x1, y0, y1;
      for (;;) {
        x0 = Math.floor(xDeLon(lonA, z)); x1 = Math.floor(xDeLon(lonB, z)); y0 = Math.floor(yDeLat(latA, z)); y1 = Math.floor(yDeLat(latB, z));
        if ((x1 - x0 + 1) * (y1 - y0 + 1) <= 70 || z <= 6) break;
        z--;
      }
      const vivas = new Set();
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
        const k = `${z}/${x}/${y}`; vivas.add(k);
        if (teselasPuestas.has(k)) continue;
        const [xa, ya] = proyectar(lonDeX(x, z), latDeY(y, z)), [xb, yb] = proyectar(lonDeX(x + 1, z), latDeY(y + 1, z));
        const im = s("image", { x: xa.toFixed(2), y: ya.toFixed(2), width: (xb - xa + 0.6).toFixed(2), height: (yb - ya + 0.6).toFixed(2), preserveAspectRatio: "none", href: `https://tile.openstreetmap.org/${k}.png` });
        im.addEventListener("error", () => { im.remove(); teselasPuestas.delete(k); });
        gTeselas.append(im); teselasPuestas.set(k, im);
      }
      // se conservan las teselas de otros niveles hasta que carguen las nuevas; después se limpian las que ya no se ven
      for (const [k, im] of teselasPuestas) if (!vivas.has(k) && (k.split("/")[0] === String(z) || teselasPuestas.size > 160)) { im.remove(); teselasPuestas.delete(k); }
    });
  }
  function verBase(osm) {
    baseOSM = !!osm;
    caja.classList.toggle("osm", baseOSM);
    atribucion.hidden = !baseOSM || mini;
    if (baseOSM) pintarTeselas(); else { gTeselas.replaceChildren(); teselasPuestas.clear(); }
  }

  // ---- API ----
  // sitios: [{id, lat, lon, datos, estado, ...}], sel: id seleccionado. descr(sitio) -> {color, simbolo, aria}
  function puntos(sitios, sel, descr) {
    gPuntos.replaceChildren();
    sitios.forEach((st, i) => {
      const d = descr(st);
      const [x, y] = proyectar(st.lon, st.lat);
      const g = s("g", { class: "pin" + (st.id === sel ? " sel" : "") + (st.datos ? "" : " pendiente"), "data-x": x, "data-y": y, "data-id": st.id, tabindex: 0, role: "button", "aria-label": d.aria, transform: `translate(${x} ${y})` });
      g.style.setProperty("--c", d.color);
      g.append(s("circle", { class: "pin-halo", r: 17 }), s("circle", { class: "pin-aro", r: 11 }), s("circle", { class: "pin-nucleo", r: 7.2 }));
      g.append(s("text", { class: "pin-simbolo", y: 3.6 }, st.datos ? d.simbolo : "?"));
      if (!mini) g.append(s("text", { class: "pin-nombre", y: 28 }, st.nombre.length > 18 ? st.nombre.slice(0, 17) + "…" : st.nombre));
      else g.append(s("text", { class: "pin-nombre mini-t", y: 25 }, st.id));
      g.append(s("title", {}, d.aria));
      const abrir = (ev) => { ev.stopPropagation?.(); opciones.alClicPunto?.(st.id); };
      g.addEventListener("click", abrir);
      g.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); abrir(ev); } });
      gPuntos.append(g);
    });
    aplicarVB();
    // el seleccionado va encima
    const g = gPuntos.querySelector(".pin.sel"); if (g) gPuntos.append(g);
  }
  function verCalor(res) {
    if (!res) { calor.setAttribute("visibility", "hidden"); caja.classList.remove("con-calor"); return; }
    calor.setAttribute("href", res.url); calor.setAttribute("visibility", "visible"); caja.classList.add("con-calor");
  }
  function marcarProvincia(idProv) { gProv.querySelectorAll(".prov").forEach((p) => p.classList.toggle("act", p.dataset.id === idProv)); }
  function centrarEn(lat, lon) {
    if (vb.w >= ANCHO - 1) return;
    const [x, y] = proyectar(lon, lat); vb.x = x - vb.w / 2; vb.y = y - vb.h / 2; aplicarVB();
  }
  host.replaceChildren(caja);
  aplicarVB();
  return { puntos, verCalor, verBase, marcarProvincia, centrarEn, zoom, caja, svg };
}
PHY.mapa = { crearMapa };
})();
