"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useApp } from "@/components/AppProvider";
import { Boton, Campo, Etiqueta, Hoja, Input, Pagina, Select, Vacio } from "@/components/ui";
import { euros, fechaCorta, num } from "@/lib/formato";

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

function FormProducto({ p, empresaId, onHecho }) {
  const [f, setF] = useState({ nombre: "", tipo: "fitosanitario", unidad: "kg", materia_activa: "", numero_registro: "", dosis_habitual_ha: "", plazo_seguridad_dias: "", ...p });
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
    };
    const { error } = p.id ? await supabase.from("productos").update(datos).eq("id", p.id) : await supabase.from("productos").insert(datos);
    if (error) return alert(error.message);
    if (p.id && n(ajuste)) {
      await supabase.from("stock_ajustes").insert({ empresa_id: empresaId, producto_id: p.id, cantidad: n(ajuste), motivo: "Ajuste manual" });
    }
    onHecho("Producto guardado ✓");
  }

  return (
    <div className="space-y-3">
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
      {p.id && (
        <Campo etiqueta={`Ajustar stock (+/− ${f.unidad})`} ayuda={`Stock actual: ${num(p.stock ?? 0, 2)} ${f.unidad}. Usa negativo para bajas (roturas, caducado).`}>
          <Input inputMode="decimal" value={ajuste} onChange={(e) => setAjuste(e.target.value)} placeholder="0" />
        </Campo>
      )}
      <Boton grande className="w-full" disabled={!f.nombre?.trim()} onClick={guardar}>
        Guardar
      </Boton>
      {f.tipo === "fitosanitario" && !f.numero_registro && <Etiqueta color="ambar">El nº de registro es necesario para el cuaderno de campo</Etiqueta>}
    </div>
  );
}
