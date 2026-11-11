// Lee data/resultados.json y lo muestra. Todo el texto se inserta con textContent
// (nunca innerHTML) para que un JSON raro no pueda inyectar HTML.
const ETIQUETA = { creciente: "▲ Creciente", decreciente: "▼ Decreciente", no_concluyente: "● No concluyente" };
const COLOR = { creciente: "#c0392b", decreciente: "#2471a3", no_concluyente: "#888888" };
const SVG_NS = "http://www.w3.org/2000/svg";

function el(tag, texto, atributos = {}) {
  const e = document.createElement(tag);
  if (texto !== undefined) e.textContent = texto;
  for (const [k, v] of Object.entries(atributos)) e.setAttribute(k, v);
  return e;
}

function svgEl(tag, atributos = {}, texto) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(atributos)) e.setAttribute(k, v);
  if (texto !== undefined) e.textContent = texto;
  return e;
}

function dibujar(sitio) {
  document.getElementById("titulo-detalle").textContent =
    `${sitio.id}: ${ETIQUETA[sitio.estado]} (${sitio.pendiente_dias_dec >= 0 ? "+" : ""}${sitio.pendiente_dias_dec} días/década)`;
  const svg = document.getElementById("grafico");
  svg.replaceChildren();
  const W = 600, H = 260, m = { l: 40, r: 10, t: 10, b: 30 };
  const valores = sitio.conteo.filter((v) => v !== null);
  const max = Math.max(...valores, 1);
  const n = sitio.anios.length;
  const ancho = (W - m.l - m.r) / n;

  svg.appendChild(svgEl("line", { x1: m.l, y1: H - m.b, x2: W - m.r, y2: H - m.b, stroke: "#333" }));
  svg.appendChild(svgEl("text", { x: 4, y: 14, "font-size": 11 }, `máx ${max}`));
  svg.appendChild(svgEl("text", { x: m.l, y: H - 8, "font-size": 11 }, String(sitio.anios[0])));
  svg.appendChild(svgEl("text", { x: W - m.r - 28, y: H - 8, "font-size": 11 }, String(sitio.anios[n - 1])));

  sitio.conteo.forEach((v, i) => {
    if (v === null) return; // año descartado por datos faltantes: no se dibuja
    const h = (v / max) * (H - m.t - m.b);
    svg.appendChild(svgEl("rect", {
      x: m.l + i * ancho + 1, y: H - m.b - h, width: ancho - 2, height: h, fill: COLOR[sitio.estado],
    }));
  });
}

function aviso(meta) {
  const caja = document.getElementById("aviso");
  if (meta.sintetico) {
    caja.textContent = "⚠ DATOS SINTÉTICOS DE PRÁCTICA. No son resultados NASA ni de Costa Rica real.";
    caja.hidden = false;
  }
}

function metodo(meta) {
  const ul = document.querySelector("#metodo ul");
  const lineas = [
    `Variable: ${meta.variable}.`,
    `Periodo: ${meta.periodo[0]}–${meta.periodo[1]} (umbral calculado con ${meta.periodo_base[0]}–${meta.periodo_base[1]}).`,
    `Día extremo: ${meta.definicion_umbral}.`,
    `Método: ${meta.metodo}. Nivel de significancia: ${meta.alfa}.`,
    "“No concluyente” no significa “no hay cambio”: significa que los datos no bastan para afirmarlo.",
  ];
  lineas.forEach((t) => ul.appendChild(el("li", t)));
}

async function iniciar() {
  let datos;
  try {
    const r = await fetch("data/resultados.json", { cache: "no-cache" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    datos = await r.json();
    if (!datos.meta || !Array.isArray(datos.sitios)) throw new Error("falta 'meta' o 'sitios'");
  } catch (e) {
    document.querySelector("main").prepend(el("p", `No se pudieron cargar los resultados: ${e.message}`));
    return;
  }
  aviso(datos.meta);
  metodo(datos.meta);
  const cuerpo = document.querySelector("#tabla tbody");
  datos.sitios.forEach((s, i) => {
    const fila = el("tr");
    fila.appendChild(el("td", s.id));
    fila.appendChild(el("td", ETIQUETA[s.estado] || s.estado, { class: "estado" }));
    fila.appendChild(el("td", `${s.pendiente_dias_dec >= 0 ? "+" : ""}${s.pendiente_dias_dec}`));
    fila.appendChild(el("td", String(s.p_holm)));
    fila.addEventListener("click", () => {
      cuerpo.querySelectorAll("tr").forEach((f) => f.classList.remove("activa"));
      fila.classList.add("activa");
      dibujar(s);
    });
    cuerpo.appendChild(fila);
    if (i === 0) { fila.classList.add("activa"); dibujar(s); }
  });
}

iniciar();
