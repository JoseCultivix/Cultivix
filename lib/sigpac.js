// Consultas al Servicio de Consultas SIGPAC del FEGA (sigpac-hubcloud.es), en el servidor.
import { wktAGeojson } from "@/lib/geo";

export const BASE = process.env.SIGPAC_BASE || "https://sigpac-hubcloud.es/servicioconsultassigpac/query";
export async function pedir(url) {
  const r = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
  if (!r.ok) throw new Error(`SIGPAC respondió ${r.status}`);
  const t = await r.text();
  try {
    return JSON.parse(t);
  } catch {
    throw new Error("Respuesta de SIGPAC no válida");
  }
}

export const n = (v) => (v === null || v === undefined || v === "" ? null : Number(v));

export function normalizar(json) {
  // GeoJSON (FeatureCollection / Feature) o JSON (array con wkt)
  const items = json?.type === "FeatureCollection" ? json.features : json?.type === "Feature" ? [json] : Array.isArray(json) ? json : json ? [json] : [];
  return items
    .map((it) => {
      const p = it.properties || it;
      let geom = it.geometry || (p.wkt ? wktAGeojson(p.wkt) : null);
      // Solo aceptamos coordenadas geográficas (lon/lat)
      const muestra = JSON.stringify(geom?.coordinates || []).match(/-?\d+\.?\d*/);
      if (muestra && Math.abs(Number(muestra[0])) > 180) geom = null;
      return {
        provincia: n(p.provincia),
        municipio: n(p.municipio),
        agregado: n(p.agregado) ?? 0,
        zona: n(p.zona) ?? 0,
        poligono: n(p.poligono),
        parcela: n(p.parcela),
        recinto: n(p.recinto),
        superficie: n(p.superficie ?? p.dn_surface),
        uso_sigpac: p.uso_sigpac || p.uso || null,
        pendiente_media: n(p.pendiente_media),
        coef_regadio: n(p.coef_regadio),
        geometria: geom,
      };
    })
    .filter((x) => x.recinto != null);
}


export async function porParcela(r) {
  const ruta = `${r.provincia}/${r.municipio}/${r.agregado}/${r.zona}/${r.poligono}/${r.parcela}`;
  try {
    const g = normalizar(await pedir(`${BASE}/recinfoparc/${ruta}.geojson`));
    if (g.length && g.some((x) => x.geometria)) return g;
  } catch {}
  return normalizar(await pedir(`${BASE}/recinfoparc/${ruta}.json`));
}
