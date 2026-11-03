"use client";
import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const COLORES = { Olivar: "#6f8c41", Pistacho: "#b5a33a", Almendro: "#c27c3e", "Espárrago verde": "#3f9a6b", Viñedo: "#8e3b5a", Cereal: "#d4b44a" };

/** Mapa con ortofoto PNOA (IGN) y tus recintos coloreados por cultivo. */
export default function MapaLeaflet({ recintos, gps, fotos = [], onSeleccionar }) {
  const caja = useRef(null);
  const mapa = useRef(null);
  const capa = useRef(null);
  const yo = useRef(null);

  useEffect(() => {
    if (mapa.current) return;
    const m = L.map(caja.current, { zoomControl: false, attributionControl: true }).setView([37.8, -3.8], 7);
    const orto = L.tileLayer(
      "https://www.ign.es/wmts/pnoa-ma?request=GetTile&service=WMTS&VERSION=1.0.0&Layer=OI.OrthoimageCoverage&Style=default&Format=image/jpeg&TileMatrixSet=GoogleMapsCompatible&TileMatrix={z}&TileRow={y}&TileCol={x}",
      { maxZoom: 20, maxNativeZoom: 19, attribution: "PNOA © IGN" }
    );
    const calles = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" });
    orto.addTo(m);
    L.control.layers({ Satélite: orto, Mapa: calles }, {}, { position: "topright" }).addTo(m);
    L.control.zoom({ position: "bottomright" }).addTo(m);
    capa.current = L.featureGroup().addTo(m);
    mapa.current = m;
    return () => {
      m.remove();
      mapa.current = null;
    };
  }, []);

  useEffect(() => {
    const m = mapa.current;
    if (!m) return;
    capa.current.clearLayers();
    for (const r of recintos) {
      if (!r.geometria) {
        if (r.centro_lat) L.circleMarker([r.centro_lat, r.centro_lon], { radius: 8, color: "#fff", fillColor: COLORES[r.cultivo] || "#888", fillOpacity: 1 }).addTo(capa.current);
        continue;
      }
      const g = L.geoJSON(r.geometria, {
        style: { color: "#fff", weight: 2, fillColor: COLORES[r.cultivo] || "#e5e7eb", fillOpacity: 0.45 },
      });
      g.on("click", () => onSeleccionar?.(r));
      g.bindTooltip(esc(`${r.parcela_nombre}${r.n_en_parcela > 1 && r.recinto_sigpac ? " · " + r.recinto_sigpac : ""}`), { direction: "center", className: "!bg-white/90 !font-bold" });
      g.addTo(capa.current);
    }
    for (const f of fotos) {
      if (f.lat == null) continue;
      L.marker([f.lat, f.lon], { icon: L.divIcon({ html: "📷", className: "text-xl", iconSize: [24, 24] }) })
        .bindPopup(() => {
          const div = document.createElement("div");
          const img = document.createElement("img");
          img.src = f.url || "";
          img.style.cssText = "width:200px;border-radius:8px";
          const p = document.createElement("p");
          p.textContent = f.descripcion || "";
          div.append(img, p);
          return div;
        })
        .addTo(capa.current);
    }
    const b = capa.current.getBounds();
    if (b.isValid()) m.fitBounds(b, { padding: [30, 30], maxZoom: 17 });
  }, [recintos, fotos, onSeleccionar]);

  useEffect(() => {
    const m = mapa.current;
    if (!m || !gps) return;
    if (!yo.current) yo.current = L.circleMarker([gps.lat, gps.lon], { radius: 9, color: "#fff", weight: 3, fillColor: "#2563eb", fillOpacity: 1 }).addTo(m);
    else yo.current.setLatLng([gps.lat, gps.lon]);
  }, [gps]);

  return <div ref={caja} className="h-full w-full" />;
}
