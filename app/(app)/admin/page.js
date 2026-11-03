"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useApp } from "@/components/AppProvider";
import { Cargando, Etiqueta, Pagina, Tarjeta, claseInput } from "@/components/ui";
import { fechaCorta } from "@/lib/formato";

const TIPO = { sugerencia: "💡", error: "🐞", duda: "❓", idea: "✨", otro: "💬" };
const ESTADOS = ["nueva", "vista", "en_curso", "hecha", "descartada"];

function hace(f) {
  if (!f) return "nunca";
  const d = Math.floor((Date.now() - new Date(f)) / 86400000);
  return d === 0 ? "hoy" : d === 1 ? "ayer" : `hace ${d} días`;
}

/** Panel de la beta: uso por explotación (sin ver sus datos) y sugerencias recibidas. Solo administradores de Cultivix. */
export default function Admin() {
  const { esAdminPlataforma, notificar } = useApp();
  const [pestana, setPestana] = useState("uso");
  const [uso, setUso] = useState(null);
  const [sug, setSug] = useState(null);
  const [filtro, setFiltro] = useState("abiertas");

  const cargar = useCallback(async () => {
    const [u, s] = await Promise.all([
      supabase.rpc("admin_resumen_uso"),
      supabase.rpc("admin_sugerencias"),
    ]);
    if (u.error) notificar(u.error.message, "error");
    setUso(u.data || []);
    setSug(s.data || []);
  }, [notificar]);

  useEffect(() => {
    if (esAdminPlataforma) cargar();
  }, [esAdminPlataforma, cargar]);

  async function cambiar(id, cambios) {
    const { error } = await supabase.from("sugerencias").update(cambios).eq("id", id);
    if (error) return notificar(error.message, "error");
    setSug((x) => x.map((s) => (s.id === id ? { ...s, ...cambios } : s)));
  }

  if (!esAdminPlataforma) return <Pagina titulo="Panel">Solo para el equipo de Cultivix.</Pagina>;
  if (!uso || !sug) return <Cargando />;

  const activas7 = uso.filter((u) => u.ultimo_acceso && Date.now() - new Date(u.ultimo_acceso) < 7 * 86400000).length;
  const nuevas = sug.filter((s) => s.estado === "nueva").length;
  const lista = sug.filter((s) => (filtro === "abiertas" ? ["nueva", "vista", "en_curso"].includes(s.estado) : true));
  const notas = sug.filter((s) => s.valoracion);
  const media = notas.length ? notas.reduce((a, s) => a + s.valoracion, 0) / notas.length : null;

  return (
    <Pagina titulo="Panel de la beta" subtitulo="Uso y opiniones de los probadores" volver="/mas">
      <div className="mb-4 grid grid-cols-3 gap-2">
        <Kpi t="Explotaciones" v={uso.length} />
        <Kpi t="Activas 7 días" v={activas7} />
        <Kpi t="Valoración" v={media ? `${media.toFixed(1)} ⭐` : "—"} />
      </div>
      <div className="mb-4 grid grid-cols-2 gap-1 rounded-2xl bg-stone-200/70 p-1 text-sm font-bold">
        {[["uso", "Uso"], ["sug", `Sugerencias${nuevas ? ` (${nuevas})` : ""}`]].map(([k, t]) => (
          <button key={k} type="button" onClick={() => setPestana(k)} className={`rounded-xl py-2.5 ${pestana === k ? "bg-white text-olivo-800 shadow" : "text-stone-600"}`}>
            {t}
          </button>
        ))}
      </div>

      {pestana === "uso" ? (
        <div className="space-y-2">
          <p className="text-sm text-stone-500">Solo se ven cifras de actividad, nunca los datos de cada explotación.</p>
          {uso.map((u) => (
            <Tarjeta key={u.empresa_id} className="!p-3">
              <div className="flex items-start justify-between gap-2">
                <b className="text-olivo-900">{u.empresa}</b>
                <Etiqueta color={u.dias_activos_14d >= 6 ? "olivo" : u.dias_activos_14d >= 2 ? "ambar" : "gris"}>{u.dias_activos_14d} días activos / 14</Etiqueta>
              </div>
              <p className="text-sm text-stone-500">
                Último acceso {hace(u.ultimo_acceso)} · alta {fechaCorta(u.creada)} · {u.usuarios} usuario(s)
              </p>
              <p className="mt-1 text-sm text-stone-700">
                {u.parcelas} parcelas · {u.partes_total} partes ({u.partes_7d} esta semana) · {u.entregas} entregas · {u.compras} compras · {u.fotos} fotos · {u.ia_usos} usos IA
                {u.sugerencias ? ` · ${u.sugerencias} sugerencias` : ""}
              </p>
            </Tarjeta>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex gap-2">
            {[["abiertas", "Pendientes"], ["todas", "Todas"]].map(([k, t]) => (
              <button key={k} type="button" onClick={() => setFiltro(k)} className={`rounded-full px-4 py-2 text-sm font-bold ${filtro === k ? "bg-olivo-700 text-white" : "bg-white"}`}>
                {t}
              </button>
            ))}
          </div>
          {lista.map((s) => (
            <Tarjeta key={s.id} className="!p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="font-bold">
                  {TIPO[s.tipo]} {s.usuario_nombre || s.usuario_email || "Usuario"} <span className="font-normal text-stone-500">· {s.empresa_nombre || ""}</span>
                </p>
                <span className="shrink-0 text-xs text-stone-500">{fechaCorta(s.created_at)}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-[15px]">{s.texto}</p>
              <p className="mt-1 text-xs text-stone-500">
                Pantalla {s.pantalla || "—"}
                {s.valoracion ? ` · ${"⭐".repeat(s.valoracion)}` : ""}
                {s.usuario_email ? ` · ${s.usuario_email}` : ""}
              </p>
              <div className="mt-2 flex items-center gap-2">
                <select className={`${claseInput} !w-auto !py-1.5 text-sm`} value={s.estado} onChange={(e) => cambiar(s.id, { estado: e.target.value })}>
                  {ESTADOS.map((e) => (
                    <option key={e} value={e}>
                      {e.replace("_", " ")}
                    </option>
                  ))}
                </select>
                {s.usuario_email && (
                  <a className="text-sm font-bold text-olivo-700" href={`mailto:${s.usuario_email}?subject=${encodeURIComponent("Tu sugerencia en Cultivix")}`}>
                    Responder
                  </a>
                )}
              </div>
            </Tarjeta>
          ))}
          {!lista.length && <p className="text-stone-500">No hay sugerencias pendientes.</p>}
        </div>
      )}
    </Pagina>
  );
}

function Kpi({ t, v }) {
  return (
    <Tarjeta className="!p-3 text-center">
      <p className="text-2xl font-black text-olivo-900">{v}</p>
      <p className="text-xs text-stone-500">{t}</p>
    </Tarjeta>
  );
}
