"use client";
import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { supabase } from "@/lib/supabase";
import { useApp } from "@/components/AppProvider";
import { Boton, Hoja } from "@/components/ui";
import { fechaCorta, nombreRecinto, num, USOS_SIGPAC } from "@/lib/formato";

const MapaLeaflet = dynamic(() => import("@/components/MapaLeaflet"), { ssr: false, loading: () => <div className="grid h-full place-items-center text-stone-500">Cargando mapa…</div> });

export default function Mapa() {
  const { recintos, gps, empresaId, labores, actualizarGps } = useApp();
  const [sel, setSel] = useState(null);
  const [historial, setHistorial] = useState([]);
  const [fotos, setFotos] = useState([]);

  useEffect(() => {
    // Mapa fotográfico (DEC-056): últimas fotos con GPS
    supabase
      .from("fotografias")
      .select("id, archivo_path, lat, lon, descripcion")
      .eq("empresa_id", empresaId)
      .not("lat", "is", null)
      .order("tomada_en", { ascending: false })
      .limit(40)
      .then(async ({ data }) => {
        if (!data?.length) return;
        const { data: urls } = await supabase.storage.from("documentos").createSignedUrls(data.map((f) => f.archivo_path), 3600);
        setFotos(data.map((f, i) => ({ ...f, url: urls?.[i]?.signedUrl })));
      });
  }, [empresaId]);

  const seleccionar = useCallback(async (r) => {
    setSel(r);
    const { data } = await supabase
      .from("partes_trabajo_recintos")
      .select("partes_trabajo!inner(fecha, labor_id, horas_totales, estado)")
      .eq("recinto_id", r.id)
      .neq("partes_trabajo.estado", "descartado")
      .limit(200);
    setHistorial((data || []).map((x) => x.partes_trabajo).sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, 8));
  }, []);

  return (
    <div className="relative h-[calc(100dvh-4rem)] w-full">
      <MapaLeaflet recintos={recintos} gps={gps} fotos={fotos} onSeleccionar={seleccionar} />
      <button type="button" onClick={actualizarGps} className="absolute top-3 left-3 z-[400] rounded-full bg-white px-4 py-2.5 text-sm font-bold shadow-lg">
        📍 Dónde estoy
      </button>
      {recintos.every((r) => !r.geometria) && (
        <div className="absolute inset-x-3 bottom-4 z-[400] rounded-2xl bg-white p-4 text-center shadow-lg">
          <p className="font-bold">Tus parcelas aún no tienen linderos</p>
          <p className="text-sm text-stone-600">Impórtalas de SIGPAC para verlas en el mapa y que el GPS las reconozca solo.</p>
          <Boton href="/parcelas" className="mt-3">
            Importar de SIGPAC
          </Boton>
        </div>
      )}
      <Hoja abierta={!!sel} onCerrar={() => setSel(null)} titulo={sel ? nombreRecinto(sel, sel.n_en_parcela) : ""}>
        {sel && (
          <div className="space-y-3">
            <p className="text-[15px] text-stone-700">
              {[sel.cultivo, sel.variedad, `${num(sel.superficie_sigpac_ha)} ha`, sel.uso_sigpac && `${sel.uso_sigpac} (${USOS_SIGPAC[sel.uso_sigpac] || ""})`, sel.finca_nombre].filter(Boolean).join(" · ")}
            </p>
            {!sel.referencia_sigpac?.includes("?") && <p className="text-sm text-stone-500">SIGPAC {sel.referencia_sigpac}</p>}
            <div>
              <p className="mb-1 text-sm font-bold uppercase text-stone-500">Últimos trabajos</p>
              {historial.length ? (
                historial.map((h, i) => (
                  <p key={i} className="border-b border-stone-200 py-1.5 text-[15px]">
                    <b>{fechaCorta(h.fecha)}</b> · {labores.find((l) => l.id === h.labor_id)?.nombre || "Trabajo"} {h.horas_totales ? `· ${num(h.horas_totales)} h` : ""}
                  </p>
                ))
              ) : (
                <p className="text-stone-500">Sin trabajos registrados.</p>
              )}
            </div>
            <Boton href={`/trabajo?recintos=${sel.id}`} grande className="w-full">
              🚜 Registrar trabajo aquí
            </Boton>
          </div>
        )}
      </Hoja>
    </div>
  );
}
