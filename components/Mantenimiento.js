"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useApp } from "@/components/AppProvider";
import { Boton, BotonEliminar, Campo, Cargando, Etiqueta, Input, Select, Tarjeta, claseInput } from "@/components/ui";
import { categoria } from "@/lib/compras";
import { euros, fechaCorta, num } from "@/lib/formato";
import { eliminarRegistro } from "@/lib/eliminar";

export const TIPOS_MANT = [
  { v: "averia", t: "Avería", icono: "🔴" },
  { v: "aceite", t: "Aceite y filtros", icono: "🛢️" },
  { v: "revision", t: "Revisión", icono: "🔍" },
  { v: "reparacion", t: "Reparación", icono: "🔧" },
  { v: "neumaticos", t: "Neumáticos", icono: "🛞" },
  { v: "otro", t: "Otro", icono: "📝" },
];
export const tipoMant = (v) => TIPOS_MANT.find((x) => x.v === v) || TIPOS_MANT[5];
const CATS_GASTO = ["repuesto", "reparacion", "material", "gasoil", "servicio", "otro"];
const n = (x) => (x === "" || x == null ? null : Number(String(x).replace(",", ".")));
const hoy = () => new Date().toISOString().slice(0, 10);

/** Historial de mantenimiento de una máquina o apero: averías, aceite, revisiones, reparaciones… con su gasto. */
export function HistorialEquipo({ equipo, de, onCambio }) {
  const { empresaId, esGestor, trabajadores } = useApp();
  const [lista, setLista] = useState(null);
  const [horas, setHoras] = useState(null);
  const [form, setForm] = useState(null); // { registro?, tipo }
  const col = de === "maquina" ? "maquinaria_id" : "apero_id";

  async function cargar() {
    const [{ data }, h] = await Promise.all([
      supabase
        .from("mantenimientos")
        .select("*, proveedores(nombre), trabajadores(nombre, coste_hora), albaranes_compra_lineas(id, descripcion, importe, categoria, albaran_id, albaranes_compra(fecha, numero, tipo_documento, proveedores(nombre)))")
        .eq(col, equipo.id)
        .order("fecha", { ascending: false })
        .order("created_at", { ascending: false }),
      de === "maquina" ? supabase.from("v_horas_equipo").select("*").eq("maquinaria_id", equipo.id).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    setLista(data || []);
    setHoras(h.data);
  }
  useEffect(() => {
    cargar();
  }, [equipo.id]); // eslint-disable-line

  if (form)
    return (
      <FormMantenimiento
        equipo={equipo}
        de={de}
        registro={form.registro}
        tipoInicial={form.tipo}
        onCancelar={() => setForm(null)}
        onHecho={async () => {
          setForm(null);
          await cargar();
          onCambio?.();
        }}
      />
    );
  if (!lista) return <Cargando />;

  const coste = (m) => (m.albaranes_compra_lineas || []).reduce((s, l) => s + (+l.importe || 0), 0) + (m.donde === "propios" ? (+m.horas_mano_obra || 0) * (+m.trabajadores?.coste_hora || 0) : 0);
  const anio = String(new Date().getFullYear());
  const gastoAnio = lista.filter((m) => m.fecha?.startsWith(anio)).reduce((s, m) => s + coste(m), 0);
  const pendientes = lista.filter((m) => m.estado === "pendiente").length;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {de === "maquina" && (
          <Tarjeta className="!p-3">
            <p className="text-xs font-bold uppercase text-stone-500">Horas de uso</p>
            <p className="text-xl font-black text-olivo-900">{horas?.horas_estimadas != null ? `${num(horas.horas_estimadas, 0)} h` : "—"}</p>
            <p className="text-xs text-stone-500">{horas?.ultima_lectura != null ? `Horómetro ${num(horas.ultima_lectura, 0)} h el ${fechaCorta(horas.fecha_lectura)} + partes` : "Apunta las horas del motor en un mantenimiento"}</p>
          </Tarjeta>
        )}
        {esGestor && (
          <Tarjeta className="!p-3">
            <p className="text-xs font-bold uppercase text-stone-500">Gasto en {anio}</p>
            <p className="text-xl font-black text-olivo-900">{euros(gastoAnio)}</p>
            <p className="text-xs text-stone-500">{pendientes ? `${pendientes} avería(s) sin reparar` : "Sin averías pendientes"}</p>
          </Tarjeta>
        )}
      </div>

      <p className="text-sm font-bold text-stone-700">Registrar</p>
      <div className="grid grid-cols-3 gap-1.5">
        {(esGestor ? TIPOS_MANT : TIPOS_MANT.filter((x) => x.v === "averia")).map((x) => (
          <button key={x.v} type="button" onClick={() => setForm({ tipo: x.v })} className="rounded-xl bg-white px-2 py-2.5 text-sm font-bold text-olivo-800 shadow-sm active:bg-olivo-50">
            <span className="block text-xl">{x.icono}</span>
            {x.t}
          </button>
        ))}
      </div>

      <p className="pt-1 text-sm font-bold text-stone-700">Historial</p>
      {!lista.length && <p className="text-stone-500">Todavía no hay nada apuntado.</p>}
      {lista.map((m) => {
        const t = tipoMant(m.tipo);
        const c = coste(m);
        return (
          <button key={m.id} type="button" disabled={!esGestor} onClick={() => setForm({ registro: m })} className="block w-full rounded-2xl bg-white p-3 text-left shadow-sm active:bg-stone-50">
            <span className="flex items-start justify-between gap-2">
              <span className="font-extrabold text-olivo-900">
                {t.icono} {t.t}
                <span className="ml-1 text-sm font-normal text-stone-500">{fechaCorta(m.fecha)}</span>
              </span>
              {m.estado === "pendiente" ? <Etiqueta color="rojo">Sin reparar</Etiqueta> : esGestor && c > 0 ? <b>{euros(c)}</b> : null}
            </span>
            {m.descripcion && <span className="block text-[15px] text-stone-700">{m.descripcion}</span>}
            <span className="block text-sm text-stone-500">
              {[
                m.donde === "taller" ? `Taller${m.proveedores?.nombre ? `: ${m.proveedores.nombre}` : ""}` : `Medios propios${m.trabajadores?.nombre ? `: ${m.trabajadores.nombre}` : ""}${m.horas_mano_obra ? ` (${num(m.horas_mano_obra, 1)} h)` : ""}`,
                m.horas_motor != null ? `${num(m.horas_motor, 0)} h motor` : null,
                m.albaranes_compra_lineas?.length ? `🧾 ${m.albaranes_compra_lineas.length} gasto(s)` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
            {(m.proximo_mantenimiento || m.proximo_horas) && (
              <span className="block text-sm font-semibold text-tierra-700">
                Próximo: {[m.proximo_mantenimiento && fechaCorta(m.proximo_mantenimiento), m.proximo_horas && `a las ${num(m.proximo_horas, 0)} h`].filter(Boolean).join(" o ")}
              </span>
            )}
          </button>
        );
      })}
      {!esGestor && <p className="text-xs text-stone-500">Puedes avisar de una avería; el encargado registra las reparaciones y su gasto.</p>}
    </div>
  );
}

/** Alta o edición de un mantenimiento/reparación con su gasto. */
function FormMantenimiento({ equipo, de, registro, tipoInicial, onHecho, onCancelar }) {
  const { empresaId, esGestor, trabajadores, notificar } = useApp();
  const r = registro || {};
  const [f, setF] = useState({
    tipo: r.tipo || tipoInicial || "averia",
    estado: r.estado || (tipoInicial === "averia" || (!registro && !tipoInicial) ? "pendiente" : "hecho"),
    fecha: r.fecha || hoy(),
    fecha_fin: r.fecha_fin || "",
    descripcion: r.descripcion || "",
    observaciones: r.observaciones || "",
    donde: r.donde || "propios",
    taller: r.proveedores?.nombre || "",
    trabajador_id: r.trabajador_id || "",
    horas_mano_obra: r.horas_mano_obra ?? "",
    horas_motor: r.horas_motor ?? "",
    proximo_mantenimiento: r.proximo_mantenimiento || "",
    proximo_horas: r.proximo_horas ?? "",
  });
  const [enlazadas, setEnlazadas] = useState(r.albaranes_compra_lineas || []);
  const [quitar, setQuitar] = useState([]);
  const [candidatas, setCandidatas] = useState(null);
  const [elegidas, setElegidas] = useState([]);
  const [compra, setCompra] = useState(null); // gasto nuevo
  const [proveedores, setProveedores] = useState([]);
  const [guardando, setGuardando] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    if (!esGestor) return;
    supabase
      .from("proveedores")
      .select("id, nombre")
      .eq("empresa_id", empresaId)
      .order("nombre")
      .then(({ data }) => setProveedores(data || []));
  }, [empresaId, esGestor]);

  async function verCandidatas() {
    const desde = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
    const { data } = await supabase
      .from("albaranes_compra_lineas")
      .select("id, descripcion, importe, categoria, albaranes_compra!inner(fecha, numero, tipo_documento, empresa_id, proveedores(nombre))")
      .eq("albaranes_compra.empresa_id", empresaId)
      .gte("albaranes_compra.fecha", desde)
      .is("mantenimiento_id", null)
      .in("categoria", CATS_GASTO)
      .order("albaran_id", { ascending: false })
      .limit(80);
    setCandidatas((data || []).sort((a, b) => (b.albaranes_compra.fecha || "").localeCompare(a.albaranes_compra.fecha || "")));
  }

  async function guardar() {
    // Un trabajador solo avisa de averías (sin gasto)
    if (!esGestor) {
      const { error } = await supabase.from("mantenimientos").insert({ empresa_id: empresaId, [de === "maquina" ? "maquinaria_id" : "apero_id"]: equipo.id, tipo: "averia", estado: "pendiente", fecha: f.fecha, descripcion: f.descripcion, observaciones: f.observaciones || null });
      if (error) return notificar(error.message, "error");
      notificar("Avería avisada. El encargado la verá en Inicio ✓");
      return onHecho();
    }
    setGuardando(true);
    try {
      const lineasCompra = (compra?.lineas || []).filter((l) => n(l.importe) != null || l.descripcion);
      const payload = {
        id: registro?.id || null,
        empresa_id: empresaId,
        maquinaria_id: de === "maquina" ? equipo.id : null,
        apero_id: de === "apero" ? equipo.id : null,
        ...f,
        trabajador_id: f.donde === "propios" ? f.trabajador_id || null : null,
        horas_mano_obra: f.donde === "propios" ? n(f.horas_mano_obra) : null,
        horas_motor: n(f.horas_motor),
        proximo_horas: n(f.proximo_horas),
        fecha_fin: f.estado === "hecho" ? f.fecha_fin || null : null,
        lineas_enlazar: elegidas,
        lineas_quitar: quitar,
        compra: lineasCompra.length
          ? {
              tipo_documento: compra.tipo_documento,
              proveedor_nombre: compra.proveedor_nombre || (f.donde === "taller" ? f.taller : null),
              numero: compra.numero || null,
              fecha: compra.fecha || f.fecha,
              total: n(compra.total),
              con_factura: compra.tipo_documento === "factura" ? true : !!compra.con_factura,
              lineas: lineasCompra.map((l) => ({ categoria: l.categoria, descripcion: l.descripcion || categoria(l.categoria).t, importe: n(l.importe), cantidad: n(l.cantidad), unidad: l.unidad || null })),
            }
          : null,
      };
      const { error } = await supabase.rpc("guardar_mantenimiento", { payload });
      if (error) throw error;
      notificar(lineasCompra.length ? "Guardado. La compra se ha creado y queda imputada a este equipo ✓" : "Guardado ✓");
      onHecho();
    } catch (e) {
      notificar(e.message, "error");
    } finally {
      setGuardando(false);
    }
  }

  const t = tipoMant(f.tipo);
  return (
    <div className="space-y-3">
      <button type="button" onClick={onCancelar} className="text-sm font-bold text-olivo-700">
        ‹ Volver al historial
      </button>
      {esGestor && (
        <div className="grid grid-cols-3 gap-1.5">
          {TIPOS_MANT.map((x) => (
            <button key={x.v} type="button" onClick={() => set("tipo", x.v)} className={`rounded-xl px-2 py-2 text-sm font-bold ${f.tipo === x.v ? "bg-olivo-700 text-white" : "bg-white text-stone-700"}`}>
              {x.icono} {x.t}
            </button>
          ))}
        </div>
      )}
      {esGestor && (
        <div className="grid grid-cols-2 gap-1 rounded-2xl bg-stone-200/70 p-1 font-bold">
          {[["pendiente", "⏳ Pendiente"], ["hecho", "✅ Hecho"]].map(([k, tx]) => (
            <button key={k} type="button" onClick={() => set("estado", k)} className={`rounded-xl py-2 ${f.estado === k ? "bg-white text-olivo-800 shadow" : "text-stone-600"}`}>
              {tx}
            </button>
          ))}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Campo etiqueta={f.tipo === "averia" ? "Fecha de la avería" : "Fecha"}>
          <Input type="date" value={f.fecha} onChange={(e) => set("fecha", e.target.value)} />
        </Campo>
        {esGestor && f.tipo === "averia" && f.estado === "hecho" ? (
          <Campo etiqueta="Fecha de la reparación">
            <Input type="date" value={f.fecha_fin} onChange={(e) => set("fecha_fin", e.target.value)} />
          </Campo>
        ) : de === "maquina" && esGestor ? (
          <Campo etiqueta="Horas del motor">
            <Input inputMode="decimal" value={f.horas_motor} placeholder="Horómetro" onChange={(e) => set("horas_motor", e.target.value)} />
          </Campo>
        ) : (
          <span />
        )}
      </div>
      <Campo etiqueta={f.tipo === "averia" ? "¿Qué le pasa?" : "Qué se ha hecho"}>
        <Input
          value={f.descripcion}
          placeholder={{ averia: "Pierde aceite por el hidráulico", aceite: "Cambio de aceite motor y filtros", revision: "Revisión de las 500 h", reparacion: "Cambio de embrague", neumaticos: "2 ruedas traseras nuevas", otro: "" }[f.tipo]}
          onChange={(e) => set("descripcion", e.target.value)}
        />
      </Campo>

      {esGestor && (
        <>
          {f.tipo === "averia" && f.estado === "hecho" && de === "maquina" && (
            <Campo etiqueta="Horas del motor">
              <Input inputMode="decimal" value={f.horas_motor} placeholder="Horómetro" onChange={(e) => set("horas_motor", e.target.value)} />
            </Campo>
          )}
          <p className="text-sm font-bold text-stone-700">¿Dónde se ha hecho?</p>
          <div className="grid grid-cols-2 gap-1 rounded-2xl bg-stone-200/70 p-1 font-bold">
            {[["propios", "🧑‍🔧 Medios propios"], ["taller", "🏭 Taller"]].map(([k, tx]) => (
              <button key={k} type="button" onClick={() => set("donde", k)} className={`rounded-xl py-2 ${f.donde === k ? "bg-white text-olivo-800 shadow" : "text-stone-600"}`}>
                {tx}
              </button>
            ))}
          </div>
          {f.donde === "taller" ? (
            <Campo etiqueta="Taller">
              <Input list="talleres" value={f.taller} placeholder="Nombre del taller" onChange={(e) => set("taller", e.target.value)} />
              <datalist id="talleres">
                {proveedores.map((p) => (
                  <option key={p.id} value={p.nombre} />
                ))}
              </datalist>
            </Campo>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Campo etiqueta="¿Quién lo hizo?">
                <Select vacio="—" opciones={trabajadores.map((w) => ({ value: w.id, label: w.nombre }))} value={f.trabajador_id} onChange={(e) => set("trabajador_id", e.target.value)} />
              </Campo>
              <Campo etiqueta="Horas de trabajo">
                <Input inputMode="decimal" value={f.horas_mano_obra} onChange={(e) => set("horas_mano_obra", e.target.value)} />
              </Campo>
            </div>
          )}
        </>
      )}
      <Campo etiqueta="Observaciones">
        <textarea className={`${claseInput} min-h-20`} value={f.observaciones} onChange={(e) => set("observaciones", e.target.value)} />
      </Campo>

      {esGestor && (
        <div className="rounded-2xl border-2 border-tierra-100 bg-tierra-50 p-3">
          <p className="text-sm font-bold text-tierra-800">🧾 Repuestos, materiales y gasto</p>
          <p className="mb-2 text-xs text-tierra-700">Todo lo que enlaces o añadas aquí se imputa a {equipo.nombre} y aparece en Economía.</p>
          {enlazadas.map((l) => (
            <div key={l.id} className="mb-1.5 flex items-center gap-2 rounded-xl bg-white px-2 py-1.5 text-sm">
              <span className="flex-1">
                {categoria(l.categoria).icono} {l.descripcion}
                <span className="block text-xs text-stone-500">
                  {l.albaranes_compra?.proveedores?.nombre || "Proveedor"} · {fechaCorta(l.albaranes_compra?.fecha)}
                </span>
              </span>
              <b>{euros(l.importe)}</b>
              <button
                type="button"
                aria-label="Desenlazar"
                className="font-bold text-stone-500"
                onClick={() => {
                  setQuitar((q) => [...q, l.id]);
                  setEnlazadas((x) => x.filter((y) => y.id !== l.id));
                }}
              >
                ✕
              </button>
            </div>
          ))}

          {candidatas === null ? (
            <Boton variante="secundario" className="mt-1 w-full" onClick={verCandidatas}>
              🔗 Enlazar una compra ya registrada
            </Boton>
          ) : (
            <div className="mt-1 max-h-60 space-y-1 overflow-y-auto rounded-xl bg-white p-1.5">
              <p className="px-1 text-xs font-bold text-stone-500">Compras del último año sin enlazar (repuestos, taller, materiales…)</p>
              {candidatas.map((l) => (
                <label key={l.id} className="flex items-start gap-2 rounded px-1 py-1.5 text-sm">
                  <input type="checkbox" className="mt-0.5 h-5 w-5 accent-olivo-700" checked={elegidas.includes(l.id)} onChange={(e) => setElegidas((x) => (e.target.checked ? [...x, l.id] : x.filter((y) => y !== l.id)))} />
                  <span className="flex-1">
                    {categoria(l.categoria).icono} {l.descripcion}
                    <span className="block text-xs text-stone-500">
                      {l.albaranes_compra?.proveedores?.nombre || "Proveedor"} · {fechaCorta(l.albaranes_compra?.fecha)}
                    </span>
                  </span>
                  <b>{euros(l.importe)}</b>
                </label>
              ))}
              {!candidatas.length && <p className="p-2 text-sm text-stone-500">No hay compras de repuestos o taller sin enlazar.</p>}
            </div>
          )}

          {!compra ? (
            <Boton
              variante="secundario"
              className="mt-2 w-full"
              onClick={() =>
                setCompra({
                  tipo_documento: f.donde === "taller" ? "factura" : "ticket",
                  proveedor_nombre: f.donde === "taller" ? f.taller : "",
                  fecha: f.fecha_fin || f.fecha,
                  con_factura: true,
                  lineas: [{ categoria: f.donde === "taller" ? "reparacion" : "repuesto", descripcion: "", importe: "" }],
                })
              }
            >
              ➕ Añadir un gasto nuevo (crea la compra)
            </Boton>
          ) : (
            <div className="mt-2 space-y-2 rounded-xl bg-white p-2.5">
              <div className="grid grid-cols-3 gap-1 rounded-xl bg-stone-100 p-1 text-sm font-bold">
                {[["albaran", "Albarán"], ["factura", "Factura"], ["ticket", "Ticket"]].map(([k, tx]) => (
                  <button key={k} type="button" onClick={() => setCompra({ ...compra, tipo_documento: k })} className={`rounded-lg py-1.5 ${compra.tipo_documento === k ? "bg-white text-olivo-800 shadow" : "text-stone-600"}`}>
                    {tx}
                  </button>
                ))}
              </div>
              <Input list="talleres" value={compra.proveedor_nombre} placeholder={f.donde === "taller" ? "Taller / proveedor" : "Proveedor (tienda de repuestos…)"} onChange={(e) => setCompra({ ...compra, proveedor_nombre: e.target.value })} />
              <div className="grid grid-cols-2 gap-2">
                <Input value={compra.numero || ""} placeholder="Nº documento" onChange={(e) => setCompra({ ...compra, numero: e.target.value })} />
                <Input type="date" value={compra.fecha} onChange={(e) => setCompra({ ...compra, fecha: e.target.value })} />
              </div>
              {compra.lineas.map((l, i) => (
                <div key={i} className="rounded-lg border border-stone-200 p-2">
                  <select
                    className={`${claseInput} !py-1.5`}
                    value={l.categoria}
                    onChange={(e) => setCompra({ ...compra, lineas: compra.lineas.map((x, j) => (j === i ? { ...x, categoria: e.target.value } : x)) })}
                  >
                    {CATS_GASTO.map((c) => (
                      <option key={c} value={c}>
                        {categoria(c).icono} {categoria(c).t}
                      </option>
                    ))}
                  </select>
                  <div className="mt-1.5 grid grid-cols-[1fr_6rem] gap-2">
                    <Input value={l.descripcion} placeholder="Concepto (filtro de aceite, mano de obra…)" onChange={(e) => setCompra({ ...compra, lineas: compra.lineas.map((x, j) => (j === i ? { ...x, descripcion: e.target.value } : x)) })} />
                    <Input inputMode="decimal" value={l.importe} placeholder="€ sin IVA" onChange={(e) => setCompra({ ...compra, lineas: compra.lineas.map((x, j) => (j === i ? { ...x, importe: e.target.value } : x)) })} />
                  </div>
                </div>
              ))}
              <div className="flex gap-2">
                <button type="button" className="text-sm font-bold text-olivo-700" onClick={() => setCompra({ ...compra, lineas: [...compra.lineas, { categoria: "repuesto", descripcion: "", importe: "" }] })}>
                  + Otra línea
                </button>
                <span className="flex-1" />
                <button type="button" className="text-sm font-bold text-stone-500" onClick={() => setCompra(null)}>
                  Quitar gasto nuevo
                </button>
              </div>
              <Campo etiqueta="Total con IVA (€, opcional)">
                <Input inputMode="decimal" value={compra.total || ""} onChange={(e) => setCompra({ ...compra, total: e.target.value })} />
              </Campo>
            </div>
          )}
        </div>
      )}

      {esGestor && (
        <div className="rounded-2xl bg-olivo-50 p-3">
          <p className="mb-2 text-sm font-bold text-olivo-900">⏰ Próximo {f.tipo === "averia" ? "mantenimiento" : t.t.toLowerCase()} (aviso en Inicio)</p>
          <div className="grid grid-cols-2 gap-2">
            <Campo etiqueta="Fecha">
              <Input type="date" value={f.proximo_mantenimiento} onChange={(e) => set("proximo_mantenimiento", e.target.value)} />
            </Campo>
            {de === "maquina" && (
              <Campo etiqueta="O a las … horas">
                <Input inputMode="decimal" value={f.proximo_horas} onChange={(e) => set("proximo_horas", e.target.value)} />
              </Campo>
            )}
          </div>
        </div>
      )}

      <Boton grande className="w-full" disabled={guardando || !f.descripcion.trim()} onClick={guardar}>
        {guardando ? "Guardando…" : esGestor ? "Guardar" : "Avisar de la avería"}
      </Boton>
      {registro && esGestor && (
        <BotonEliminar
          texto="🗑️ Eliminar del historial"
          pregunta="¿Eliminar este registro del historial? Las compras enlazadas se conservan (siguen imputadas al equipo). No se puede deshacer."
          onEliminar={() => eliminarRegistro("mantenimientos", registro.id)}
          textoHecho="Eliminado del historial"
          onHecho={() => onHecho()}
        />
      )}
    </div>
  );
}
