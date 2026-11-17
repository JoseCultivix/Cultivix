"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useApp } from "@/components/AppProvider";
import CompraLinea, { imputacionValida } from "@/components/CompraLinea";
import VerDocumento from "@/components/VerDocumento";
import { Boton, BotonEliminar, Campo, Cargando, Input } from "@/components/ui";
import { TIPOS_DOCUMENTO, desdeFilas, esAlmacen } from "@/lib/compras";
import { eliminarRegistro } from "@/lib/eliminar";
import { euros } from "@/lib/formato";

const n = (x) => (x === "" || x == null ? null : Number(String(x).replace(",", ".")));
export const lineaVacia = () => ({ categoria: "otro", descripcion: "", cantidad: "", unidad: "", importe: "", imputaciones: [], clave: crypto.randomUUID() });

/**
 * Compra completa: tipo de documento, proveedor, fecha, totales y líneas con su tipo de gasto e imputación.
 * - compraId: corrige una compra existente (carga sus líneas e imputaciones).
 * - inicial: datos ya leídos de un documento escaneado.
 */
export default function FormCompra({ compraId, inicial, documentoId, onHecho, textoGuardar = "Guardar compra" }) {
  const { empresaId, productos, notificar } = useApp();
  const [doc, setDoc] = useState(inicial || (compraId ? null : { tipo_documento: "albaran", fecha: new Date().toISOString().slice(0, 10), con_factura: true, lineas: [lineaVacia()] }));
  const [proveedores, setProveedores] = useState([]);
  const [mantenimientos, setMantenimientos] = useState([]);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    supabase
      .from("proveedores")
      .select("id, nombre")
      .eq("empresa_id", empresaId)
      .order("nombre")
      .then(({ data }) => setProveedores(data || []));
  }, [empresaId]);

  useEffect(() => {
    const desde = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
    supabase
      .from("mantenimientos")
      .select("id, fecha, tipo, descripcion, maquinaria_id, apero_id, estado")
      .eq("empresa_id", empresaId)
      .gte("fecha", desde)
      .order("fecha", { ascending: false })
      .limit(100)
      .then(({ data }) => setMantenimientos(data || []));
  }, [empresaId]);

  useEffect(() => {
    if (!compraId) return;
    (async () => {
      const [{ data: a }, { data: ls }] = await Promise.all([
        supabase.from("albaranes_compra").select("*, proveedores(nombre)").eq("id", compraId).single(),
        supabase.from("albaranes_compra_lineas").select("*, compras_imputaciones(*)").eq("albaran_id", compraId),
      ]);
      setDoc({
        ...a,
        proveedor_nombre: a?.proveedores?.nombre || "",
        lineas: (ls || []).map((l) => ({ ...l, clave: l.id, imputaciones: desdeFilas(l.compras_imputaciones) })),
      });
    })();
  }, [compraId]);

  if (!doc) return <Cargando />;
  const set = (k, v) => setDoc((d) => ({ ...d, [k]: v }));
  const setLinea = (i, patch) => setDoc((d) => ({ ...d, lineas: d.lineas.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));
  const activas = doc.lineas.filter((l) => !l.ignorar);
  const sumaLineas = activas.reduce((s, l) => s + (n(l.importe) || 0), 0);
  const malos = activas.filter((l) => !esAlmacen(l.categoria) && !imputacionValida(l.imputaciones));
  const sinNombre = activas.filter((l) => esAlmacen(l.categoria) && !l.producto_id && !(l.producto_nombre || "").trim());

  async function guardar() {
    setGuardando(true);
    try {
      const prov = proveedores.find((p) => p.nombre.toLowerCase() === (doc.proveedor_nombre || "").trim().toLowerCase());
      const payload = {
        id: compraId || null,
        empresa_id: empresaId,
        documento_id: documentoId || doc.documento_id || null,
        tipo_documento: doc.tipo_documento,
        proveedor_id: prov?.id || null,
        proveedor_nombre: prov ? null : doc.proveedor_nombre,
        proveedor_nif: doc.proveedor_nif || null,
        numero: doc.numero,
        fecha: doc.fecha,
        base_imponible: n(doc.base_imponible),
        iva: n(doc.iva),
        total: n(doc.total) ?? (sumaLineas || null),
        con_factura: doc.tipo_documento === "factura" ? true : !!doc.con_factura,
        lineas: activas.map((l) => ({
          id: l.id || null,
          categoria: l.categoria,
          producto_id: esAlmacen(l.categoria) ? l.producto_id || null : null,
          producto_nombre: esAlmacen(l.categoria) && !l.producto_id ? l.producto_nombre || l.descripcion : null,
          descripcion: esAlmacen(l.categoria) ? l.descripcion || l.producto_nombre || productos.find((p) => p.id === l.producto_id)?.nombre : l.descripcion || l.descripcion_original,
          cantidad: n(l.cantidad),
          unidad: l.unidad || null,
          precio_unitario: n(l.precio_unitario) ?? (n(l.cantidad) && n(l.importe) != null ? Math.round((n(l.importe) / n(l.cantidad)) * 10000) / 10000 : null),
          importe: n(l.importe),
          lote: l.lote || null,
          imputaciones: esAlmacen(l.categoria) ? [] : (l.imputaciones || []).map((i) => ({ tipo: i.tipo, id: i.id, porcentaje: n(i.porcentaje) })),
          mantenimiento_id: esAlmacen(l.categoria) ? null : l.mantenimiento_id || null,
        })),
      };
      const { error } = await supabase.rpc("guardar_compra", { payload });
      if (error) throw error;
      onHecho(compraId ? "Compra corregida ✓" : activas.some((l) => esAlmacen(l.categoria)) ? "Compra registrada. Stock actualizado ✓" : "Gasto registrado ✓");
    } catch (e) {
      notificar(e.message, "error");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="space-y-3">
      {(documentoId || doc.documento_id) && compraId && <VerDocumento documentoId={doc.documento_id} texto="👁️ Ver el documento" className="w-full" />}
      {doc.notas && <p className="rounded-xl bg-amber-100 p-3 text-sm text-amber-900">⚠️ {doc.notas}</p>}

      <div className="grid grid-cols-3 gap-1 rounded-2xl bg-stone-200/70 p-1 font-bold">
        {TIPOS_DOCUMENTO.map((t) => (
          <button key={t.value} type="button" onClick={() => set("tipo_documento", t.value)} className={`rounded-xl py-2.5 ${doc.tipo_documento === t.value ? "bg-white text-olivo-800 shadow" : "text-stone-600"}`}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Campo etiqueta="Proveedor" className="col-span-2">
          <Input list="lista-proveedores" value={doc.proveedor_nombre || ""} placeholder="Elige o escribe uno nuevo" onChange={(e) => set("proveedor_nombre", e.target.value)} />
          <datalist id="lista-proveedores">
            {proveedores.map((p) => (
              <option key={p.id} value={p.nombre} />
            ))}
          </datalist>
        </Campo>
        <Campo etiqueta={`Nº de ${TIPOS_DOCUMENTO.find((t) => t.value === doc.tipo_documento)?.label.toLowerCase() || "documento"}`}>
          <Input value={doc.numero || ""} onChange={(e) => set("numero", e.target.value)} />
        </Campo>
        <Campo etiqueta="Fecha del documento">
          <Input type="date" value={doc.fecha || ""} onChange={(e) => set("fecha", e.target.value)} />
        </Campo>
        <Campo etiqueta="Base (€)">
          <Input inputMode="decimal" value={doc.base_imponible ?? ""} onChange={(e) => set("base_imponible", e.target.value)} />
        </Campo>
        <Campo etiqueta="Total con IVA (€)">
          <Input inputMode="decimal" value={doc.total ?? ""} onChange={(e) => set("total", e.target.value)} />
        </Campo>
        {doc.tipo_documento !== "factura" && (
          <label className="col-span-2 flex items-center gap-2 text-[15px] font-semibold">
            <input type="checkbox" className="h-5 w-5 accent-olivo-700" checked={!!doc.con_factura} onChange={(e) => set("con_factura", e.target.checked)} />
            Tendré factura de esta compra
          </label>
        )}
      </div>

      <h2 className="pt-1 text-sm font-bold uppercase tracking-wide text-stone-500">Líneas ({activas.length})</h2>
      {doc.lineas.map((l, i) => (
        <CompraLinea
          key={l.clave || l.id || i}
          l={l}
          productos={productos}
          mantenimientos={mantenimientos}
          onCambio={(patch) => setLinea(i, patch)}
          onQuitar={() => (l.descripcion_original ? setLinea(i, { ignorar: !l.ignorar }) : setDoc((d) => ({ ...d, lineas: d.lineas.filter((_, j) => j !== i) })))}
        />
      ))}
      <Boton variante="secundario" className="w-full" onClick={() => setDoc((d) => ({ ...d, lineas: [...d.lineas, lineaVacia()] }))}>
        ➕ Añadir línea
      </Boton>
      <p className="text-sm text-stone-600">
        Suma de líneas (sin IVA): <b>{euros(sumaLineas)}</b>
      </p>
      {malos.length > 0 && <p className="text-sm font-bold text-red-700">Revisa los porcentajes de imputación: deben sumar 100 %.</p>}
      {sinNombre.length > 0 && <p className="text-sm font-bold text-red-700">Falta el nombre de algún producto nuevo.</p>}
      <Boton grande className="w-full" disabled={guardando || !doc.fecha || !activas.length || malos.length > 0 || sinNombre.length > 0} onClick={guardar}>
        {guardando ? "Guardando…" : textoGuardar}
      </Boton>
      {compraId && (
        <BotonEliminar
          texto="🗑️ Eliminar compra"
          pregunta="¿Eliminar esta compra y todas sus líneas? El stock y los costes se recalculan. No se puede deshacer."
          onEliminar={() => eliminarRegistro("albaranes_compra", compraId)}
          textoHecho="Compra eliminada"
          onHecho={onHecho}
        />
      )}
    </div>
  );
}
