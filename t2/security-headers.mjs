// ÚNICA fuente de verdad de las cabeceras de seguridad.
// `npm run headers` regenera public/_headers y vercel.json a partir de este archivo.
// El build también inyecta la misma CSP como <meta> (respaldo para GitHub Pages).

export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  // Leaflet escribe estilos en línea desde JavaScript; por eso 'unsafe-inline' solo en estilos.
  "style-src 'self' 'unsafe-inline'",
  // Teselas del mapa base (OpenStreetMap). Si cambian de proveedor, añadan su dominio aquí.
  "img-src 'self' data: https://*.tile.openstreetmap.org",
  "font-src 'self'",
  // Solo se leen datos del mismo origen. Si algún día llaman a una API de IA, añadan su dominio.
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

// Cabeceras comunes. frame-ancestors/X-Frame-Options evitan que embeban su sitio en otro.
export const HEADERS = {
  "Content-Security-Policy": CSP,
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Cross-Origin-Opener-Policy": "same-origin",
};

// Caché: los archivos con hash (/assets/*) son inmutables; el HTML y los datos se revalidan siempre,
// para que un resultados.json nuevo se vea de inmediato.
export const CACHE = {
  "/assets/*": "public, max-age=31536000, immutable",
  "/data/*": "public, max-age=0, must-revalidate",
  "/index.html": "public, max-age=0, must-revalidate",
  "/": "public, max-age=0, must-revalidate",
};
