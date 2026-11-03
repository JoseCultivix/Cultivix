"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useApp } from "@/components/AppProvider";
import { Boton, Campo, Etiqueta, Hoja, Input, Pagina, Select, Vacio } from "@/components/ui";
import { euros, fechaCorta, num } from "@/lib/formato";
import { fichaRegistro, usosRegistro } from "@/lib/fitos";

const TIPOS = ["fitosanitario", "fertilizante", "herbicida", "bioestimulante", "semilla", "gasoil", "otro"];

export default function Productos() {
  const { empresaId, productos, esGestor, recargar, notificar } = useApp();
  const [editar, setEditar] = useState(null);
  const [filtro, setFiltro] = useState("");

  const lista = productos.filter((p) => !filtro || p.tipo === filtro);
  async function hecho(m) {
    setEditar(null);
    await recargar();
    notificar(m);
  }

  return (
    <Pagina
      titulo="Productos y stock"
      subtitulo="Stock = compras − aplicaciones ± ajustes"
      volver="/mas"
      accion={esGestor && <Boton href="/escanear">📄 Albarán</Boton>}
    >
      <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4">
        {["", ...TIPOS].map((t) => (
          <button key={t} type="button" onClick={() => setFiltro(t)} className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold capitalize ${filtro === t ? "bg-olivo-700 text-white" : "bg-white text-stone-700"}`}>
            {t || "Todos"}
          </button>
        ))}
      </div>
      {lista.length === 0 ? (
        <Vacio icono="🧴" titulo="Sin productos" texto="Escanea un albarán de compra y se crearán solos, con su cantidad y precio.">
          {esGestor && <Boton href="/escanear">Escanear albarán</Boton>}
          {esGestor && (
            <Boton variante="secundario" onClick={() => setEditar({})}>
              Añadir a mano
            </Boton>
          )}
        </Vacio>
      ) : (
        <div className="space-y-2">
          {lista.map((p) => {
            const s = Number(p.stock ?? 0);
            return (
              <button key={p.id} type="button" onClick={() => esGestor && setEditar(p)} className="flex w-full items-center gap-3 rounded-2xl bg-white p-3 text-left shadow-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-lg font-extrabold text-olivo-900">{p.nombre}</p>
                  <p className="text-sm text-stone-500">
                    <span className="capitalize">{p.tipo}</span>
                    {p.materia_activa ? ` · ${p.materia_activa}` : ""}
                    {p.riqueza_n != null || p.riqueza_p2o5 != null || p.riqueza_k2o != null ? ` · ${num(p.riqueza_n ?? 0, 1)}-${num(p.riqueza_p2o5 ?? 0, 1)}-${num(p.riqueza_k2o ?? 0, 1)}` : ""}
                    {p.ultima_compra ? ` · comprado ${fechaCorta(p.ultima_compra)}` : ""}
                    {p.precio_medio ? ` · ${euros(p.precio_medio)}/${p.unidad}` : ""}
                  </p>
                </div>
                {esGestor && (
                  <div className="text-right">
                    <p className={`text-xl font-black ${s < 0 ? "text-red-700" : s === 0 ? "text-stone-400" : "text-olivo-800"}`}>{num(s, 1)}</p>
                    <p className="text-xs text-stone-500">{p.unidad}</p>
                  </div>
                )}
              </button>
            );
          })}
          {esGestor && (
            <Boton variante="secundario" className="w-full" onClick={() => setEditar({})}>
              + Añadir producto a mano
            </Boton>
          )}
        </div>
      )}
      <Hoja abierta={!!editar} onCerrar={() => setEditar(null)} titulo={editar?.id ? editar.nombre : "Nuevo producto"}>
        {editar && <FormProducto p={editar} empresaId={empresaId} onHecho={hecho} />}
      </Hoja>
    </Pagina>
  );
}

function BuscarRegistro({ onElegir, codigos }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState(null);
  const [buscando, setBuscando] = useState(false);
  async function buscar() {
    if (q.trim().length < 2) return;
    setBuscando(true);
    const { data } = await supabase.rpc("fito_buscar", { p_texto: q.trim(), p_codigo_cultivo: codigos[0] || null });
    setRes(data || []);
    setBuscando(false);
  }
  return (
    <div className="rounded-2xl border-2 border-olivo-100 bg-white p-3">
      <p className="mb-2 text-sm font-bold text-olivo-800">Buscar en el Registro de Fitosanitarios del MAPA</p>
      <div className="flex gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && buscar()} placeholder="Nombre, nº de registro o materia activa" />
        <Boton onClick={buscar} disabled={buscando}>
          {buscando ? "…" : "Buscar"}
        </Boton>
      </div>
      {res && res.length === 0 && <p className="mt-2 text-sm text-stone-500">Nada encontrado.</p>}
      {res?.length > 0 && (
        <div className="mt-2 max-h-72 space-y-1 overflow-y-auto">
          {res.map((r) => (
            <button key={r.registro + r.producto} type="button" onClick={() => onElegir(r)} className="block w-full rounded-xl bg-stone-50 p-2 text-left text-sm active:bg-olivo-50">
              <b>{r.producto}</b> <span className="text-stone-500">· nº {r.registro}</span>
              <span className="block text-xs text-stone-600">{r.formulado}</span>
              <span className={`text-xs font-semibold ${r.estado === "Vigente" ? "text-olivo-700" : "text-red-700"}`}>{r.estado}</span>
              {r.en_cultivo === true && <span className="ml-2 text-xs font-semibold text-olivo-700">· autorizado en tu cultivo</span>}
              {r.en_cultivo === false && <span className="ml-2 text-xs text-stone-500">· no autorizado en tu cultivo principal</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function FichaRegistro({ registro }) {
  const [f, setF] = useState(undefined);
  useEffect(() => {
    let vivo = true;
    if (!registro) return setF(undefined);
    fichaRegistro(registro).then((x) => vivo && setF(x));
    return () => {
      vivo = false;
    };
  }, [registro]);
  if (!registro || f === undefined) return null;
  if (!f) return <p className="rounded-xl bg-red-50 p-2 text-sm text-red-800">⚠️ El nº {registro} no aparece en el Registro del MAPA.</p>;
  return (
    <p className={`rounded-xl p-2 text-sm ${f.estado === "Vigente" ? "bg-olivo-50 text-olivo-900" : "bg-red-50 text-red-800"}`}>
      Registro MAPA: <b>{f.producto}</b> · {f.estado}
      {f.caducidad ? ` · autorizado hasta ${fechaCorta(f.caducidad)} ${f.caducidad.slice(0, 4)}` : ""}
      <span className="block text-xs opacity-80">
        {f.titular} · datos del {f.fecha_datos ? new Date(f.fecha_datos + "T12:00").toLocaleDateString("es-ES") : "—"}
      </span>
    </p>
  );
}

function FormProducto({ p, empresaId, onHecho }) {
  const [f, setF] = useState({ nombre: "", tipo: "fitosanitario", unidad: "kg", materia_activa: "", numero_registro: "", dosis_habitual_ha: "", plazo_seguridad_dias: "", riqueza_n: "", riqueza_p2o5: "", riqueza_k2o: "", densidad_kg_l: "", n_organico: false, ...p });
  const [ajuste, setAjuste] = useState("");
  const c = (k) => ({ value: f[k] ?? "", onChange: (e) => setF({ ...f, [k]: e.target.value }) });
  const n = (x) => (x === "" || x == null ? null : Number(String(x).replace(",", ".")));

  async function guardar() {
    const datos = {
      empresa_id: empresaId,
      nombre: f.nombre.trim(),
      tipo: f.tipo,
      unidad: f.unidad,
      materia_activa: f.materia_activa || null,
      numero_registro: f.numero_registro || null,
      dosis_habitual_ha: n(f.dosis_habitual_ha),
      plazo_seguridad_dias: n(f.plazo_seguridad_dias),
      riqueza_n: n(f.riqueza_n),
      riqueza_p2o5: n(f.riqueza_p2o5),
      riqueza_k2o: n(f.riqueza_k2o),
      densidad_kg_l: n(f.densidad_kg_l),
      n_organico: !!f.n_organico,
    };
    const { error } = p.id ? await supabase.from("productos").update(datos).eq("id", p.id) : await supabase.from("productos").insert(datos);
    if (error) return alert(error.message);
    if (p.id && n(ajuste)) {
      await supabase.from("stock_ajustes").insert({ empresa_id: empresaId, producto_id: p.id, cantidad: n(ajuste), motivo: "Ajuste manual" });
    }
    onHecho("Producto guardado ✓");
  }

  const { cultivos, recintos } = useApp();
  const codigos = [...new Set(recintos.map((r) => cultivos.find((c) => c.id === r.cultivo_id)?.codigo_mapa).filter(Boolean))];
  async function elegir(r) {
    const nuevo = { ...f, numero_registro: r.registro, materia_activa: f.materia_activa || r.formulado || "", nombre: f.nombre || r.producto };
    try {
      const usos = await usosRegistro(r.registro, codigos);
      const dias = usos.filter((u) => u.relacion !== "inferior").map((u) => u.plazo_dias).filter((x) => x != null);
      if (dias.length && !f.plazo_seguridad_dias) nuevo.plazo_seguridad_dias = Math.max(...dias);
    } catch {}
    setF(nuevo);
  }
  const esFito = f.tipo === "fitosanitario" || f.tipo === "herbicida";
  return (
    <div className="space-y-3">
      {esFito && <BuscarRegistro onElegir={elegir} codigos={codigos} />}
      {esFito && <FichaRegistro registro={f.numero_registro} />}
      <Campo etiqueta="Nombre comercial">
        <Input {...c("nombre")} />
      </Campo>
      <div className="grid grid-cols-2 gap-2">
        <Campo etiqueta="Tipo">
          <Select vacio={null} opciones={TIPOS.map((t) => ({ value: t, label: t }))} {...c("tipo")} />
        </Campo>
        <Campo etiqueta="Unidad">
          <Select vacio={null} opciones={["kg", "l", "ud", "t"].map((t) => ({ value: t, label: t }))} {...c("unidad")} />
        </Campo>
        <Campo etiqueta="Materia activa">
          <Input {...c("materia_activa")} />
        </Campo>
        <Campo etiqueta="Nº registro MAPA">
          <Input {...c("numero_registro")} />
        </Campo>
        <Campo etiqueta={`Dosis habitual (${f.unidad}/ha)`}>
          <Input inputMode="decimal" {...c("dosis_habitual_ha")} />
        </Campo>
        <Campo etiqueta="Plazo seguridad (días)">
          <Input inputMode="numeric" {...c("plazo_seguridad_dias")} />
        </Campo>
      </div>
      {(["fertilizante", "bioestimulante", "otro"].includes(f.tipo) || n(f.riqueza_n) != null) && (
        <div className="rounded-2xl bg-olivo-50 p-3">
          <p className="text-sm font-bold text-olivo-800">Riqueza del abono (% en peso)</p>
          <p className="mb-2 text-xs text-stone-600">Viene en el saco o la etiqueta (ej. 15-15-15). Sirve para calcular los kg de N, P y K por hectárea.</p>
          <div className="grid grid-cols-3 gap-2">
            <Campo etiqueta="N">
              <Input inputMode="decimal" {...c("riqueza_n")} />
            </Campo>
            <Campo etiqueta="P₂O₅">
              <Input inputMode="decimal" {...c("riqueza_p2o5")} />
            </Campo>
            <Campo etiqueta="K₂O">
              <Input inputMode="decimal" {...c("riqueza_k2o")} />
            </Campo>
          </div>
          {f.unidad === "l" && (
            <Campo etiqueta="Densidad (kg/l)" ayuda="Para pasar litros a kilos. Si no la sabes, se usa 1." className="mt-2">
              <Input inputMode="decimal" {...c("densidad_kg_l")} />
            </Campo>
          )}
          <label className="mt-2 flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" className="h-5 w-5" checked={!!f.n_organico} onChange={(e) => setF({ ...f, n_organico: e.target.checked })} />
            Es orgánico (estiércol, purín, compost…)
          </label>
        </div>
      )}
      {p.id && (
        <Campo etiqueta={`Ajustar stock (+/− ${f.unidad})`} ayuda={`Stock actual: ${num(p.stock ?? 0, 2)} ${f.unidad}. Usa negativo para bajas (roturas, caducado).`}>
          <Input inputMode="decimal" value={ajuste} onChange={(e) => setAjuste(e.target.value)} placeholder="0" />
        </Campo>
      )}
      <Boton grande className="w-full" disabled={!f.nombre?.trim()} onClick={guardar}>
        Guardar
      </Boton>
      {f.tipo === "fitosanitario" && !f.numero_registro && <Etiqueta color="ambar">El nº de registro es necesario para el cuaderno de campo</Etiqueta>}
      {f.tipo === "fertilizante" && n(f.riqueza_n) == null && n(f.riqueza_p2o5) == null && n(f.riqueza_k2o) == null && <Etiqueta color="ambar">Indica la riqueza para el control de fertilización</Etiqueta>}
    </div>
  );
}
