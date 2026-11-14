// Análisis directo en el navegador (sin Python): descarga la lluvia diaria de NASA POWER y calcula lo mismo que backend.py.
// Se usa cuando no hay servidor local (por ejemplo, en Cloudflare Pages o GitHub Pages). Necesita internet.
// 1) intenta llamar a NASA POWER directamente; 2) si el navegador lo bloquea (CORS), usa el proxy /api/power (functions/api/power.js).
const POWER = "https://power.larc.nasa.gov/api/temporal/daily/point";
export const FUENTES = {
  gpm: { parametro: "IMERG_PRECTOT", comunidad: "AG", min: 1998, label: "GPM IMERG" },
  merra2: { parametro: "PRECTOTCORR", comunidad: "AG", min: 1981, label: "MERRA-2" },
};
export const FIJOS = [50.8, 76.2, 101.6, 127];
let via = "directo"; // se recuerda cuál camino funcionó

export function pct(vals, p) {
  const v = vals.filter((x) => x !== null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const k = ((v.length - 1) * p) / 100, lo = Math.floor(k), hi = Math.ceil(k);
  return v[lo] + (v[hi] - v[lo]) * (k - lo);
}
const finito = (v) => { const f = Number(v); return Number.isFinite(f) && f >= 0 ? f : null; }; // -999 (sin dato) -> null
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function pedir(qs, ms = 70000) {
  const urls = via === "directo" ? [`${POWER}?${qs}`, `api/power?${qs}`] : [`api/power?${qs}`, `${POWER}?${qs}`];
  let ultimo = null;
  for (const url of urls) {
    const c = new AbortController(), id = setTimeout(() => c.abort(), ms);
    try {
      const r = await fetch(url, { signal: c.signal, headers: { Accept: "application/json" } });
      const txt = await r.text();
      let j = null; try { j = JSON.parse(txt); } catch { /* no era JSON (por ejemplo, una página de error) */ }
      if (!r.ok || !j) { const e = new Error(`NASA HTTP ${r.status}: ${txt.slice(0, 200)}`); e.http = r.status; ultimo = e; if (r.status === 422) throw e; continue; }
      via = url.startsWith("api/") ? "proxy" : "directo";
      return j;
    } catch (e) { if (e.http === 422) throw e; ultimo = e; } finally { clearTimeout(id); }
  }
  throw ultimo ?? new Error("sin respuesta");
}

async function bloque(fuente, lat, lon, y0, y1) {
  const cfg = FUENTES[fuente];
  const comunidades = fuente === "gpm" ? [cfg.comunidad, "RE", "SB"] : [cfg.comunidad];
  let error = null;
  for (const com of comunidades) {
    const qs = new URLSearchParams({ parameters: cfg.parametro, community: com, latitude: lat.toFixed(6), longitude: lon.toFixed(6), start: `${y0}0101`, end: `${y1}1231`, format: "JSON", "time-standard": "UTC" }).toString();
    let j = null;
    for (let intento = 0; intento < 3 && !j; intento++) {
      try { j = await pedir(qs); } catch (e) { error = e; if (e.http === 422) break; if (intento < 2) await dormir(2000 + intento * 2000); }
    }
    if (!j) continue; // 422: se prueba la siguiente comunidad (solo IMERG)
    const vals = j?.properties?.parameter?.[cfg.parametro];
    if (!vals || typeof vals !== "object") { error = new Error(`NASA no entregó ${cfg.parametro}`); continue; }
    const u = String(j?.parameters?.[cfg.parametro]?.units ?? "").trim().toLowerCase().replace(/\s/g, "");
    if (u && !["mm", "mm/day", "mm/d", "mmday-1", "mm/day-1"].includes(u)) throw new Error(`Unidad inesperada en NASA POWER: ${u}`);
    const out = {};
    for (const [k, v] of Object.entries(vals)) if (/^\d{8}$/.test(k)) out[`${k.slice(0, 4)}-${k.slice(4, 6)}-${k.slice(6, 8)}`] = finito(v);
    if (Object.keys(out).length) return out;
    error = new Error("Sin observaciones válidas en la respuesta de NASA");
  }
  throw error ?? new Error("No se pudo leer NASA POWER");
}

// Descarga la serie diaria en bloques de 4 años, igual que backend.py. progreso(i, total) opcional.
export async function descargar(fuente, lat, lon, ini, fin, progreso) {
  const datos = {}, bloques = [];
  for (let a = ini; a <= fin; a += 4) bloques.push([a, Math.min(a + 3, fin)]);
  for (let i = 0; i < bloques.length; i++) { progreso?.(i, bloques.length, bloques[i]); Object.assign(datos, await bloque(fuente, lat, lon, bloques[i][0], bloques[i][1])); }
  progreso?.(bloques.length, bloques.length);
  return datos;
}

const iso = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
// Calcula lo mismo que backend.aggregate (población de días lluviosos ≥ wetMin, umbral con el periodo de referencia).
export function calcular(datos, ini, fin, refIni, refFin, wetMin = 1) {
  const diasAnio = (y) => ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 366 : 365);
  const dm = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  const base = [];
  for (let y = refIni; y <= refFin; y++) for (let m = 1; m <= 12; m++) for (let d = 1; d <= dm(y, m); d++) { const v = datos[iso(y, m, d)]; if (v !== null && v !== undefined && v >= wetMin) base.push(v); }
  const umbral = pct(base, 95);
  const anios = [], extremos = [], totales = [], fijos = Object.fromEntries(FIJOS.map((t) => [String(t), []]));
  const mensual = Array.from({ length: 12 }, () => []);
  let validos = 0, total = 0;
  for (let y = ini; y <= fin; y++) {
    const vals = []; let completo = true, n = 0;
    for (let m = 1; m <= 12; m++) {
      const mm = []; let okm = true;
      for (let d = 1; d <= dm(y, m); d++) { const v = datos[iso(y, m, d)]; n++; if (v === null || v === undefined) { completo = false; okm = false; } else { vals.push(v); mm.push(v); } }
      if (okm) mensual[m - 1].push(mm.reduce((a, b) => a + b, 0));
    }
    validos += vals.length; total += n;
    if (!completo || umbral === null) continue;
    anios.push(y); totales.push(Math.round(vals.reduce((a, b) => a + b, 0) * 1000) / 1000);
    extremos.push(vals.filter((v) => v > umbral).length);
    FIJOS.forEach((t) => fijos[String(t)].push(vals.filter((v) => v >= t).length));
  }
  const clim = mensual.map((a) => (a.length ? Math.round((a.reduce((s, v) => s + v, 0) / a.length) * 1000) / 1000 : null));
  return { anios, extremos, totales, fijos, clim, umbral, cobertura: total ? Math.round((10000 * validos) / total) / 100 : null, diasValidos: validos };
}
