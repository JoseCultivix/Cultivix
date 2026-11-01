// Utilidades geográficas sin dependencias (funcionan offline).
// Las geometrías son GeoJSON en lon/lat.

function puntoEnAnillo(lon, lat, anillo) {
  let dentro = false;
  for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
    const [xi, yi] = anillo[i];
    const [xj, yj] = anillo[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}

function puntoEnPoligono(lon, lat, coords) {
  if (!coords?.length || !puntoEnAnillo(lon, lat, coords[0])) return false;
  for (let k = 1; k < coords.length; k++) if (puntoEnAnillo(lon, lat, coords[k])) return false; // huecos
  return true;
}

export function puntoEnGeometria(lon, lat, geom) {
  if (!geom) return false;
  if (geom.type === "Feature") return puntoEnGeometria(lon, lat, geom.geometry);
  if (geom.type === "Polygon") return puntoEnPoligono(lon, lat, geom.coordinates);
  if (geom.type === "MultiPolygon") return geom.coordinates.some((p) => puntoEnPoligono(lon, lat, p));
  return false;
}

function todosLosPuntos(geom) {
  if (!geom) return [];
  if (geom.type === "Feature") return todosLosPuntos(geom.geometry);
  if (geom.type === "Polygon") return geom.coordinates.flat();
  if (geom.type === "MultiPolygon") return geom.coordinates.flat(2);
  return [];
}

export function bbox(geom) {
  const pts = todosLosPuntos(geom);
  if (!pts.length) return null;
  let [minLon, minLat, maxLon, maxLat] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of pts) {
    if (x < minLon) minLon = x;
    if (y < minLat) minLat = y;
    if (x > maxLon) maxLon = x;
    if (y > maxLat) maxLat = y;
  }
  return { minLon, minLat, maxLon, maxLat };
}

export function centro(geom) {
  const b = bbox(geom);
  return b ? { lat: (b.minLat + b.maxLat) / 2, lon: (b.minLon + b.maxLon) / 2 } : null;
}

/** Distancia en metros entre dos puntos. */
export function distancia(lat1, lon1, lat2, lon2) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Detecta el recinto en el que está el usuario.
 * 1º dentro del polígono; 2º el más cercano por centro (< 300 m). El GPS ayuda, no manda (FLUJO-011).
 */
export function detectarRecinto(recintos, lat, lon) {
  if (lat == null || lon == null || !recintos?.length) return null;
  const dentro = recintos.find(
    (r) =>
      r.geometria &&
      (r.bbox_min_lon == null ||
        (lon >= r.bbox_min_lon && lon <= r.bbox_max_lon && lat >= r.bbox_min_lat && lat <= r.bbox_max_lat)) &&
      puntoEnGeometria(lon, lat, r.geometria)
  );
  if (dentro) return { recinto: dentro, seguro: true, distancia: 0 };
  let mejor = null;
  for (const r of recintos) {
    const c = r.centro_lat != null ? { lat: r.centro_lat, lon: r.centro_lon } : null;
    if (!c) continue;
    const d = distancia(lat, lon, c.lat, c.lon);
    if (!mejor || d < mejor.distancia) mejor = { recinto: r, seguro: false, distancia: d };
  }
  return mejor && mejor.distancia < 300 ? mejor : null;
}

/** Recintos atravesados por un recorrido [[lon,lat,ts],...] */
export function recintosDelRecorrido(recintos, recorrido) {
  const ids = new Set();
  for (const [lon, lat] of recorrido || []) {
    const d = detectarRecinto(recintos, lat, lon);
    if (d?.seguro) ids.add(d.recinto.id);
  }
  return [...ids];
}

// ---------------------------------------------------------------------
// WKT → GeoJSON (SIGPAC devuelve WKT en el formato JSON)
// ---------------------------------------------------------------------
export function wktAGeojson(wkt) {
  if (!wkt) return null;
  const s = wkt.trim().toUpperCase();
  const anillos = (txt) =>
    txt
      .split(/\)\s*,\s*\(/)
      .map((a) => a.replace(/[()]/g, "").split(",").map((p) => p.trim().split(/\s+/).map(Number)));
  if (s.startsWith("MULTIPOLYGON")) {
    const cuerpo = wkt.slice(wkt.indexOf("(") + 1, wkt.lastIndexOf(")"));
    const polis = cuerpo.split(/\)\)\s*,\s*\(\(/).map((p) => anillos(p));
    return { type: "MultiPolygon", coordinates: polis };
  }
  if (s.startsWith("POLYGON")) {
    const cuerpo = wkt.slice(wkt.indexOf("(") + 1, wkt.lastIndexOf(")"));
    return { type: "Polygon", coordinates: anillos(cuerpo) };
  }
  return null;
}

/** Pide la posición actual (promesa). */
export function posicionActual(opciones = {}) {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, precision: Math.round(p.coords.accuracy) }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000, ...opciones }
    );
  });
}
