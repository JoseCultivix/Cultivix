"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useApp } from "@/components/AppProvider";
import ParteEditor from "@/components/ParteEditor";
import { Boton, Cargando, Etiqueta, Hoja, Pagina, Vacio } from "@/components/ui";
import { guardarParte } from "@/lib/offline";
import { euros, fechaLarga, hora, hoyISO, nombreRecinto, num } from "@/lib/formato";

const ESTADOS = {
  en_curso: ["En curso", "ambar"],
  pendiente: ["Pendiente", "tierra"],
  borrador: ["Borrador", "gris"],
  validado: ["Validado", "olivo"],
};
const DIAS = ["L", "M", "X", "J", "V", "S", "D"];
// Un color por labor, siempre el mismo para la misma labor
const COLORES = ["#4d7c0f", "#b45309", "#0369a1", "#7e22ce", "#be123c", "#0f766e", "#a16207", "#4338ca", "#c2410c", "#15803d"];
const colorDe = (id) => {
  if (!id) return "#78716c";
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORES[h % COLORES.length];
};

// ---- Fechas (en texto AAAA-MM-DD, sin líos de zona horaria) ----
const aFecha = (s) => new Date(s + "T12:00:00");
const aISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const sumar = (s, n) => {
  const d = aFecha(s);
  d.setDate(d.getDate() + n);
  return aISO(d);
};
const lunesDe = (s) => sumar(s, -((aFecha(s).getDay() + 6) % 7));
const primeroDeMes = (s) => s.slice(0, 8) + "01";
const sumarMeses = (s, n) => {
  const d = aFecha(primeroDeMes(s));
  d.setMonth(d.getMonth() + n);
  return aISO(d);
};
const nombreMes = (s) => {
  const t = aFecha(s).toLocaleDateString("es-ES", { month: "long", year: "numeric" });
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const corta = (s) => aFecha(s).toLocaleDateString("es-ES", { day: "numeric", month: "short" });

function rango(vista, ref) {
  if (vista === "dia") return [ref, ref];
  if (vista === "semana") {
    const l = lunesDe(ref);
    return [l, sumar(l, 6)];
  }
  const ini = lunesDe(primeroDeMes(ref));
  const finMes = sumar(sumarMeses(ref, 1), -1);
  return [ini, sumar(lunesDe(finMes), 6)];
}

export default function Calendario() {
  const { empresaId, esGestor, rol, perfil, labores, recintos, trabajadores, maquinaria, aperos, productos, cultivos, notificar } = useApp();
  const [materias, setMaterias] = useState([]);
  const [ufs, setUfs] = useState({});
  const [prodsHecha, setProdsHecha] = useState([]);
  const puedePlanificar = esGestor || rol === "tecnico";
  const yo = trabajadores.find((t) => t.usuario_id === perfil?.id);
  const [tareas, setTareas] = useState([]);
  const [atrasadas, setAtrasadas] = useState([]);
  const [hojaTarea, setHojaTarea] = useState(null); // { modo: "nueva" | "ver" | "editar" | "hecha" | "atrasadas", tarea }
  const [repetir, setRepetir] = useState({ cada: "", veces: 4 });
  const [miembros, setMiembros] = useState({}); // usuario_id -> { nombre, rol }
  useEffect(() => {
    if (!empresaId) return;
    (async () => {
      const { data: eu } = await supabase.from("empresa_usuarios").select("usuario_id, rol").eq("empresa_id", empresaId);
      const ids = (eu || []).map((x) => x.usuario_id);
      const { data: us } = ids.length ? await supabase.from("usuarios").select("id, nombre").in("id", ids) : { data: [] };
      setMiembros(Object.fromEntries((eu || []).map((x) => [x.usuario_id, { rol: x.rol, nombre: (us || []).find((u) => u.id === x.usuario_id)?.nombre || "" }])));
    })();
  }, [empresaId]);
  const autorDe = (t) => miembros[t?.creado_por];
  // Desde el panel del técnico: /calendario?nueva=1 abre directamente el formulario
  useEffect(() => {
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("nueva") === "1" && puedePlanificar) {
      window.history.replaceState(window.history.state, "", "/calendario");
      setMaterias([]);
      setUfs({});
      setHojaTarea({ modo: "nueva", tarea: { fecha: sumar(hoyISO(), 1), recinto_ids: [], trabajador_ids: [], datos: {} } });
    }
  }, [puedePlanificar]);
  const [vista, setVista] = useState("mes");
  const [ref, setRef] = useState(hoyISO());
  const [filtroTrab, setFiltroTrab] = useState("todos");
  const [filtroLabor, setFiltroLabor] = useState("");
  const [filtroRecinto, setFiltroRecinto] = useState("");
  const [partes, setPartes] = useState(null);
  const [detalle, setDetalle] = useState(null);
  const [editando, setEditando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [desde, hasta] = rango(vista, ref);
  const hoy = hoyISO();

  const cargar = useCallback(async () => {
    setPartes(null);
    const { data, error } = await supabase
      .from("partes_trabajo")
      .select(
        "*, partes_trabajo_recintos(recinto_id), partes_trabajo_trabajadores(trabajador_id, horas), partes_trabajo_maquinaria(maquinaria_id), partes_trabajo_aperos(apero_id), riegos_parte(sistema, m3_ha, volumen_m3, fertirrigacion), aplicaciones(tipo, plaga_o_motivo, metodo_aplicacion, justificacion, volumen_caldo_l_ha, aplicaciones_productos(producto_id, dosis_ha, unidad_dosis, cantidad_total))"
      )
      .eq("empresa_id", empresaId)
      .gte("fecha", desde)
      .lte("fecha", hasta)
      .neq("estado", "descartado")
      .order("fecha")
      .order("inicio", { ascending: true, nullsFirst: false })
      .limit(2000);
    if (error) notificar(error.message, "error");
    const [{ data: ts }, { data: at }] = await Promise.all([
      supabase.from("tareas_planificadas").select("*").eq("empresa_id", empresaId).eq("estado", "pendiente").gte("fecha", desde).lte("fecha", hasta).order("fecha").order("hora", { nullsFirst: false }).limit(1000),
      supabase.from("tareas_planificadas").select("*").eq("empresa_id", empresaId).eq("estado", "pendiente").lt("fecha", hoyISO()).order("fecha").limit(100),
    ]);
    setTareas(ts || []);
    setAtrasadas(at || []);
    // aplicaciones y riegos_parte son 1 a 1: PostgREST puede devolverlos como objeto
    setPartes(
      (data || []).map((x) => ({
        ...x,
        aplicaciones: x.aplicaciones ? [].concat(x.aplicaciones) : [],
        riegos_parte: x.riegos_parte ? [].concat(x.riegos_parte) : [],
      }))
    );
  }, [empresaId, desde, hasta, notificar]);

  useEffect(() => {
    if (empresaId) cargar();
  }, [cargar, empresaId]);

  // Horas de un parte para el trabajador filtrado (o totales)
  const horasDe = useCallback(
    (p) => {
      if (filtroTrab !== "todos") {
        const t = p.partes_trabajo_trabajadores?.find((x) => x.trabajador_id === filtroTrab);
        return Number(t?.horas ?? p.horas_totales ?? 0);
      }
      return Number(p.horas_totales ?? 0);
    },
    [filtroTrab]
  );

  const filtrados = useMemo(
    () =>
      (partes || []).filter(
        (p) =>
          (filtroTrab === "todos" ||
            (filtroTrab === "sin" ? !p.partes_trabajo_trabajadores?.length : p.partes_trabajo_trabajadores?.some((x) => x.trabajador_id === filtroTrab))) &&
          (!filtroLabor || p.labor_id === filtroLabor) &&
          (!filtroRecinto || p.partes_trabajo_recintos?.some((x) => x.recinto_id === filtroRecinto))
      ),
    [partes, filtroTrab, filtroLabor, filtroRecinto]
  );

  const pasaTarea = useCallback(
    (t) =>
      (filtroTrab === "todos" || (filtroTrab === "sin" ? !t.trabajador_ids?.length : t.trabajador_ids?.includes(filtroTrab))) &&
      (!filtroLabor || t.labor_id === filtroLabor) &&
      (!filtroRecinto || t.recinto_ids?.includes(filtroRecinto)),
    [filtroTrab, filtroLabor, filtroRecinto]
  );
  const tareasPorDia = useMemo(() => {
    const m = {};
    for (const t of tareas.filter(pasaTarea)) (m[t.fecha] = m[t.fecha] || []).push(t);
    return m;
  }, [tareas, pasaTarea]);
  const atrasadasF = atrasadas.filter(pasaTarea);

  const porDia = useMemo(() => {
    const m = {};
    for (const p of filtrados) (m[p.fecha] = m[p.fecha] || []).push(p);
    return m;
  }, [filtrados]);

  // Resumen del periodo visible (en vista mes, solo el mes en curso)
  const resumen = useMemo(() => {
    const [a, b] = vista === "mes" ? [primeroDeMes(ref), sumar(sumarMeses(ref, 1), -1)] : [desde, hasta];
    const lista = filtrados.filter((p) => p.fecha >= a && p.fecha <= b);
    const porTrab = {};
    const porLabor = {};
    for (const p of lista) {
      for (const t of p.partes_trabajo_trabajadores || []) {
        if (filtroTrab !== "todos" && filtroTrab !== "sin" && t.trabajador_id !== filtroTrab) continue;
        porTrab[t.trabajador_id] = (porTrab[t.trabajador_id] || 0) + Number(t.horas ?? p.horas_totales ?? 0);
      }
      const k = p.labor_id || "";
      porLabor[k] = porLabor[k] || { n: 0, h: 0 };
      porLabor[k].n++;
      porLabor[k].h += horasDe(p);
    }
    return { n: lista.length, dias: new Set(lista.map((p) => p.fecha)).size, horas: lista.reduce((s, p) => s + horasDe(p), 0), porTrab, porLabor };
  }, [filtrados, vista, ref, desde, hasta, filtroTrab, horasDe]);

  const nomLabor = (id) => labores.find((l) => l.id === id)?.nombre || "Trabajo";
  const nomTrab = (id) => trabajadores.find((t) => t.id === id)?.nombre || "Trabajador";

  function mover(n) {
    if (vista === "dia") setRef(sumar(ref, n));
    else if (vista === "semana") setRef(sumar(ref, 7 * n));
    else setRef(sumarMeses(ref, n));
  }
  function abrirDia(f) {
    setRef(f);
    setVista("dia");
  }

  const titulo =
    vista === "mes" ? nombreMes(ref) : vista === "semana" ? `${corta(desde)} – ${corta(hasta)} ${aFecha(hasta).getFullYear()}` : fechaLarga(ref);

  const puedeHacer = (t) => puedePlanificar || !t.trabajador_ids?.length || (yo && t.trabajador_ids.includes(yo.id));
  function nuevaTarea() {
    const f = vista === "dia" ? ref : ref > hoy ? ref : sumar(hoy, 1);
    setRepetir({ cada: "", veces: 4 });
    setMaterias([]);
    setUfs({});
    setHojaTarea({ modo: "nueva", tarea: { fecha: f, recinto_ids: [], trabajador_ids: [], datos: {} } });
  }
  async function guardarTarea(payload) {
    const t = hojaTarea.tarea;
    let hora = null;
    let horas = payload.horas_totales ?? null;
    if (payload.inicio) {
      const d = new Date(payload.inicio);
      hora = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      if (payload.fin) horas = Math.round(((new Date(payload.fin) - d) / 3600000) * 100) / 100;
    }
    const fila = {
      empresa_id: empresaId,
      fecha: payload.fecha,
      hora,
      labor_id: payload.labor_id,
      recinto_ids: payload.recinto_ids || [],
      trabajador_ids: payload.trabajador_ids || [],
      notas: payload.observaciones || null,
      datos: {
        maquinaria_ids: payload.maquinaria_ids || [],
        apero_ids: payload.apero_ids || [],
        aplicacion: payload.aplicacion || null,
        riego: payload.riego || null,
        horas,
        materias: materias.length ? materias : undefined,
        ufs: Object.values(ufs).some((v) => v !== "" && v != null) ? ufs : undefined,
      },
    };
    setGuardando(true);
    try {
      let error;
      if (hojaTarea.modo === "editar") ({ error } = await supabase.from("tareas_planificadas").update(fila).eq("id", t.id));
      else {
        const n = repetir.cada ? Math.min(Math.max(Number(repetir.veces) || 1, 1), 52) : 1;
        const grupo = n > 1 ? crypto.randomUUID() : null;
        const filas = Array.from({ length: n }, (_, i) => ({
          ...fila,
          grupo_id: grupo,
          fecha: repetir.cada === "mes" ? mismoDiaMes(fila.fecha, i) : sumar(fila.fecha, i * (repetir.cada === "2semanas" ? 14 : 7)),
        }));
        ({ error } = await supabase.from("tareas_planificadas").insert(filas));
        if (!error) notificar(n > 1 ? `${n} tareas planificadas ✓` : "Tarea planificada ✓");
      }
      if (error) throw new Error(error.message);
      if (hojaTarea.modo === "editar") notificar("Tarea cambiada ✓");
      setHojaTarea(null);
      cargar();
    } catch (e) {
      notificar(e.message, "error");
    } finally {
      setGuardando(false);
    }
  }
  async function marcarHecha(payload) {
    const t = hojaTarea.tarea;
    setGuardando(true);
    try {
      const r = await guardarParte({ ...payload, empresa_id: empresaId, estado: esGestor ? "validado" : "pendiente" });
      const { error } = await supabase.rpc("completar_tarea", { p_tarea: t.id, p_parte: r.id || null });
      if (error) throw new Error(error.message);
      notificar(r.enCola ? "Parte guardado en el móvil; la tarea queda hecha ✓" : esGestor ? "Tarea hecha y parte guardado ✓" : "Tarea hecha. Parte enviado al encargado ✓");
      setHojaTarea(null);
      cargar();
    } catch (e) {
      notificar(e.message, "error");
    } finally {
      setGuardando(false);
    }
  }
  async function cancelarTarea(t) {
    if (!confirm("¿Quitar esta tarea del calendario?")) return;
    let q = supabase.from("tareas_planificadas").update({ estado: "cancelada" });
    if (t.grupo_id && confirm("Esta tarea se repite. ¿Quitar también las siguientes repeticiones?")) q = q.eq("grupo_id", t.grupo_id).eq("estado", "pendiente").gte("fecha", t.fecha);
    else q = q.eq("id", t.id);
    const { error } = await q;
    if (error) return notificar(error.message, "error");
    notificar("Tarea quitada");
    setHojaTarea(null);
    cargar();
  }
  const inicialDeTarea = (t, fecha) => {
    const a = autorDe(t);
    const base = inicialBase(t, fecha);
    if (a?.rol === "tecnico" && base.aplicacion && !base.aplicacion.justificacion)
      base.aplicacion = { ...base.aplicacion, justificacion: `Recomendado por ${a.nombre || "el técnico"} (técnico/asesor)` };
    return base;
  };
  // Al convertir en parte: los productos comerciales elegidos y la recomendación del técnico como justificación
  const inicialHecha = (t, fecha) => {
    const base = inicialDeTarea(t, fecha);
    const ms = t.datos?.materias || [];
    if (!prodsHecha.length && !ms.length) return base;
    const a = autorDe(t);
    const quien = a?.rol === "tecnico" ? `${a.nombre || "el técnico"} (técnico/asesor)` : a?.nombre || "";
    const rec = ms.map((m) => `${m.materia}${m.agente ? ` para ${m.agente}` : ""}`).join("; ");
    base.aplicacion = {
      ...(base.aplicacion || {}),
      plaga_o_motivo: base.aplicacion?.plaga_o_motivo || [...new Set(ms.map((m) => m.agente).filter(Boolean))].join(", ") || null,
      justificacion: base.aplicacion?.justificacion?.startsWith("Recomendado") || !base.aplicacion?.justificacion ? `Recomendado por ${quien}${rec ? `: ${rec}` : ""}` : base.aplicacion.justificacion,
      productos: [...(base.aplicacion?.productos || []), ...prodsHecha.filter((x) => !(base.aplicacion?.productos || []).some((y) => y.producto_id === x.producto_id))],
    };
    return base;
  };
  const inicialBase = (t, fecha) => ({
    labor_id: t.labor_id,
    fecha: fecha || t.fecha,
    hora_inicio: t.hora ? t.hora.slice(0, 5) : "",
    horas: t.datos?.horas ?? "",
    recinto_ids: t.recinto_ids || [],
    trabajador_ids: t.trabajador_ids || [],
    maquinaria_ids: t.datos?.maquinaria_ids || [],
    apero_ids: t.datos?.apero_ids || [],
    observaciones: t.notas || "",
    aplicacion: t.datos?.aplicacion || undefined,
    riego: t.datos?.riego || undefined,
  });

  async function guardarEdicion(payload) {
    setGuardando(true);
    try {
      await guardarParte({ ...payload, id: detalle.id, empresa_id: empresaId, estado: esGestor ? "validado" : detalle.estado });
      notificar("Parte actualizado ✓");
      setEditando(false);
      setDetalle(null);
      cargar();
    } catch (e) {
      notificar(e.message, "error");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Pagina titulo="Calendario" subtitulo="Lo hecho y lo que hay que hacer" volver="/mas">
      {puedePlanificar && (
        <Boton className="mb-3 w-full" onClick={nuevaTarea}>
          📌 Planificar tarea
        </Boton>
      )}
      {atrasadasF.length > 0 && (
        <button type="button" onClick={() => setHojaTarea({ modo: "atrasadas" })} className="mb-3 w-full rounded-2xl border-2 border-red-200 bg-red-50 px-4 py-3 text-left font-bold text-red-800">
          ⚠️ {atrasadasF.length} tarea(s) planificada(s) sin hacer de días pasados ›
        </button>
      )}
      {/* Vista */}
      <div className="mb-3 grid grid-cols-3 gap-1 rounded-2xl bg-white p-1 shadow-sm">
        {[["mes", "Mes"], ["semana", "Semana"], ["dia", "Día"]].map(([k, t]) => (
          <button key={k} type="button" onClick={() => { if (vista === "mes" && k !== "mes" && ref.slice(0, 7) === hoy.slice(0, 7)) setRef(hoy); setVista(k); }} className={`rounded-xl py-2 text-[15px] font-bold ${vista === k ? "bg-olivo-700 text-white" : "text-stone-700"}`}>
            {t}
          </button>
        ))}
      </div>

      {/* Navegación */}
      <div className="mb-3 flex items-center gap-2">
        <button type="button" aria-label="Anterior" onClick={() => mover(-1)} className="h-11 w-11 shrink-0 rounded-xl bg-white text-xl font-bold text-olivo-800 shadow-sm">
          ‹
        </button>
        <p className="flex-1 text-center text-lg font-extrabold text-olivo-900">{titulo}</p>
        <button type="button" aria-label="Siguiente" onClick={() => mover(1)} className="h-11 w-11 shrink-0 rounded-xl bg-white text-xl font-bold text-olivo-800 shadow-sm">
          ›
        </button>
      </div>
      {!(desde <= hoy && hoy <= hasta) && (
        <button type="button" onClick={() => setRef(hoy)} className="mb-3 w-full rounded-xl bg-olivo-50 py-2 text-sm font-bold text-olivo-800">
          Ir a hoy
        </button>
      )}

      {/* Filtros */}
      <div className="-mx-4 mb-2 flex gap-2 overflow-x-auto px-4 pb-1">
        {[["todos", "👥 Todos"], ...trabajadores.map((t) => [t.id, t.nombre]), ["sin", "Sin trabajador"]].map(([k, t]) => (
          <button key={k} type="button" onClick={() => setFiltroTrab(k)} className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold ${filtroTrab === k ? "bg-olivo-700 text-white" : "bg-white text-stone-700"}`}>
            {t}
          </button>
        ))}
      </div>
      <div className="mb-4 grid grid-cols-2 gap-2">
        <select value={filtroLabor} onChange={(e) => setFiltroLabor(e.target.value)} className="min-h-11 rounded-xl border border-stone-300 bg-white px-3 text-[15px]">
          <option value="">Todas las labores</option>
          {labores.map((l) => (
            <option key={l.id} value={l.id}>
              {l.nombre}
            </option>
          ))}
        </select>
        <select value={filtroRecinto} onChange={(e) => setFiltroRecinto(e.target.value)} className="min-h-11 rounded-xl border border-stone-300 bg-white px-3 text-[15px]">
          <option value="">Todas las parcelas</option>
          {recintos.map((r) => (
            <option key={r.id} value={r.id}>
              {nombreRecinto(r, r.n_en_parcela)}
            </option>
          ))}
        </select>
      </div>

      {partes === null ? (
        <Cargando />
      ) : (
        <>
          {vista === "mes" && <VistaMes ref_={ref} desde={desde} hasta={hasta} hoy={hoy} porDia={porDia} tareasPorDia={tareasPorDia} nomLabor={nomLabor} horasDe={horasDe} onDia={abrirDia} />}
          {vista === "semana" && (
            <div className="space-y-3">
              {Array.from({ length: 7 }, (_, i) => sumar(desde, i)).map((f) => (
                <div key={f}>
                  <button type="button" onClick={() => abrirDia(f)} className="mb-1.5 flex w-full items-baseline justify-between text-left">
                    <span className={`text-sm font-bold ${f === hoy ? "text-olivo-700" : "text-stone-500"}`}>
                      {fechaLarga(f)}
                      {f === hoy ? " · hoy" : ""}
                    </span>
                    <span className="text-xs font-bold text-olivo-700">
                      {porDia[f]?.length ? `${porDia[f].length} · ${num(porDia[f].reduce((s, p) => s + horasDe(p), 0), 1)} h ›` : ""}
                    </span>
                  </button>
                  {porDia[f]?.length || tareasPorDia[f]?.length ? (
                    <div className="space-y-1.5">
                      {(tareasPorDia[f] || []).map((t) => (
                        <TarjetaTarea key={t.id} t={t} hoy={hoy} compacta autor={autorDe(t)} {...{ nomLabor, nomTrab, recintos }} onClick={() => setHojaTarea({ modo: "ver", tarea: t })} />
                      ))}
                      {(porDia[f] || []).map((p) => (
                        <TarjetaParte key={p.id} p={p} compacta {...{ nomLabor, nomTrab, recintos, horasDe }} onClick={() => setDetalle(p)} />
                      ))}
                    </div>
                  ) : (
                    <p className="rounded-xl border border-dashed border-stone-300 px-3 py-2 text-sm text-stone-400">Sin trabajos</p>
                  )}
                </div>
              ))}
            </div>
          )}
          {vista === "dia" &&
            (porDia[ref]?.length || tareasPorDia[ref]?.length ? (
              <div className="space-y-2">
                {(tareasPorDia[ref] || []).map((t) => (
                  <TarjetaTarea key={t.id} t={t} hoy={hoy} autor={autorDe(t)} {...{ nomLabor, nomTrab, recintos }} onClick={() => setHojaTarea({ modo: "ver", tarea: t })} />
                ))}
                {(porDia[ref] || []).map((p) => (
                  <TarjetaParte key={p.id} p={p} {...{ nomLabor, nomTrab, recintos, horasDe }} onClick={() => setDetalle(p)} />
                ))}
              </div>
            ) : (
              <Vacio icono="📅" titulo="Nada este día" texto={filtroTrab !== "todos" || filtroLabor || filtroRecinto ? "Prueba a quitar los filtros." : "No hay partes registrados."}>
                <div className="flex flex-col gap-2">
                  {ref <= hoy && <Boton href="/trabajo">Registrar trabajo</Boton>}
                  {puedePlanificar && ref >= hoy && (
                    <Boton variante="secundario" onClick={nuevaTarea}>
                      📌 Planificar tarea
                    </Boton>
                  )}
                </div>
              </Vacio>
            ))}

          {/* Resumen */}
          {(() => {
            const [a, b] = vista === "mes" ? [primeroDeMes(ref), sumar(sumarMeses(ref, 1), -1)] : [desde, hasta];
            const n = tareas.filter(pasaTarea).filter((t) => t.fecha >= a && t.fecha <= b).length;
            return n ? (
              <p className="mt-4 rounded-2xl border-2 border-dashed border-olivo-200 bg-white px-4 py-3 text-[15px] text-olivo-900">
                📌 <b>{n}</b> tarea(s) planificada(s) pendientes {vista === "mes" ? "este mes" : vista === "semana" ? "esta semana" : "este día"}
              </p>
            ) : null;
          })()}
          {resumen.n > 0 && (
            <div className="mt-5 rounded-2xl bg-white p-4 shadow-sm">
              <p className="mb-2 text-sm font-bold uppercase text-stone-500">
                Resumen {vista === "mes" ? "del mes" : vista === "semana" ? "de la semana" : "del día"}
              </p>
              <p className="text-[15px] text-stone-700">
                <b>{resumen.n}</b> trabajo(s){vista !== "dia" ? ` en ${resumen.dias} día(s)` : ""} · <b>{num(resumen.horas, 1)} h</b>
              </p>
              {Object.keys(resumen.porTrab).length > 0 && (
                <div className="mt-3">
                  <p className="mb-1 text-xs font-bold uppercase text-stone-500">Horas por trabajador</p>
                  {Object.entries(resumen.porTrab)
                    .sort((a, b) => b[1] - a[1])
                    .map(([id, h]) => (
                      <div key={id} className="flex justify-between border-b border-stone-100 py-1 text-[15px]">
                        <span>{nomTrab(id)}</span>
                        <b>{num(h, 1)} h</b>
                      </div>
                    ))}
                </div>
              )}
              <div className="mt-3">
                <p className="mb-1 text-xs font-bold uppercase text-stone-500">Por labor</p>
                {Object.entries(resumen.porLabor)
                  .sort((a, b) => b[1].h - a[1].h)
                  .map(([id, v]) => (
                    <div key={id} className="flex items-center justify-between border-b border-stone-100 py-1 text-[15px]">
                      <span className="flex items-center gap-2">
                        <span className="h-3 w-3 rounded-full" style={{ background: colorDe(id) }} />
                        {nomLabor(id)}
                      </span>
                      <span>
                        {v.n} · <b>{num(v.h, 1)} h</b>
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </>
      )}

      <Hoja
        abierta={!!detalle}
        onCerrar={() => {
          setDetalle(null);
          setEditando(false);
        }}
        titulo={editando ? "Editar parte" : nomLabor(detalle?.labor_id)}
      >
        {detalle && !editando && (
          <Detalle p={detalle} {...{ nomLabor, nomTrab, recintos, maquinaria, aperos, productos }}>
            {detalle.estado !== "en_curso" && (esGestor || detalle.estado !== "validado") && (
              <Boton variante="secundario" className="mt-4 w-full" onClick={() => setEditando(true)}>
                ✏️ Editar este parte
              </Boton>
            )}
          </Detalle>
        )}
        {detalle && editando && (
          <ParteEditor
            modo="completo"
            inicial={{
              ...detalle,
              horas: detalle.horas_totales,
              recinto_ids: detalle.partes_trabajo_recintos.map((x) => x.recinto_id),
              trabajador_ids: detalle.partes_trabajo_trabajadores.map((x) => x.trabajador_id),
              maquinaria_ids: detalle.partes_trabajo_maquinaria.map((x) => x.maquinaria_id),
              apero_ids: detalle.partes_trabajo_aperos.map((x) => x.apero_id),
              aplicacion: detalle.aplicaciones?.[0]
                ? {
                    plaga_o_motivo: detalle.aplicaciones[0].plaga_o_motivo,
                    metodo_aplicacion: detalle.aplicaciones[0].metodo_aplicacion,
                    justificacion: detalle.aplicaciones[0].justificacion,
                    volumen_caldo_l_ha: detalle.aplicaciones[0].volumen_caldo_l_ha,
                    productos: detalle.aplicaciones[0].aplicaciones_productos,
                  }
                : undefined,
              riego: detalle.riegos_parte?.[0] || undefined,
            }}
            textoGuardar={esGestor ? "Guardar y validar" : "Guardar"}
            guardando={guardando}
            onGuardar={guardarEdicion}
          />
        )}
      </Hoja>
      <Hoja
        abierta={!!hojaTarea}
        onCerrar={() => setHojaTarea(null)}
        titulo={
          hojaTarea?.modo === "nueva"
            ? "Planificar tarea"
            : hojaTarea?.modo === "editar"
            ? "Cambiar tarea"
            : hojaTarea?.modo === "hecha"
            ? "Apuntar como hecha"
            : hojaTarea?.modo === "atrasadas"
            ? "Tareas sin hacer"
            : `📌 ${nomLabor(hojaTarea?.tarea?.labor_id)}`
        }
      >
        {hojaTarea?.modo === "atrasadas" && (
          <div className="space-y-2">
            <p className="text-[15px] text-stone-600">Planificadas para días que ya han pasado. Ábrelas para apuntarlas como hechas, cambiarlas de día o quitarlas.</p>
            {atrasadasF.map((t) => (
              <TarjetaTarea key={t.id} t={t} hoy={hoy} conFecha autor={autorDe(t)} {...{ nomLabor, nomTrab, recintos }} onClick={() => setHojaTarea({ modo: "ver", tarea: t })} />
            ))}
          </div>
        )}
        {hojaTarea?.modo === "ver" && (
          <DetalleTarea t={hojaTarea.tarea} hoy={hoy} autor={autorDe(hojaTarea.tarea)} {...{ nomTrab, recintos, maquinaria, aperos, productos }}>
            <div className="mt-4 flex flex-col gap-2">
              {puedeHacer(hojaTarea.tarea) && (
                <Boton
                  onClick={() => {
                    setProdsHecha([]);
                    setHojaTarea({ ...hojaTarea, modo: "hecha" });
                  }}
                >
                  ✅ Ya está hecha: apuntar el parte
                </Boton>
              )}
              {puedePlanificar && (
                <Boton
                  variante="secundario"
                  onClick={() => {
                    setMaterias(hojaTarea.tarea.datos?.materias || []);
                    setUfs(hojaTarea.tarea.datos?.ufs || {});
                    setHojaTarea({ ...hojaTarea, modo: "editar" });
                  }}
                >
                  ✏️ Cambiar o mover de día
                </Boton>
              )}
              {puedePlanificar && (
                <Boton variante="peligro" onClick={() => cancelarTarea(hojaTarea.tarea)}>
                  Quitar tarea
                </Boton>
              )}
            </div>
          </DetalleTarea>
        )}
        {(hojaTarea?.modo === "nueva" || hojaTarea?.modo === "editar") && (
          <>
            {rol === "tecnico" && (
              <p className="mb-3 rounded-2xl bg-tierra-50 p-3 text-[15px] text-tierra-800">
                🧑‍🌾 La tarea le aparecerá al agricultor en su calendario y en Inicio. Él decide quién de su equipo la hace.
              </p>
            )}
            {hojaTarea.modo === "nueva" && (
              <div className="mb-4 rounded-2xl bg-olivo-50 p-3">
                <p className="mb-2 text-sm font-bold text-olivo-900">¿Se repite?</p>
                <div className="flex flex-wrap gap-2">
                  {[["", "No"], ["semana", "Cada semana"], ["2semanas", "Cada 2 semanas"], ["mes", "Cada mes"]].map(([k, t]) => (
                    <button key={k} type="button" onClick={() => setRepetir({ ...repetir, cada: k })} className={`rounded-full px-3 py-1.5 text-sm font-bold ${repetir.cada === k ? "bg-olivo-700 text-white" : "bg-white text-stone-700"}`}>
                      {t}
                    </button>
                  ))}
                </div>
                {repetir.cada && (
                  <label className="mt-2 flex items-center gap-2 text-[15px]">
                    Número de veces:
                    <input type="number" min="2" max="52" value={repetir.veces} onChange={(e) => setRepetir({ ...repetir, veces: e.target.value })} className="h-10 w-20 rounded-xl border border-stone-300 px-2" />
                  </label>
                )}
              </div>
            )}
            <ParteEditor
              key={hojaTarea.modo + (hojaTarea.tarea.id || "")}
              modo="completo"
              inicial={inicialDeTarea(hojaTarea.tarea)}
              planificar
              soloMaterias={rol === "tecnico" || !!hojaTarea.tarea.datos?.materias?.length || !!hojaTarea.tarea.datos?.ufs}
              materias={materias}
              onMaterias={setMaterias}
              ufs={ufs}
              onUfs={setUfs}
              textoGuardar={hojaTarea.modo === "editar" ? "Guardar cambios" : "📌 Guardar en el calendario"}
              guardando={guardando}
              onGuardar={guardarTarea}
            />
          </>
        )}
        {hojaTarea?.modo === "hecha" && (
          <>
            <p className="mb-3 rounded-2xl bg-olivo-50 p-3 text-[15px] text-olivo-900">Revisa lo que se hizo de verdad (fecha, horas, dosis…) y guarda. Se creará el parte y la tarea quedará hecha.</p>
            {(hojaTarea.tarea.datos?.materias?.length > 0 || hojaTarea.tarea.datos?.ufs) && (
              <ElegirComercial
                t={hojaTarea.tarea}
                autor={autorDe(hojaTarea.tarea)}
                productos={productos}
                codigos={[...new Set(recintos.filter((r) => hojaTarea.tarea.recinto_ids?.includes(r.id)).map((r) => cultivos.find((c) => c.id === r.cultivo_id)?.codigo_mapa).filter(Boolean))]}
                elegidos={prodsHecha}
                onElegir={(p) => setProdsHecha(prodsHecha.some((x) => x.producto_id === p.id) ? prodsHecha.filter((x) => x.producto_id !== p.id) : [...prodsHecha, { producto_id: p.id, dosis_ha: p.dosis_habitual_ha ?? "", unidad_dosis: `${p.unidad || "kg"}/ha` }])}
              />
            )}
            <ParteEditor
              key={"hecha" + hojaTarea.tarea.id + prodsHecha.map((x) => x.producto_id).join(",")}
              modo="completo"
              inicial={inicialHecha(hojaTarea.tarea, hojaTarea.tarea.fecha < hoy ? hojaTarea.tarea.fecha : hoy)}
              textoGuardar="✅ Guardar parte"
              guardando={guardando}
              onGuardar={marcarHecha}
            />
          </>
        )}
      </Hoja>
    </Pagina>
  );
}

const normal = (x) => (x || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
const normReg = (x) => (x || "").replace(/[^0-9]/g, "").replace(/^0+/, "");

function ElegirComercial({ t, autor, productos, codigos, elegidos, onElegir }) {
  const ms = t.datos?.materias || [];
  const [registro, setRegistro] = useState({}); // materia -> productos del Registro
  const [abierto, setAbierto] = useState(null);
  useEffect(() => {
    if (!codigos.length) return;
    ms.forEach(async (m) => {
      const { data } = await supabase.rpc("fito_productos_materia", { p_materia: m.materia, p_codigos: codigos, p_agente: m.agente || null });
      setRegistro((r) => ({ ...r, [m.materia]: data || [] }));
    });
  }, [t.id, codigos.join(",")]); // eslint-disable-line

  return (
    <div className="mb-4 rounded-2xl border-2 border-tierra-200 bg-tierra-50 p-3">
      <p className="text-sm font-bold text-tierra-800">{autor?.rol === "tecnico" ? `🧑‍🌾 Recomendación de ${autor.nombre || "tu técnico"}` : "📌 Recomendación"}</p>
      <p className="text-xs text-tierra-700">Elige primero el producto comercial que has usado; después revisa la dosis y las horas abajo.</p>
      {t.datos?.ufs && (
        <p className="mt-1 text-[15px] text-stone-800">
          🌾 {[["n", "N"], ["p", "P₂O₅"], ["k", "K₂O"]].filter(([k]) => t.datos.ufs[k]).map(([k, n]) => `${n} ${t.datos.ufs[k]} kg/ha`).join(" · ")}. Elige abajo el abono que has usado.
        </p>
      )}
      {ms.map((m) => {
        const reg = registro[m.materia];
        const regs = new Set((reg || []).map((x) => normReg(x.registro)));
        const mios = productos.filter((p) => (p.numero_registro && regs.has(normReg(p.numero_registro))) || normal(p.materia_activa).includes(m.materia));
        return (
          <div key={m.materia} className="mt-2 rounded-xl bg-white p-2.5">
            <p className="font-extrabold text-olivo-900">🧪 {m.materia}</p>
            {m.agente && <p className="text-sm text-stone-700">Para: {m.agente}</p>}
            {m.nota && <p className="text-sm text-stone-600">📝 {m.nota}</p>}
            <p className="mb-1 mt-2 text-xs font-bold uppercase text-stone-500">Tus productos con esta materia activa</p>
            {mios.length ? (
              <div className="flex flex-wrap gap-2">
                {mios.map((p) => {
                  const sel = elegidos.some((x) => x.producto_id === p.id);
                  return (
                    <button key={p.id} type="button" onClick={() => onElegir(p)} className={`rounded-full px-3 py-1.5 text-sm font-bold ${sel ? "bg-olivo-700 text-white" : "bg-olivo-50 text-olivo-800"}`}>
                      {sel ? "✓ " : "+ "}
                      {p.nombre}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-stone-600">No tienes ninguno dado de alta. Mira abajo cuáles puedes comprar.</p>
            )}
            <button type="button" onClick={() => setAbierto(abierto === m.materia ? null : m.materia)} className="mt-2 text-sm font-bold text-tierra-700">
              {abierto === m.materia ? "▾" : "▸"} Productos autorizados del Registro ({reg ? reg.length : "…"})
            </button>
            {abierto === m.materia && (
              <div className="mt-1 max-h-60 space-y-1 overflow-y-auto">
                {(reg || []).map((x) => (
                  <div key={x.registro} className="rounded-lg bg-stone-50 px-2 py-1.5 text-sm">
                    <b>{x.producto}</b> <span className="text-stone-500">· nº {x.registro}</span>
                    <span className="block text-xs text-stone-600">
                      {x.formulado}
                      {x.dosis_max ? ` · dosis ${x.dosis_min ?? ""}–${x.dosis_max} ${x.unidad || ""}` : ""}
                      {x.plazo_dias != null ? ` · plazo ${x.plazo_dias} días` : ""}
                    </span>
                  </div>
                ))}
                {reg && !reg.length && <p className="text-sm text-stone-500">Ninguno autorizado para este cultivo y plaga.</p>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function mismoDiaMes(s, n) {
  const d = aFecha(s);
  const dia = d.getDate();
  const x = new Date(d.getFullYear(), d.getMonth() + n, 1, 12);
  const ultimo = new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate();
  x.setDate(Math.min(dia, ultimo));
  return aISO(x);
}

function TarjetaTarea({ t, hoy, compacta, conFecha, autor, nomLabor, nomTrab, recintos, onClick }) {
  const rs = recintos.filter((r) => t.recinto_ids?.includes(r.id));
  const atrasada = t.fecha < hoy;
  const col = colorDe(t.labor_id);
  return (
    <button type="button" onClick={onClick} className="flex w-full overflow-hidden rounded-2xl border-2 border-dashed bg-white text-left active:bg-stone-50" style={{ borderColor: col + "88" }}>
      <span className={`flex-1 ${compacta ? "p-2.5" : "p-3"}`}>
        <span className="flex items-start justify-between gap-2">
          <span className={`${compacta ? "text-[15px]" : "text-lg"} font-extrabold text-olivo-900`}>
            📌 {nomLabor(t.labor_id)}
            {t.hora ? <span className="ml-1 text-sm font-normal text-stone-500">{t.hora.slice(0, 5)}</span> : null}
          </span>
          <Etiqueta color={atrasada ? "rojo" : "gris"}>{atrasada ? "Sin hacer" : "Planificada"}</Etiqueta>
        </span>
        {conFecha && <span className="block text-sm font-bold text-red-700">{fechaLarga(t.fecha)}</span>}
        <span className="block text-[15px] text-stone-700">{rs.map((r) => nombreRecinto(r, r.n_en_parcela)).join(", ") || "Sin parcela"}</span>
        <span className="mt-0.5 block text-sm text-stone-500">
          {[
            t.datos?.horas ? `${num(t.datos.horas, 1)} h previstas` : null,
            t.trabajador_ids?.length ? `👤 ${t.trabajador_ids.map(nomTrab).join(", ")}` : "Sin asignar",
            t.datos?.aplicacion?.productos?.length ? "🧴" : null,
            t.grupo_id ? "🔁" : null,
            autor?.rol === "tecnico" ? `🧑‍🌾 ${autor.nombre || "Técnico"}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </span>
    </button>
  );
}

function DetalleTarea({ t, hoy, autor, nomTrab, recintos, maquinaria, aperos, productos, children }) {
  const rs = recintos.filter((r) => t.recinto_ids?.includes(r.id));
  const ms = maquinaria.filter((m) => t.datos?.maquinaria_ids?.includes(m.id));
  const as = aperos.filter((a) => t.datos?.apero_ids?.includes(a.id));
  const ap = t.datos?.aplicacion;
  const rg = t.datos?.riego;
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-2">
        <Etiqueta color={t.fecha < hoy ? "rojo" : "gris"}>{t.fecha < hoy ? "Sin hacer" : "Planificada"}</Etiqueta>
        {t.grupo_id && <Etiqueta color="gris">🔁 Se repite</Etiqueta>}
        {autor?.rol === "tecnico" && <Etiqueta color="tierra">🧑‍🌾 Del técnico</Etiqueta>}
      </div>
      <Fila k="Planificada por">{autor ? `${autor.nombre || "—"}${autor.rol === "tecnico" ? " (técnico/asesor)" : ""}` : null}</Fila>
      <Fila k="Para el día">
        {fechaLarga(t.fecha)}
        {t.hora ? ` · ${t.hora.slice(0, 5)}` : ""}
      </Fila>
      <Fila k="Horas previstas">{t.datos?.horas ? `${num(t.datos.horas, 2)} h` : null}</Fila>
      <Fila k="Parcelas">{rs.length ? rs.map((r) => <p key={r.id}>{nombreRecinto(r, r.n_en_parcela)}</p>) : null}</Fila>
      <Fila k="Quién">{t.trabajador_ids?.length ? t.trabajador_ids.map(nomTrab).join(", ") : "Sin asignar"}</Fila>
      <Fila k="Maquinaria">{ms.length ? ms.map((m) => m.nombre).join(", ") : null}</Fila>
      <Fila k="Aperos">{as.length ? as.map((a) => a.nombre).join(", ") : null}</Fila>
      {t.datos?.materias?.length > 0 && (
        <Fila k="🧪 Materias activas recomendadas">
          {t.datos.materias.map((m, i) => (
            <div key={i} className="mb-1">
              <p className="font-bold">{m.materia}</p>
              {m.agente && <p className="text-sm">Para: {m.agente}{m.cultivo ? ` (${m.cultivo})` : ""}</p>}
              {m.plazo_max != null && <p className="text-xs text-stone-500">Plazo de seguridad según producto: hasta {m.plazo_max} días</p>}
              {m.nota && <p className="text-sm text-stone-600">📝 {m.nota}</p>}
            </div>
          ))}
        </Fila>
      )}
      {t.datos?.ufs && (
        <Fila k="🌾 Unidades fertilizantes recomendadas">
          {[["n", "N"], ["p", "P₂O₅"], ["k", "K₂O"]].filter(([k]) => t.datos.ufs[k]).map(([k, n]) => `${n} ${t.datos.ufs[k]} kg/ha`).join(" · ") || "—"}
        </Fila>
      )}
      {ap?.productos?.length > 0 && (
        <Fila k="Productos previstos">
          {ap.plaga_o_motivo && <p>Motivo: {ap.plaga_o_motivo}</p>}
          {ap.productos.map((x, i) => (
            <p key={i} className="font-semibold">
              🧴 {productos.find((pr) => pr.id === x.producto_id)?.nombre || "Producto"} · {num(x.dosis_ha, 3)} {x.unidad_dosis || ""}
            </p>
          ))}
        </Fila>
      )}
      {rg && (
        <Fila k="Riego previsto">
          {rg.m3_ha != null ? `${num(rg.m3_ha, 1)} m³/ha` : ""}
          {rg.volumen_m3 != null ? `${num(rg.volumen_m3, 1)} m³ en total` : ""}
          {rg.sistema ? ` · ${rg.sistema}` : ""}
        </Fila>
      )}
      <Fila k="Notas">{t.notas || null}</Fila>
      {children}
    </div>
  );
}

function VistaMes({ ref_, desde, hasta, hoy, porDia, tareasPorDia, nomLabor, horasDe, onDia }) {
  const dias = [];
  for (let f = desde; f <= hasta; f = sumar(f, 1)) dias.push(f);
  const mes = ref_.slice(0, 7);
  return (
    <div className="rounded-2xl bg-white p-2 shadow-sm">
      <div className="mb-1 grid grid-cols-7 text-center text-xs font-bold text-stone-500">
        {DIAS.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {dias.map((f) => {
          const lista = porDia[f] || [];
          const plan = tareasPorDia[f] || [];
          const visibles = [...lista.map((p) => ({ p })), ...plan.map((t) => ({ t }))];
          const fuera = f.slice(0, 7) !== mes;
          const h = lista.reduce((s, p) => s + horasDe(p), 0);
          return (
            <button
              key={f}
              type="button"
              onClick={() => onDia(f)}
              className={`flex min-h-[4.5rem] flex-col items-stretch rounded-lg p-1 text-left ${f === hoy ? "ring-2 ring-olivo-600" : ""} ${
                lista.length ? "bg-olivo-50 active:bg-olivo-100" : plan.length ? "bg-white active:bg-stone-50" : "active:bg-stone-50"
              } ${fuera ? "opacity-40" : ""}`}
            >
              <span className={`text-sm font-bold ${f === hoy ? "text-olivo-700" : "text-stone-700"}`}>{Number(f.slice(8))}</span>
              {visibles.slice(0, 2).map(({ p, t }) =>
                p ? (
                  <span key={p.id} className="mt-0.5 truncate rounded px-0.5 text-[10px] font-bold leading-tight text-white" style={{ background: colorDe(p.labor_id) }}>
                    {nomLabor(p.labor_id)}
                  </span>
                ) : (
                  <span key={t.id} className="mt-0.5 truncate rounded border border-dashed bg-white px-0.5 text-[10px] font-bold leading-tight" style={{ borderColor: colorDe(t.labor_id), color: f < hoy ? "#b91c1c" : colorDe(t.labor_id) }}>
                    📌{nomLabor(t.labor_id)}
                  </span>
                )
              )}
              {visibles.length > 2 && <span className="text-[10px] font-bold text-stone-500">+{visibles.length - 2} más</span>}
              {h > 0 && <span className="mt-auto text-right text-[10px] text-stone-500">{num(h, 1)} h</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TarjetaParte({ p, compacta, nomLabor, nomTrab, recintos, horasDe, onClick }) {
  const rs = recintos.filter((r) => p.partes_trabajo_recintos?.some((x) => x.recinto_id === r.id));
  const [et, col] = ESTADOS[p.estado] || [p.estado, "gris"];
  const h = horasDe(p);
  return (
    <button type="button" onClick={onClick} className="flex w-full overflow-hidden rounded-2xl bg-white text-left shadow-sm active:bg-stone-50">
      <span className="w-1.5 shrink-0" style={{ background: colorDe(p.labor_id) }} />
      <span className={`flex-1 ${compacta ? "p-2.5" : "p-3"}`}>
        <span className="flex items-start justify-between gap-2">
          <span className={`${compacta ? "text-[15px]" : "text-lg"} font-extrabold text-olivo-900`}>
            {nomLabor(p.labor_id)}
            {p.inicio ? <span className="ml-1 text-sm font-normal text-stone-500">{hora(p.inicio)}</span> : null}
          </span>
          <Etiqueta color={col}>{et}</Etiqueta>
        </span>
        <span className="block text-[15px] text-stone-700">{rs.map((r) => nombreRecinto(r, r.n_en_parcela)).join(", ") || "Sin parcela"}</span>
        <span className="mt-0.5 block text-sm text-stone-500">
          {h ? `${num(h, 1)} h` : ""}
          {p.partes_trabajo_trabajadores?.length ? ` · 👤 ${p.partes_trabajo_trabajadores.map((x) => nomTrab(x.trabajador_id)).join(", ")}` : ""}
          {p.aplicaciones?.[0]?.aplicaciones_productos?.length ? " · 🧴" : ""}
          {p.riegos_parte?.length ? " · 💧" : ""}
          {p.origen === "voz" || p.origen === "ia" ? " · 🎤" : ""}
        </span>
      </span>
    </button>
  );
}

function Fila({ k, children }) {
  if (children == null || children === "" || (Array.isArray(children) && !children.length)) return null;
  return (
    <div className="border-b border-stone-100 py-2">
      <p className="text-xs font-bold uppercase text-stone-500">{k}</p>
      <div className="text-[15px] text-stone-800">{children}</div>
    </div>
  );
}

function Detalle({ p, nomTrab, recintos, maquinaria, aperos, productos, children }) {
  const rs = recintos.filter((r) => p.partes_trabajo_recintos?.some((x) => x.recinto_id === r.id));
  const ms = maquinaria.filter((m) => p.partes_trabajo_maquinaria?.some((x) => x.maquinaria_id === m.id));
  const as = aperos.filter((a) => p.partes_trabajo_aperos?.some((x) => x.apero_id === a.id));
  const ap = p.aplicaciones?.[0];
  const rg = p.riegos_parte?.[0];
  const [et, col] = ESTADOS[p.estado] || [p.estado, "gris"];
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Etiqueta color={col}>{et}</Etiqueta>
        {(p.origen === "voz" || p.origen === "ia") && <Etiqueta color="gris">🎤 Por voz</Etiqueta>}
        {p.tipo_trabajo === "terceros" && <Etiqueta color="tierra">Para terceros</Etiqueta>}
      </div>
      <Fila k="Fecha">
        {fechaLarga(p.fecha)}
        {p.inicio ? ` · ${hora(p.inicio)}${p.fin ? `–${hora(p.fin)}` : ""}` : ""}
      </Fila>
      <Fila k="Horas totales">{p.horas_totales != null ? `${num(p.horas_totales, 2)} h` : null}</Fila>
      <Fila k="Parcelas">
        {rs.length
          ? rs.map((r) => (
              <p key={r.id}>
                {nombreRecinto(r, r.n_en_parcela)}
                {(r.superficie_sigpac_ha ?? r.superficie_ha) ? <span className="text-stone-500"> · {num(r.superficie_sigpac_ha ?? r.superficie_ha, 2)} ha</span> : null}
              </p>
            ))
          : null}
      </Fila>
      <Fila k="Trabajadores">
        {p.partes_trabajo_trabajadores?.length
          ? p.partes_trabajo_trabajadores.map((t) => (
              <p key={t.trabajador_id}>
                {nomTrab(t.trabajador_id)}
                {t.horas != null ? <span className="text-stone-500"> · {num(t.horas, 2)} h</span> : null}
              </p>
            ))
          : null}
      </Fila>
      <Fila k="Maquinaria">{ms.length ? ms.map((m) => m.nombre).join(", ") : null}</Fila>
      <Fila k="Aperos">{as.length ? as.map((a) => a.nombre).join(", ") : null}</Fila>
      {ap && (
        <Fila k={ap.tipo === "fertilizacion" ? "Abonado" : "Tratamiento"}>
          {ap.plaga_o_motivo && <p>Motivo: {ap.plaga_o_motivo}</p>}
          {ap.metodo_aplicacion && <p>Método: {ap.metodo_aplicacion}</p>}
          {ap.volumen_caldo_l_ha && <p>Caldo: {num(ap.volumen_caldo_l_ha, 0)} l/ha</p>}
          {(ap.aplicaciones_productos || []).map((x, i) => (
            <p key={i} className="font-semibold">
              🧴 {productos.find((pr) => pr.id === x.producto_id)?.nombre || "Producto"} · {num(x.dosis_ha, 3)} {x.unidad_dosis || ""}
              {x.cantidad_total != null ? <span className="font-normal text-stone-500"> (total {num(x.cantidad_total, 2)})</span> : null}
            </p>
          ))}
          {ap.justificacion && <p className="text-stone-500">Justificación: {ap.justificacion}</p>}
        </Fila>
      )}
      {rg && (
        <Fila k="Riego">
          {rg.m3_ha != null ? `${num(rg.m3_ha, 1)} m³/ha` : ""}
          {rg.volumen_m3 != null ? ` · ${num(rg.volumen_m3, 1)} m³ en total` : ""}
          {rg.sistema ? ` · ${rg.sistema}` : ""}
          {rg.fertirrigacion ? " · con fertirrigación" : ""}
        </Fila>
      )}
      {p.tipo_trabajo === "terceros" && <Fila k="Precio a terceros">{p.precio_terceros != null ? euros(p.precio_terceros) : null}</Fila>}
      <Fila k="Observaciones">{p.observaciones || null}</Fila>
      {children}
    </div>
  );
}
