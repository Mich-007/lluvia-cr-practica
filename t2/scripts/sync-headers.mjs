// Genera public/_headers (Cloudflare Pages / Netlify) y vercel.json desde security-headers.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HEADERS, CACHE } from "../security-headers.mjs";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ---- _headers (formato Cloudflare Pages y Netlify) ----
let h = "# GENERADO por scripts/sync-headers.mjs. No editar a mano: edite security-headers.mjs\n/*\n";
for (const [k, v] of Object.entries(HEADERS)) h += `  ${k}: ${v}\n`;
for (const [ruta, valor] of Object.entries(CACHE)) h += `\n${ruta}\n  Cache-Control: ${valor}\n`;
mkdirSync(resolve(raiz, "public"), { recursive: true });
writeFileSync(resolve(raiz, "public/_headers"), h);

// ---- vercel.json ----
const vercel = {
  $schema: "https://openapi.vercel.sh/vercel.json",
  framework: "vite",
  buildCommand: "npm run build",
  outputDirectory: "dist",
  cleanUrls: true,
  headers: [
    { source: "/(.*)", headers: Object.entries(HEADERS).map(([key, value]) => ({ key, value })) },
    ...Object.entries(CACHE).map(([source, value]) => ({
      source,
      headers: [{ key: "Cache-Control", value }],
    })),
  ],
};
writeFileSync(resolve(raiz, "vercel.json"), JSON.stringify(vercel, null, 2) + "\n");

console.log("Cabeceras sincronizadas: public/_headers y vercel.json");
