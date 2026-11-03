"use client";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useApp } from "@/components/AppProvider";
import { Boton, Campo, Cargando, Etiqueta, Hoja, Input, Pagina, Select, Tarjeta, Vacio } from "@/components/ui";
import SelectorCampana, { campanasSeleccionadas } from "@/components/SelectorCampana";
import { fechaCorta, num } from "@/lib/formato";

// Límite general de nitrógeno de origen orgánico en zonas vulnerables (Directiva 91/676/CEE, RD 47/2022)
const N_ORGANICO_MAX_ZV = 170;
const ORIGENES = {
  plan_abonado: "Plan de abonado",
  recomendacion_asesor: "Recomendación del asesor",
  programa_zona_vulnerable: "Programa de zona vulnerable",
  estimacion: "Estimación propia (orientativa)",
};

function estado(aplicado, max) {
  if (max == null || max === "") return "sin";
  const p = max > 0 ? aplicado / max : aplicado > 0 ? 2 : 0;
  return p > 1 ? "rojo" : p >= 0.9 ? "ambar" : "verde";
}

function Barra({ etiqueta, aplicado, max }) {
  const e = estado(aplicado, max);
  const pct = max > 0 ? Math.min(100, (aplicado / max) * 100) : aplicado > 0 && max == null ? 100 : 0;
  const color = { verde: "bg-olivo-600", ambar: "bg-amber-500", rojo: "bg-red-600", sin: "bg-stone-400" }[e];
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-12 shrink-0 font-bold text-stone-700">{etiqueta}</span>
      <div className="relative h-4 flex-1 overflow-hidden rounded-full bg-stone-200">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`w-28 shrink-0 text-right tabular-nums ${e === "rojo" ? "font-black text-red-700" : "text-stone-700"}`}>
        {num(aplicado, 0)}
        {max != null ? ` / ${num(max, 0)}` : ""} kg
      </span>
    </div>
  );
}

export default function Fertilizacion() {
  const { empresaId, campanas, esGestor, rol, notificar } = useApp();
  const puedeEditar = esGestor || rol === "tecnico";
  const [sel, setSel] = useState("activas");
  const [filas, setFilas] = useState(null);
  const [planes, setPlanes] = useState([]);
  const [asesores, setAsesores] = useState([]);
  const [hoja, setHoja] = useState(null);
  const elegidas = useMemo(() => campanasSeleccionadas(campanas, sel), [campanas, sel]);
  const ids = elegidas.map((c) => c.id).join(",");

  async function cargar() {
    if (!ids) return setFilas([]);
    const [f, p, a] = await Promise.all([
      supabase.from("v_fertilizacion_recintos").select("*").eq("empresa_id", empresaId).in("campana_id", ids.split(",")).order("parcela"),
      supabase.from("planes_abonado").select("*").eq("empresa_id", empresaId).in("campana_id", ids.split(",")),
      supabase.from("asesores").select("id, nombre, numero_ropo").eq("empresa_id", empresaId).eq("activo", true),
    ]);
    setFilas(f.data || []);
    setPlanes(p.data || []);
    setAsesores(a.data || []);
  }
  useEffect(() => {
    setFilas(null);
    cargar();
  }, [empresaId, ids]); // eslint-disable-line

  async function hecho(m) {
    setHoja(null);
    await cargar();
    notificar(m);
  }

  const excesos = (filas || []).filter(
    (f) => estado(f.n_aplicado_kg_ha, f.n_max_kg_ha) === "rojo" || estado(f.p2o5_aplicado_kg_ha, f.p2o5_max_kg_ha) === "rojo" || (f.zona_vulnerable && f.n_organico_kg_ha > N_ORGANICO_MAX_ZV),
  );
  const sinRiqueza = (filas || []).reduce((s, f) => s + Number(f.productos_sin_riqueza || 0), 0);

  return (
    <Pagina titulo="Fertilización" subtitulo="Lo aplicado en cada parcela frente al máximo" volver="/cuaderno">
      <SelectorCampana valor={sel} onCambio={setSel} />
      <p className="mb-3 text-[15px] text-stone-600">
        Se calcula solo con los abonados que registras y la riqueza de cada producto (kg por hectárea de N, P₂O₅ y K₂O). El máximo es el de tu <b>plan de abonado</b> (RD 1051/2022) o el que indique tu asesor.
      </p>
      {excesos.length > 0 && (
        <div className="mb-3 rounded-2xl bg-red-100 p-3 text-sm font-semibold text-red-900">
          ⚠️ {excesos.length} recinto(s) superan el máximo previsto. Revísalo con tu asesor antes de volver a abonar.
        </div>
      )}
      {sinRiqueza > 0 && (
        <div className="mb-3 rounded-2xl bg-amber-100 p-3 text-sm text-amber-900">
          Hay abonos sin riqueza (N-P-K) indicada; no cuentan en el cálculo.{" "}
          <a href="/productos" className="font-bold underline">
            Completar en Productos
          </a>
        </div>
      )}
      {filas === null ? (
        <Cargando />
      ) : filas.length === 0 ? (
        <Vacio icono="🌾" titulo="Sin parcelas en esta campaña" texto="Asigna un cultivo a tus parcelas para ver aquí su fertilización." />
      ) : (
        elegidas.map((c) => {
          const delaCampana = filas.filter((f) => f.campana_id === c.id).sort((a, b) => (b.aplicaciones > 0) - (a.aplicaciones > 0) || (a.parcela || "").localeCompare(b.parcela || ""));
          if (!delaCampana.length) return null;
          const general = planes.find((p) => p.campana_id === c.id && !p.recinto_id);
          return (
            <section key={c.id} className="mb-6">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-lg font-extrabold text-olivo-900">{c.nombre}</h2>
              </div>
              <Tarjeta className="mb-3 !p-3">
                {general ? (
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-sm">
                      <p className="font-bold text-olivo-900">Máximo por hectárea para todo el cultivo</p>
                      <p>
                        N {num(general.n_kg_ha ?? 0, 0)} · P₂O₅ {num(general.p2o5_kg_ha ?? 0, 0)} · K₂O {num(general.k2o_kg_ha ?? 0, 0)} kg/ha
                      </p>
                      <p className="text-stone-500">
                        {ORIGENES[general.origen]} · {fechaCorta(general.fecha_elaboracion)}
                        {general.rendimiento_esperado_kg_ha ? ` · rendimiento esperado ${num(general.rendimiento_esperado_kg_ha, 0)} kg/ha` : ""}
                      </p>
                    </div>
                    {puedeEditar && (
                      <button type="button" className="shrink-0 text-sm font-bold text-olivo-700" onClick={() => setHoja({ campana: c, plan: general })}>
                        Cambiar
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="text-sm">
                    <p className="font-bold text-amber-800">Falta el máximo de abonado de esta campaña</p>
                    <p className="text-stone-600">Ponlo según tu plan de abonado o lo que te indique tu asesor. Si no lo tienes, AgronomIA puede darte una estimación orientativa.</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {puedeEditar && <Boton onClick={() => setHoja({ campana: c, plan: null })}>Indicar máximos</Boton>}
                      <Boton variante="secundario" href={`/agronomia?q=${encodeURIComponent(`¿Qué necesidades de N, P2O5 y K2O por hectárea son razonables para ${c.cultivo_nombre || c.nombre} en mi explotación esta campaña? Dame una estimación orientativa para el plan de abonado.`)}`}>
                        🌿 Preguntar a AgronomIA
                      </Boton>
                    </div>
                  </div>
                )}
              </Tarjeta>
              <div className="space-y-2">
                {delaCampana.map((f) => (
                  <Tarjeta key={f.recinto_id} className="!p-3">
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <div>
                        <p className="font-extrabold text-olivo-900">{f.parcela}</p>
                        <p className="text-xs text-stone-500">
                          {f.cultivo} · {num(f.superficie_ha)} ha {String(f.referencia_sigpac).includes("?") ? "" : `· ${f.referencia_sigpac}`} · {f.aplicaciones} abonado(s)
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        {f.zona_vulnerable && <Etiqueta color="ambar">Zona vulnerable</Etiqueta>}
                        {f.nivel_plan === "recinto" && <Etiqueta color="tierra">Máximo propio</Etiqueta>}
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Barra etiqueta="N" aplicado={Number(f.n_aplicado_kg_ha)} max={f.n_max_kg_ha == null ? null : Number(f.n_max_kg_ha)} />
                      <Barra etiqueta="P₂O₅" aplicado={Number(f.p2o5_aplicado_kg_ha)} max={f.p2o5_max_kg_ha == null ? null : Number(f.p2o5_max_kg_ha)} />
                      <Barra etiqueta="K₂O" aplicado={Number(f.k2o_aplicado_kg_ha)} max={f.k2o_max_kg_ha == null ? null : Number(f.k2o_max_kg_ha)} />
                      {f.zona_vulnerable && <Barra etiqueta="N org." aplicado={Number(f.n_organico_kg_ha)} max={N_ORGANICO_MAX_ZV} />}
                    </div>
                    {puedeEditar && (
                      <button
                        type="button"
                        className="mt-2 text-sm font-bold text-olivo-700"
                        onClick={() => setHoja({ campana: c, recinto: f, plan: planes.find((p) => p.campana_id === c.id && p.recinto_id === f.recinto_id) || null })}
                      >
                        {f.nivel_plan === "recinto" ? "Cambiar máximo de este recinto" : "Poner un máximo distinto a este recinto"}
                      </button>
                    )}
                  </Tarjeta>
                ))}
              </div>
            </section>
          );
        })
      )}
      <p className="mt-4 text-xs text-stone-500">
        En zonas vulnerables a nitratos el estiércol, purín y demás abonos orgánicos no pueden pasar de {N_ORGANICO_MAX_ZV} kg de N por hectárea y año, y tu comunidad puede fijar límites más estrictos por cultivo. Marca las parcelas afectadas en Parcelas → editar.
      </p>
      <Hoja abierta={!!hoja} onCerrar={() => setHoja(null)} titulo={hoja?.recinto ? `Máximo para ${hoja.recinto.parcela}` : `Plan de abonado · ${hoja?.campana?.nombre || ""}`}>
        {hoja && <FormPlan hoja={hoja} empresaId={empresaId} asesores={asesores} onHecho={hecho} />}
      </Hoja>
    </Pagina>
  );
}

function FormPlan({ hoja, empresaId, asesores, onHecho }) {
  const p = hoja.plan || {};
  const [f, setF] = useState({
    n_kg_ha: p.n_kg_ha ?? "",
    p2o5_kg_ha: p.p2o5_kg_ha ?? "",
    k2o_kg_ha: p.k2o_kg_ha ?? "",
    rendimiento_esperado_kg_ha: p.rendimiento_esperado_kg_ha ?? "",
    cultivo_precedente: p.cultivo_precedente ?? "",
    origen: p.origen || "plan_abonado",
    asesor_id: p.asesor_id || "",
    fecha_elaboracion: p.fecha_elaboracion || new Date().toISOString().slice(0, 10),
    notas: p.notas || "",
  });
  const c = (k) => ({ value: f[k] ?? "", onChange: (e) => setF({ ...f, [k]: e.target.value }) });
  const n = (x) => (x === "" || x == null ? null : Number(String(x).replace(",", ".")));

  async function guardar() {
    const datos = {
      empresa_id: empresaId,
      campana_id: hoja.campana.id,
      recinto_id: hoja.recinto?.recinto_id || null,
      n_kg_ha: n(f.n_kg_ha),
      p2o5_kg_ha: n(f.p2o5_kg_ha),
      k2o_kg_ha: n(f.k2o_kg_ha),
      rendimiento_esperado_kg_ha: n(f.rendimiento_esperado_kg_ha),
      cultivo_precedente: f.cultivo_precedente || null,
      origen: f.origen,
      asesor_id: f.asesor_id || null,
      fecha_elaboracion: f.fecha_elaboracion,
      notas: f.notas || null,
    };
    const { error } = p.id ? await supabase.from("planes_abonado").update(datos).eq("id", p.id) : await supabase.from("planes_abonado").insert(datos);
    if (error) return alert(error.message);
    onHecho("Plan guardado ✓");
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-stone-600">
        {hoja.recinto ? "Este máximo sustituye al general de la campaña solo en este recinto." : "Necesidades del cultivo por hectárea para toda la campaña, según tu plan de abonado."}
      </p>
      <div className="grid grid-cols-3 gap-2">
        <Campo etiqueta="N (kg/ha)">
          <Input inputMode="decimal" {...c("n_kg_ha")} />
        </Campo>
        <Campo etiqueta="P₂O₅ (kg/ha)">
          <Input inputMode="decimal" {...c("p2o5_kg_ha")} />
        </Campo>
        <Campo etiqueta="K₂O (kg/ha)">
          <Input inputMode="decimal" {...c("k2o_kg_ha")} />
        </Campo>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Campo etiqueta="Rendimiento esperado (kg/ha)">
          <Input inputMode="decimal" {...c("rendimiento_esperado_kg_ha")} />
        </Campo>
        <Campo etiqueta="Cultivo anterior">
          <Input {...c("cultivo_precedente")} />
        </Campo>
        <Campo etiqueta="De dónde sale">
          <Select vacio={null} opciones={Object.entries(ORIGENES).map(([value, label]) => ({ value, label }))} {...c("origen")} />
        </Campo>
        <Campo etiqueta="Fecha del plan">
          <Input type="date" {...c("fecha_elaboracion")} />
        </Campo>
      </div>
      {asesores.length > 0 && (
        <Campo etiqueta="Asesor">
          <Select vacio="Sin asesor" opciones={asesores.map((a) => ({ value: a.id, label: a.nombre }))} {...c("asesor_id")} />
        </Campo>
      )}
      <Campo etiqueta="Notas">
        <Input {...c("notas")} />
      </Campo>
      <Boton grande className="w-full" onClick={guardar}>
        Guardar
      </Boton>
      {p.id && hoja.recinto && (
        <Boton
          variante="peligro"
          className="w-full"
          onClick={async () => {
            await supabase.from("planes_abonado").delete().eq("id", p.id);
            onHecho("Vuelve a usar el máximo general");
          }}
        >
          Usar el máximo general
        </Boton>
      )}
    </div>
  );
}
