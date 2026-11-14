import { defineConfig } from "vite";
import { CSP } from "./security-headers.mjs";

// Inyecta la CSP como <meta> SOLO en el build (en `npm run dev` rompería el recarga en caliente).
// Sirve de respaldo en hostings que no permiten cabeceras (p. ej. GitHub Pages).
// Nota: frame-ancestors no funciona en <meta>; ese lo cubren las cabeceras reales.
function cspMeta() {
  return {
    name: "csp-meta",
    apply: "build",
    transformIndexHtml(html) {
      const metaCsp = CSP.split("; ").filter((d) => !d.startsWith("frame-ancestors")).join("; ");
      return html.replace(
        "<head>",
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${metaCsp}" />`
      );
    },
  };
}

export default defineConfig({
  // Rutas relativas: el mismo build funciona en la raíz de un dominio y en /nombre-repo/ (GitHub Pages).
  base: "./",
  plugins: [cspMeta()],
  build: { outDir: "dist", sourcemap: false, target: "es2020" },
});
