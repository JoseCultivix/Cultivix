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
  const { empresaId, esGestor, labores, recintos, trabajadores, maquinaria, aperos, productos, notificar } = useApp();
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
    <Pagina titulo="Calendario" subtitulo="Qué se ha hecho cada día, quién y dónde" volver="/mas">
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
          {vista === "mes" && <VistaMes ref_={ref} desde={desde} hasta={hasta} hoy={hoy} porDia={porDia} nomLabor={nomLabor} horasDe={horasDe} onDia={abrirDia} />}
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
                  {porDia[f]?.length ? (
                    <div className="space-y-1.5">
                      {porDia[f].map((p) => (
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
            (porDia[ref]?.length ? (
              <div className="space-y-2">
                {porDia[ref].map((p) => (
                  <TarjetaParte key={p.id} p={p} {...{ nomLabor, nomTrab, recintos, horasDe }} onClick={() => setDetalle(p)} />
                ))}
              </div>
            ) : (
              <Vacio icono="📅" titulo="Sin trabajos este día" texto={filtroTrab !== "todos" || filtroLabor || filtroRecinto ? "Prueba a quitar los filtros." : "No hay partes registrados."}>
                <Boton href="/trabajo">Registrar trabajo</Boton>
              </Vacio>
            ))}

          {/* Resumen */}
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
    </Pagina>
  );
}

function VistaMes({ ref_, desde, hasta, hoy, porDia, nomLabor, horasDe, onDia }) {
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
          const fuera = f.slice(0, 7) !== mes;
          const h = lista.reduce((s, p) => s + horasDe(p), 0);
          return (
            <button
              key={f}
              type="button"
              onClick={() => onDia(f)}
              className={`flex min-h-[4.5rem] flex-col items-stretch rounded-lg p-1 text-left ${f === hoy ? "ring-2 ring-olivo-600" : ""} ${
                lista.length ? "bg-olivo-50 active:bg-olivo-100" : "active:bg-stone-50"
              } ${fuera ? "opacity-40" : ""}`}
            >
              <span className={`text-sm font-bold ${f === hoy ? "text-olivo-700" : "text-stone-700"}`}>{Number(f.slice(8))}</span>
              {lista.slice(0, 2).map((p) => (
                <span key={p.id} className="mt-0.5 truncate rounded px-0.5 text-[10px] font-bold leading-tight text-white" style={{ background: colorDe(p.labor_id) }}>
                  {nomLabor(p.labor_id)}
                </span>
              ))}
              {lista.length > 2 && <span className="text-[10px] font-bold text-stone-500">+{lista.length - 2} más</span>}
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
