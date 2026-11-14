// Comprobaciones de seguridad y calidad ANTES de publicar. Se ejecuta al final de `npm run build`.
// Si algo falla, el build falla y el hosting NO publica (así no sale una versión rota).
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CSP } from "../security-headers.mjs";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(raiz, "dist");
const errores = [], avisos = [];
const ok = (c, msg) => { if (!c) errores.push(msg); };

ok(existsSync(dist), "No existe dist/. Ejecute primero `vite build`.");
if (existsSync(dist)) {
  // 1) Archivos clave
  for (const f of ["index.html", "_headers", "data/resultados.json", "favicon.svg"])
    ok(existsSync(join(dist, f)), `Falta dist/${f}`);

  // 2) Cabeceras sincronizadas con security-headers.mjs
  if (existsSync(join(dist, "_headers"))) ok(readFileSync(join(dist, "_headers"), "utf8").includes(CSP), "dist/_headers no coincide con la CSP actual. Ejecute `npm run headers`.");
  const vj = JSON.parse(readFileSync(resolve(raiz, "vercel.json"), "utf8"));
  ok(JSON.stringify(vj).includes(CSP.replaceAll('"', '\\"')), "vercel.json no coincide con la CSP actual. Ejecute `npm run headers`.");

  // 3) El HTML no debe tener scripts en línea (la CSP los bloquearía) y debe llevar la meta CSP
  if (existsSync(join(dist, "index.html"))) {
    const html = readFileSync(join(dist, "index.html"), "utf8");
    ok(!/<script(?![^>]*\bsrc=)[^>]*>[^<]/i.test(html), "index.html contiene un <script> en línea: la CSP lo bloquearía.");
    ok(html.includes("Content-Security-Policy"), "index.html no tiene la meta CSP de respaldo.");
  }

  // 4) Búsqueda de secretos y rutas locales en TODO lo publicado
  const patrones = [
    [/sk-ant-[A-Za-z0-9_-]{10,}/, "clave de API de Anthropic"],
    [/sk-[A-Za-z0-9]{32,}/, "posible clave de API"],
    [/AKIA[0-9A-Z]{16}/, "clave de AWS"],
    [/ghp_[A-Za-z0-9]{30,}/, "token de GitHub"],
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "llave privada"],
    [/[A-Za-z]:\\Users\\|\/home\/[a-z]+\//, "ruta absoluta del computador"],
  ];
  const recorrer = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? recorrer(p) : [p]; });
  for (const f of recorrer(dist)) {
    if (!/\.(js|css|html|json|txt|svg|map)$|_headers$/.test(f)) continue;
    const t = readFileSync(f, "utf8");
    for (const [re, que] of patrones) if (re.test(t)) errores.push(`${f.replace(dist, "dist")}: contiene ${que}`);
  }

  // 5) Datos: forma mínima y aviso de sintéticos
  try {
    const d = JSON.parse(readFileSync(join(dist, "data/resultados.json"), "utf8"));
    ok(Array.isArray(d.sitios) && d.sitios.length > 0, "resultados.json no tiene sitios.");
    if (d.meta?.sintetico) avisos.push("resultados.json está marcado como SINTÉTICO. No lo presenten como resultado real.");
  } catch (e) { errores.push("resultados.json no es JSON válido: " + e.message); }
}

avisos.forEach((a) => console.warn("⚠  " + a));
if (errores.length) { console.error("\n✖ Verificación FALLÓ:\n - " + errores.join("\n - ")); process.exit(1); }
console.log("✔ Verificación superada (cabeceras, scripts, secretos, datos).");
