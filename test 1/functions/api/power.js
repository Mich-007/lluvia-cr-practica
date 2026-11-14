// Cloudflare Pages Function: /api/power  (respaldo si el navegador no puede llamar a NASA POWER directamente)
// Solo reenvía consultas de lluvia diaria para Costa Rica; no es un proxy abierto.
const PERMITIDOS = new Set(["IMERG_PRECTOT", "PRECTOTCORR"]);
export async function onRequestGet({ request }) {
  const q = new URL(request.url).searchParams;
  const lat = Number(q.get("latitude")), lon = Number(q.get("longitude"));
  const dentro = lat >= 7.9 && lat <= 11.5 && lon >= -86.3 && lon <= -82.3;
  if (!PERMITIDOS.has(q.get("parameters")) || !dentro || !/^\d{8}$/.test(q.get("start") ?? "") || !/^\d{8}$/.test(q.get("end") ?? "")) {
    return new Response(JSON.stringify({ error: "consulta no permitida" }), { status: 400, headers: { "content-type": "application/json" } });
  }
  const destino = new URL("https://power.larc.nasa.gov/api/temporal/daily/point");
  for (const k of ["parameters", "community", "latitude", "longitude", "start", "end", "format", "time-standard"]) if (q.has(k)) destino.searchParams.set(k, q.get(k));
  const r = await fetch(destino.toString(), { headers: { "User-Agent": "Phyllobytes/1.0 (educativo)", Accept: "application/json" }, cf: { cacheTtl: 86400, cacheEverything: true } });
  return new Response(r.body, { status: r.status, headers: { "content-type": "application/json", "cache-control": "public, max-age=86400", "access-control-allow-origin": "*" } });
}
