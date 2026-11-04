"use client";
import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const ZOOM_RECINTOS = 15;

/**
 * Mapa para elegir parcelas: ortofoto PNOA + linderos de los recintos SIGPAC (WMS del FEGA).
 * Al tocar un punto llama a onPunto(lat, lon); los recintos devueltos se dibujan y se marcan/desmarcan al tocarlos.
 */
export default function MapaSigpac({ existentes = [], resultado = [], sel = [], onPunto, onToggle, centrarEn, gps }) {
  const caja = useRef(null);
  const mapa = useRef(null);
  const capaRes = useRef(null);
  const capaYa = useRef(null);
  const yo = useRef(null);
  const [zoom, setZoom] = useState(6);
  const cb = useRef({ onPunto, onToggle });
  cb.current = { onPunto, onToggle };

  useEffect(() => {
    if (mapa.current) return;
    const m = L.map(caja.current, { zoomControl: false, attributionControl: true }).setView([39.8, -3.7], 6);
    L.tileLayer(
      "https://www.ign.es/wmts/pnoa-ma?request=GetTile&service=WMTS&VERSION=1.0.0&Layer=OI.OrthoimageCoverage&Style=default&Format=image/jpeg&TileMatrixSet=GoogleMapsCompatible&TileMatrix={z}&TileRow={y}&TileCol={x}",
      { maxZoom: 20, maxNativeZoom: 19, attribution: "PNOA © IGN" }
    ).addTo(m);
    L.tileLayer
      .wms("https://sigpac-hubcloud.es/wms", {
        layers: "AU.Sigpac:recinto",
        format: "image/png",
        transparent: true,
        minZoom: ZOOM_RECINTOS - 1,
        maxZoom: 20,
        attribution: "SIGPAC © FEGA",
      })
      .addTo(m);
    L.control.zoom({ position: "bottomright" }).addTo(m);
    capaYa.current = L.featureGroup().addTo(m);
    capaRes.current = L.featureGroup().addTo(m);
    m.on("click", (e) => cb.current.onPunto?.(e.latlng.lat, e.latlng.lng));
    m.on("zoomend", () => setZoom(m.getZoom()));
    mapa.current = m;
    // En una hoja que se abre con animación, Leaflet necesita recalcular su tamaño
    setTimeout(() => m.invalidateSize(), 300);
    return () => {
      m.remove();
      mapa.current = null;
    };
  }, []);

  // Recintos que ya tienes: contorno azul, para no importarlos dos veces
  useEffect(() => {
    const m = mapa.current;
    if (!m) return;
    capaYa.current.clearLayers();
    for (const r of existentes) {
      if (!r.geometria) continue;
      L.geoJSON(r.geometria, { interactive: false, style: { color: "#60a5fa", weight: 2, dashArray: "4 4", fillColor: "#60a5fa", fillOpacity: 0.15 } }).addTo(capaYa.current);
    }
    if (!resultado.length && !centrarEn) {
      const b = capaYa.current.getBounds();
      if (b.isValid()) m.fitBounds(b, { padding: [20, 20], maxZoom: 16 });
      else if (gps) m.setView([gps.lat, gps.lon], 16);
    }
  }, [existentes]); // eslint-disable-line

  // Recintos de la parcela tocada
  useEffect(() => {
    const m = mapa.current;
    if (!m) return;
    capaRes.current.clearLayers();
    for (const r of resultado) {
      if (!r.geometria) continue;
      const elegido = sel.includes(r.recinto);
      const g = L.geoJSON(r.geometria, {
        style: { color: elegido ? "#facc15" : "#ffffff", weight: elegido ? 3 : 2, fillColor: elegido ? "#4d7c0f" : "#ffffff", fillOpacity: elegido ? 0.45 : 0.1 },
      });
      g.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        cb.current.onToggle?.(r.recinto);
      });
      g.bindTooltip(`Rec. ${r.recinto}`, { permanent: true, direction: "center", className: "!bg-white/85 !px-1 !py-0 !text-xs !font-bold" });
      g.addTo(capaRes.current);
    }
  }, [resultado, sel]);

  // Encuadrar la parcela recién tocada (solo cuando cambia la parcela, no al marcar recintos)
  const clave = resultado.map((r) => `${r.poligono}-${r.parcela}-${r.recinto}`).join(",");
  useEffect(() => {
    const m = mapa.current;
    if (!m || !resultado.length) return;
    const b = capaRes.current.getBounds();
    if (b.isValid()) m.fitBounds(b, { padding: [30, 30], maxZoom: 18 });
  }, [clave]); // eslint-disable-line

  useEffect(() => {
    const m = mapa.current;
    if (m && centrarEn) m.setView([centrarEn.lat, centrarEn.lon], centrarEn.zoom || 16);
  }, [centrarEn]);

  useEffect(() => {
    const m = mapa.current;
    if (!m || !gps) return;
    if (!yo.current) yo.current = L.circleMarker([gps.lat, gps.lon], { radius: 8, color: "#fff", weight: 3, fillColor: "#2563eb", fillOpacity: 1, interactive: false }).addTo(m);
    else yo.current.setLatLng([gps.lat, gps.lon]);
  }, [gps]);

  return (
    <div className="relative h-full w-full">
      <div ref={caja} className="h-full w-full" />
      {zoom < ZOOM_RECINTOS && (
        <div className="pointer-events-none absolute inset-x-2 top-2 z-[500] rounded-xl bg-white/90 px-3 py-2 text-center text-sm font-bold text-olivo-900 shadow">
          Acércate a tu finca para ver los recintos SIGPAC
        </div>
      )}
    </div>
  );
}
