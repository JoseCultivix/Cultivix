"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useApp } from "@/components/AppProvider";
import ParteEditor from "@/components/ParteEditor";
import { Boton, Cargando, Etiqueta, Hoja, Pagina, Vacio } from "@/components/ui";
import { guardarParte } from "@/lib/offline";
import { euros, fechaLarga, nombreRecinto, num } from "@/lib/formato";

const ESTADOS = {
  en_curso: ["En curso", "ambar"],
  pendiente: ["Pendiente", "tierra"],
  borrador: ["Borrador", "gris"],
  validado: ["Validado", "olivo"],
  descartado: ["Descartado", "rojo"],
};

export default function Partes() {
  const { empresaId, esGestor, labores, recintos, notificar, trabajadores } = useApp();
  const [filtro, setFiltro] = useState(esGestor ? "pendiente" : "todos");
  const [partes, setPartes] = useState(null);
  const [costes, setCostes] = useState({});
  const [sel, setSel] = useState([]);
  const [editando, setEditando] = useState(null);
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    let q = supabase
      .from("partes_trabajo")
      .select(
        "*, partes_trabajo_recintos(recinto_id), partes_trabajo_trabajadores(trabajador_id, horas), partes_trabajo_maquinaria(maquinaria_id), partes_trabajo_aperos(apero_id), riegos_parte(sistema, m3_ha, volumen_m3, fertirrigacion), aplicaciones(tipo, plaga_o_motivo, metodo_aplicacion, justificacion, volumen_caldo_l_ha, aplicaciones_productos(producto_id, dosis_ha, unidad_dosis))"
      )
      .eq("empresa_id", empresaId)
      .order("fecha", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(150);
    if (filtro !== "todos") q = q.eq("estado", filtro);
    else q = q.neq("estado", "descartado");
    const { data: crudo } = await q;
    // aplicaciones y riegos_parte son 1 a 1 con el parte: PostgREST los devuelve como objeto, no como lista
    const data = (crudo || []).map((x) => ({ ...x, aplicaciones: x.aplicaciones ? [].concat(x.aplicaciones) : [] }));
    setPartes(data);
    if (esGestor && data?.length) {
      const { data: c } = await supabase.from("v_partes_coste").select("*").in("parte_trabajo_id", data.map((p) => p.id));
      setCostes(Object.fromEntries((c || []).map((x) => [x.parte_trabajo_id, Number(x.coste_mano_obra) + Number(x.coste_maquinaria) + Number(x.coste_productos)])));
    }
  }, [empresaId, filtro, esGestor]);

  useEffect(() => {
    cargar();
    setSel([]);
  }, [cargar]);

  async function validar(ids) {
    const { data, error } = await supabase.rpc("validar_partes", { p_ids: ids });
    if (error) return notificar(error.message, "error");
    notificar(`${data} parte(s) validado(s) ✓`);
    cargar();
  }

  async function guardarEdicion(payload) {
    setGuardando(true);
    try {
      await guardarParte({ ...payload, id: editando.id, empresa_id: empresaId, estado: esGestor ? "validado" : editando.estado });
      notificar("Parte actualizado ✓");
      setEditando(null);
      cargar();
    } catch (e) {
      notificar(e.message, "error");
    } finally {
      setGuardando(false);
    }
  }

  async function descartar(p) {
    if (!confirm("¿Descartar este parte?")) return;
    const { error } = await supabase.from("partes_trabajo").update({ estado: "descartado" }).eq("id", p.id);
    if (error) return notificar(error.message, "error");
    setEditando(null);
    cargar();
  }

  const grupos = {};
  for (const p of partes || []) (grupos[p.fecha] = grupos[p.fecha] || []).push(p);

  return (
    <Pagina titulo={esGestor ? "Partes de trabajo" : "Mis partes"} volver="/mas">
      <div className="no-print -mx-4 mb-4 flex gap-2 overflow-x-auto px-4">
        {[["pendiente", "Por validar"], ["todos", "Todos"], ["validado", "Validados"], ["en_curso", "En curso"]].map(([k, t]) => (
          <button key={k} type="button" onClick={() => setFiltro(k)} className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold ${filtro === k ? "bg-olivo-700 text-white" : "bg-white text-stone-700"}`}>
            {t}
          </button>
        ))}
      </div>

      {esGestor && filtro === "pendiente" && partes?.length > 0 && (
        <div className="mb-4 flex gap-2">
          <Boton className="flex-1" onClick={() => validar(sel.length ? sel : partes.map((p) => p.id))}>
            ✓ Validar {sel.length ? `${sel.length} seleccionados` : "todos"}
          </Boton>
        </div>
      )}

      {partes === null ? (
        <Cargando />
      ) : partes.length === 0 ? (
        <Vacio icono="📋" titulo="Nada por aquí" texto={filtro === "pendiente" ? "No hay partes pendientes de validar." : "Aún no hay partes registrados."}>
          <Boton href="/trabajo">Registrar trabajo</Boton>
        </Vacio>
      ) : (
        Object.entries(grupos).map(([fecha, lista]) => (
          <div key={fecha} className="mb-5">
            <p className="mb-2 text-sm font-bold text-stone-500">{fechaLarga(fecha)}</p>
            <div className="space-y-2">
              {lista.map((p) => {
                const l = labores.find((x) => x.id === p.labor_id);
                const rs = recintos.filter((r) => p.partes_trabajo_recintos?.some((x) => x.recinto_id === r.id));
                const ts = trabajadores.filter((t) => p.partes_trabajo_trabajadores?.some((x) => x.trabajador_id === t.id));
                const [et, col] = ESTADOS[p.estado] || [p.estado, "gris"];
                return (
                  <div key={p.id} className="flex items-stretch gap-2">
                    {esGestor && p.estado === "pendiente" && (
                      <input
                        type="checkbox"
                        className="h-6 w-6 self-center accent-olivo-700"
                        checked={sel.includes(p.id)}
                        onChange={(e) => setSel(e.target.checked ? [...sel, p.id] : sel.filter((x) => x !== p.id))}
                      />
                    )}
                    <button type="button" onClick={() => p.estado !== "en_curso" && setEditando(p)} className="flex-1 rounded-2xl bg-white p-3 text-left shadow-sm">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-lg font-extrabold text-olivo-900">{l?.nombre || "Trabajo"}</p>
                        <Etiqueta color={col}>{et}</Etiqueta>
                      </div>
                      <p className="text-[15px] text-stone-700">{rs.map((r) => nombreRecinto(r, r.n_en_parcela)).join(", ") || "Sin parcela"}</p>
                      <p className="mt-1 text-sm text-stone-500">
                        {p.horas_totales ? `${num(p.horas_totales)} h` : ""}
                        {ts.length ? ` · ${ts.map((t) => t.nombre).join(", ")}` : ""}
                        {p.aplicaciones?.[0]?.aplicaciones_productos?.length ? " · 🧴 aplicación" : ""}
                        {esGestor && costes[p.id] ? ` · ${euros(costes[p.id])}` : ""}
                        {p.origen === "voz" || p.origen === "ia" ? " · 🎤" : ""}
                      </p>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}

      <Hoja abierta={!!editando} onCerrar={() => setEditando(null)} titulo="Revisar parte">
        {editando && (
          <>
            <ParteEditor
              modo="completo"
              inicial={{
                ...editando,
                horas: editando.horas_totales,
                recinto_ids: editando.partes_trabajo_recintos.map((x) => x.recinto_id),
                trabajador_ids: editando.partes_trabajo_trabajadores.map((x) => x.trabajador_id),
                maquinaria_ids: editando.partes_trabajo_maquinaria.map((x) => x.maquinaria_id),
                apero_ids: editando.partes_trabajo_aperos.map((x) => x.apero_id),
                aplicacion: editando.aplicaciones?.[0]
                  ? { plaga_o_motivo: editando.aplicaciones[0].plaga_o_motivo, metodo_aplicacion: editando.aplicaciones[0].metodo_aplicacion, justificacion: editando.aplicaciones[0].justificacion, volumen_caldo_l_ha: editando.aplicaciones[0].volumen_caldo_l_ha, productos: editando.aplicaciones[0].aplicaciones_productos }
                  : undefined,
                riego: (Array.isArray(editando.riegos_parte) ? editando.riegos_parte[0] : editando.riegos_parte) || undefined,
              }}
              textoGuardar={esGestor ? "Guardar y validar" : "Guardar"}
              guardando={guardando}
              onGuardar={guardarEdicion}
            />
            {(esGestor || editando.estado !== "validado") && (
              <Boton variante="peligro" className="mt-3 w-full" onClick={() => descartar(editando)}>
                Descartar parte
              </Boton>
            )}
          </>
        )}
      </Hoja>
    </Pagina>
  );
}
