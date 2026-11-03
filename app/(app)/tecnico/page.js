"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useApp } from "@/components/AppProvider";
import { useNavegar } from "@/lib/navegacion";
import { Cargando, Etiqueta, Pagina, Tarjeta, Vacio } from "@/components/ui";
import { num } from "@/lib/formato";

const fecha = (f) => (f ? new Date(f + "T12:00").toLocaleDateString("es-ES", { day: "numeric", month: "short" }) : "—");

export default function PanelTecnico() {
  const { empresaId, cambiarEmpresa } = useApp();
  const navegar = useNavegar();
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    supabase.rpc("panel_explotaciones").then(({ data, error }) => {
      if (error) setError(error.message);
      setFilas(data || []);
    });
  }, []);

  async function ir(id, ruta) {
    if (id !== empresaId) await cambiarEmpresa(id);
    navegar(ruta);
  }

  const avisos = (f) => Number(f.plazos_activos) + Number(f.recintos_exceso) + Number(f.campanas_sin_plan) + Number(f.partes_pendientes);

  return (
    <Pagina titulo="Mis explotaciones" subtitulo="Resumen de todas las explotaciones a las que tienes acceso" volver="/mas">
      {error && <p className="mb-3 text-red-700">{error}</p>}
      {filas === null ? (
        <Cargando />
      ) : filas.length === 0 ? (
        <Vacio icono="🧑‍🌾" titulo="Sin explotaciones" texto="Cuando un agricultor te invite como técnico desde sus Ajustes, aparecerá aquí." />
      ) : (
        <>
          <p className="mb-3 text-sm text-stone-600">
            {filas.length} explotación(es) · {num(filas.reduce((s, f) => s + Number(f.hectareas || 0), 0))} ha en total. Ordenadas por avisos pendientes.
          </p>
          <div className="space-y-3">
            {[...filas]
              .sort((a, b) => avisos(b) - avisos(a) || a.nombre.localeCompare(b.nombre))
              .map((f) => (
                <Tarjeta key={f.empresa_id} className={`!p-3 ${f.empresa_id === empresaId ? "border-2 border-olivo-300" : ""}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-lg font-extrabold text-olivo-900">{f.nombre}</p>
                      <p className="text-sm text-stone-500">
                        {[f.municipio, f.provincia].filter(Boolean).join(", ") || "Sin ubicación"} · {num(f.hectareas || 0)} ha · {f.recintos} recintos
                      </p>
                    </div>
                    <Etiqueta color={f.rol === "tecnico" ? "tierra" : "gris"}>{f.rol}</Etiqueta>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                    <span>🧪 {f.tratamientos_30d} tratamiento(s) en 30 días</span>
                    <span>Último: {fecha(f.ultimo_tratamiento)}</span>
                    <span className={Number(f.plazos_activos) ? "font-bold text-red-700" : "text-stone-500"}>⏳ {f.plazos_activos} parcela(s) en plazo de seguridad</span>
                    <span className={Number(f.recintos_exceso) ? "font-bold text-red-700" : "text-stone-500"}>🌾 {f.recintos_exceso} con exceso de abonado</span>
                    <span className={Number(f.campanas_sin_plan) ? "font-bold text-amber-700" : "text-stone-500"}>📝 {f.campanas_sin_plan} campaña(s) sin plan de abonado</span>
                    <span className={Number(f.partes_pendientes) ? "font-bold text-amber-700" : "text-stone-500"}>📋 {f.partes_pendientes} parte(s) por validar</span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {[
                      ["/cuaderno/oficial", "Cuaderno"],
                      ["/fertilizacion", "Abonado"],
                      ["/plazos", "Plazos"],
                      ["/agronomia", "AgronomIA"],
                      ["/", "Entrar"],
                    ].map(([ruta, t]) => (
                      <button key={ruta} type="button" onClick={() => ir(f.empresa_id, ruta)} className={`rounded-full px-3 py-1.5 text-sm font-bold ${ruta === "/" ? "bg-olivo-700 text-white" : "bg-olivo-50 text-olivo-800"}`}>
                        {t}
                      </button>
                    ))}
                  </div>
                </Tarjeta>
              ))}
          </div>
        </>
      )}
      <p className="mt-6 text-xs text-stone-500">
        Para llevar una explotación nueva, pide al agricultor que te invite desde Ajustes → Equipo con el rol «Técnico / asesor». Como técnico ves el cuaderno, los tratamientos y el abonado, y puedes poner el plan de abonado; no ves la economía.
      </p>
    </Pagina>
  );
}
