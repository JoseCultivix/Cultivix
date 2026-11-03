"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useApp } from "@/components/AppProvider";
import { Cargando, Pagina, Tarjeta, Vacio } from "@/components/ui";

const fecha = (f) => new Date(f + "T12:00:00").toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" });
const dias = (f) => Math.round((new Date(f + "T12:00:00") - new Date(new Date().toISOString().slice(0, 10) + "T12:00:00")) / 86400000);

export default function Plazos() {
  const { empresaId } = useApp();
  const [filas, setFilas] = useState(null);
  useEffect(() => {
    const desde = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    supabase
      .from("v_plazos_seguridad")
      .select("recinto_id, parcela, cultivo, producto, fecha, plazo_dias, fecha_segura, origen_plazo")
      .eq("empresa_id", empresaId)
      .gte("fecha_segura", desde)
      .order("fecha_segura", { ascending: false })
      .then(({ data }) => {
        // Por recinto, el plazo que termina más tarde manda
        const porRecinto = new Map();
        for (const f of data || []) {
          const prev = porRecinto.get(f.recinto_id);
          if (!prev || f.fecha_segura > prev.fecha_segura) porRecinto.set(f.recinto_id, { ...f, otros: prev ? [prev, ...(prev.otros || [])] : [] });
          else prev.otros = [...(prev.otros || []), f];
        }
        setFilas([...porRecinto.values()].sort((a, b) => b.fecha_segura.localeCompare(a.fecha_segura)));
      });
  }, [empresaId]);

  const activos = (filas || []).filter((f) => dias(f.fecha_segura) > 0);
  const pasados = (filas || []).filter((f) => dias(f.fecha_segura) <= 0);

  return (
    <Pagina titulo="Plazos de seguridad" subtitulo="Cuándo puedes cosechar cada parcela después de tratar" volver="/">
      <p className="mb-4 text-[15px] text-stone-600">
        Se calculan con los tratamientos que registras y el plazo del Registro de Fitosanitarios del MAPA para tu cultivo. Si un producto tiene varios usos, se toma el plazo más largo. Manda siempre lo que diga la etiqueta.
      </p>
      {filas === null ? (
        <Cargando />
      ) : !filas.length ? (
        <Vacio icono="✅" titulo="Nada pendiente" texto="Ninguna parcela está dentro de un plazo de seguridad." />
      ) : (
        <>
          {activos.length > 0 && <h2 className="mb-2 text-sm font-bold uppercase text-red-700">No cosechar todavía</h2>}
          <div className="space-y-2">
            {activos.map((f) => (
              <Tarjeta key={f.recinto_id} className="border-2 border-red-100 !p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-lg font-extrabold text-olivo-900">{f.parcela}</p>
                    <p className="text-sm text-stone-600">
                      {f.cultivo} · {f.producto} el {fecha(f.fecha)} · plazo {f.plazo_dias} días{f.origen_plazo === "ficha" ? " (de tu ficha)" : ""}
                    </p>
                    {f.otros?.length > 0 && <p className="text-xs text-stone-500">También: {f.otros.map((o) => o.producto).join(", ")}</p>}
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-stone-500">Cosechar desde</p>
                    <p className="text-lg font-black text-red-700">{fecha(f.fecha_segura)}</p>
                    <p className="text-xs font-bold text-red-700">faltan {dias(f.fecha_segura)} días</p>
                  </div>
                </div>
              </Tarjeta>
            ))}
          </div>
          {pasados.length > 0 && (
            <>
              <h2 className="mb-2 mt-6 text-sm font-bold uppercase text-stone-500">Ya cumplidos (últimos 30 días)</h2>
              <div className="space-y-2">
                {pasados.map((f) => (
                  <Tarjeta key={f.recinto_id} className="!p-3 opacity-80">
                    <p className="font-bold text-olivo-900">
                      ✓ {f.parcela} <span className="font-normal text-stone-500">· {f.producto} · se puede cosechar desde el {fecha(f.fecha_segura)}</span>
                    </p>
                  </Tarjeta>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </Pagina>
  );
}
