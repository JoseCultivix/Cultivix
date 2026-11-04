"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useApp } from "@/components/AppProvider";
import { Etiqueta, Seccion, Tarjeta } from "@/components/ui";
import { leerTrabajoEnCurso } from "@/lib/offline";
import { duracion, fechaLarga, nombreRecinto, num, saludo } from "@/lib/formato";

const TIEMPO = { 0: "☀️", 1: "🌤️", 2: "⛅", 3: "☁️", 45: "🌫️", 48: "🌫️", 51: "🌦️", 53: "🌦️", 55: "🌧️", 61: "🌧️", 63: "🌧️", 65: "🌧️", 80: "🌦️", 81: "🌧️", 82: "⛈️", 95: "⛈️" };

export default function Inicio() {
  const { perfil, empresa, empresaId, esGestor, deteccion, gps, recintos, labores, productos, actualizarGps } = useApp();
  const [alertas, setAlertas] = useState([]);
  const [tiempo, setTiempo] = useState(null);
  const [anioPasado, setAnioPasado] = useState([]);
  const [enCurso, setEnCurso] = useState(null);

  useEffect(() => {
    setEnCurso(leerTrabajoEnCurso());
    const f = () => setEnCurso(leerTrabajoEnCurso());
    window.addEventListener("cultivix-trabajo", f);
    return () => window.removeEventListener("cultivix-trabajo", f);
  }, []);

  useEffect(() => {
    if (!empresaId) return;
    supabase
      .from("v_alertas")
      .select("*")
      .eq("empresa_id", empresaId)
      .then(({ data }) => setAlertas(data || []));
    // "El año pasado por estas fechas…" (FLUJO 1, paso 8)
    const d = new Date();
    const desde = new Date(d.getFullYear() - 1, d.getMonth(), d.getDate() - 7).toISOString().slice(0, 10);
    const hasta = new Date(d.getFullYear() - 1, d.getMonth(), d.getDate() + 10).toISOString().slice(0, 10);
    supabase
      .from("partes_trabajo")
      .select("fecha, labor_id, partes_trabajo_recintos(recinto_id)")
      .eq("empresa_id", empresaId)
      .gte("fecha", desde)
      .lte("fecha", hasta)
      .neq("estado", "descartado")
      .limit(20)
      .then(({ data }) => setAnioPasado(data || []));
  }, [empresaId]);

  // Meteorología (Open-Meteo, gratuita y sin clave). AEMET se puede añadir después.
  useEffect(() => {
    const ref = gps || (recintos.find((r) => r.centro_lat) && { lat: recintos.find((r) => r.centro_lat).centro_lat, lon: recintos.find((r) => r.centro_lat).centro_lon });
    if (!ref) return;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${ref.lat.toFixed(3)}&longitude=${ref.lon.toFixed(3)}&current=temperature_2m,wind_speed_10m,weather_code&hourly=precipitation_probability,precipitation&forecast_days=3&timezone=auto`;
    fetch(url)
      .then((r) => r.json())
      .then((j) => {
        const ahora = Date.now();
        let lluvia = null;
        j.hourly?.time?.forEach((t, i) => {
          const ms = new Date(t).getTime();
          if (ms > ahora && ms < ahora + 48 * 3600000 && j.hourly.precipitation_probability[i] >= 60 && !lluvia)
            lluvia = { horas: Math.round((ms - ahora) / 3600000), prob: j.hourly.precipitation_probability[i] };
        });
        setTiempo({ temp: Math.round(j.current?.temperature_2m), viento: Math.round(j.current?.wind_speed_10m), codigo: j.current?.weather_code, lluvia });
      })
      .catch(() => {});
  }, [gps?.lat, recintos.length]); // eslint-disable-line

  const nombre = perfil?.nombre?.split(" ")[0] || "";
  const r = deteccion?.recinto;

  // Sugerencias discretas (UX-009): nunca bloquean
  const sugerencias = [];
  if (tiempo?.lluvia) sugerencias.push(`🌧️ Lluvia probable (${tiempo.lluvia.prob}%) en unas ${tiempo.lluvia.horas} h. Si tenías previsto tratar, tenlo en cuenta.`);
  if (tiempo?.viento >= 20) sugerencias.push(`💨 Viento de ${tiempo.viento} km/h: mala hora para tratamientos.`);
  if (esGestor) {
    const reciente = productos.find((p) => p.ultima_compra && Number(p.stock) > 0 && (Date.now() - new Date(p.ultima_compra)) / 86400000 < 30);
    if (reciente) sugerencias.push(`🧴 Compraste ${reciente.nombre} hace ${Math.round((Date.now() - new Date(reciente.ultima_compra)) / 86400000)} días (quedan ${num(reciente.stock, 1)} ${reciente.unidad}).`);
  }
  if (anioPasado.length) {
    const nombres = [...new Set(anioPasado.map((p) => labores.find((l) => l.id === p.labor_id)?.nombre).filter(Boolean))].slice(0, 3);
    if (nombres.length) sugerencias.push(`📅 El año pasado por estas fechas: ${nombres.join(", ")}.`);
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-5 pb-nav">
      <header className="flex items-start justify-between">
        <div>
          <p className="text-[15px] text-stone-500">{fechaLarga(new Date().toISOString())}</p>
          <h1 className="text-3xl font-black tracking-tight text-olivo-900">
            {saludo()}
            {nombre && `, ${nombre}`}
          </h1>
          <p className="text-[15px] font-semibold text-olivo-700">{empresa?.nombre}</p>
        </div>
        {tiempo && (
          <div className="rounded-2xl bg-white px-3 py-2 text-right shadow-sm">
            <p className="text-2xl font-black">
              {TIEMPO[tiempo.codigo] || "🌡️"} {tiempo.temp}°
            </p>
            <p className="text-xs text-stone-500">💨 {tiempo.viento} km/h</p>
          </div>
        )}
      </header>

      {enCurso && (
        <Link href="/trabajo" className="mt-4 block rounded-2xl bg-olivo-800 p-4 text-white shadow">
          <p className="text-sm font-bold uppercase text-olivo-200">● Trabajo en curso · {duracion(enCurso.inicio)}</p>
          <p className="text-xl font-extrabold">{labores.find((l) => l.id === enCurso.labor_id)?.nombre || "Trabajo"} — toca para terminar</p>
        </Link>
      )}

      <Tarjeta className="mt-4 flex items-center gap-3">
        <span className="text-3xl">📍</span>
        <div className="min-w-0 flex-1">
          {r ? (
            <>
              <p className="text-lg font-extrabold text-olivo-900">
                {deteccion.seguro ? "Estás en " : "Cerca de "}
                {nombreRecinto(r, r.n_en_parcela)}
              </p>
              <p className="text-[15px] text-stone-600">
                {[r.cultivo, r.superficie_sigpac_ha && `${num(r.superficie_sigpac_ha)} ha`, r.referencia_sigpac?.includes("?") ? null : `SIGPAC ${r.referencia_sigpac}`].filter(Boolean).join(" · ")}
              </p>
            </>
          ) : (
            <>
              <p className="text-lg font-bold text-stone-800">{gps ? "No estás en ninguna de tus parcelas" : "Ubicación no disponible"}</p>
              <p className="text-sm text-stone-500">
                {recintos.length === 0 ? (
                  <Link href="/parcelas" className="font-semibold text-olivo-700">
                    Añade tus parcelas desde SIGPAC →
                  </Link>
                ) : (
                  "Elegirás la parcela al registrar"
                )}
              </p>
            </>
          )}
        </div>
        <button type="button" onClick={actualizarGps} className="h-11 w-11 rounded-full bg-olivo-50 text-xl" aria-label="Actualizar ubicación">
          ↻
        </button>
      </Tarjeta>

      {/* Acciones principales (UX-007) */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <Accion href="/asistente?voz=1" icono="🎤" texto="Hablar con Cultivix" principal />
        <Accion href="/trabajo" icono="🚜" texto="Registrar trabajo" principal />
        <Accion href="/foto" icono="📷" texto="Hacer foto" />
        {esGestor ? <Accion href="/escanear" icono="📄" texto="Escanear documento" /> : <Accion href="/partes" icono="📋" texto="Mis partes" />}
      </div>
      <Link href="/cosechas?nueva=1" className="mt-3 flex items-center gap-3 rounded-2xl border-2 border-tierra-100 bg-tierra-50 px-4 py-3 font-extrabold text-tierra-700">
        <span className="text-2xl">🧺</span> Apuntar entrega de cosecha
      </Link>
      <Link href="/calendario" className="mt-3 flex items-center gap-3 rounded-2xl border-2 border-stone-200 bg-white px-4 py-3 font-extrabold text-olivo-800">
        <span className="text-2xl">📅</span> Calendario de trabajos
        <span className="ml-auto text-sm font-semibold text-stone-500">por día y trabajador</span>
      </Link>
      <Link href="/agronomia" className="mt-3 flex items-center gap-3 rounded-2xl border-2 border-olivo-100 bg-olivo-50 px-4 py-3 font-extrabold text-olivo-800">
        <span className="text-2xl">🌿</span> Preguntar a AgronomIA
        <span className="ml-auto text-sm font-semibold text-olivo-600">plagas, abonado, riego…</span>
      </Link>

      {alertas.length > 0 && (
        <Seccion titulo="Avisos">
          <div className="space-y-2">
            {alertas.map((a, i) => (
              <Link key={i} href={a.enlace || "/"} className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-sm">
                <span className="text-xl">{a.prioridad === "alta" ? "🔴" : a.prioridad === "media" ? "🟠" : "🟡"}</span>
                <span className="flex-1 text-[15px] font-semibold text-stone-800">{a.texto}</span>
                <span className="text-stone-400">›</span>
              </Link>
            ))}
          </div>
        </Seccion>
      )}

      {sugerencias.length > 0 && (
        <Seccion titulo="Para hoy">
          <div className="space-y-2">
            {sugerencias.map((s, i) => (
              <p key={i} className="rounded-2xl bg-olivo-50 px-4 py-3 text-[15px] text-olivo-900">
                {s}
              </p>
            ))}
          </div>
        </Seccion>
      )}

      {!esGestor && (
        <p className="mt-6 text-center text-sm text-stone-500">
          <Etiqueta color="gris">Modo trabajador</Etiqueta> Tus partes los revisa el encargado.
        </p>
      )}
    </div>
  );
}

function Accion({ href, icono, texto, principal }) {
  return (
    <Link
      href={href}
      className={`flex min-h-32 flex-col items-center justify-center gap-2 rounded-3xl p-3 text-center text-lg font-extrabold leading-tight shadow-sm active:scale-[.98] ${
        principal ? "bg-olivo-700 text-white" : "border-2 border-olivo-200 bg-white text-olivo-900"
      }`}
    >
      <span className="text-4xl">{icono}</span>
      {texto}
    </Link>
  );
}
