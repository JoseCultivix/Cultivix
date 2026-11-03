"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useNavegar } from "@/lib/navegacion";
import { apiPost, supabase } from "@/lib/supabase";
import { useApp } from "@/components/AppProvider";
import { blobABase64, comprimirImagen } from "@/lib/imagen";
import { Boton, Campo, Input, Pagina, Select, Tarjeta, claseInput } from "@/components/ui";
import { euros } from "@/lib/formato";

const TIPOS = ["fitosanitario", "fertilizante", "herbicida", "bioestimulante", "semilla", "gasoil", "otro"].map((t) => ({ value: t, label: t }));
const UNIDADES = ["kg", "l", "ud", "t", "g", "ml"].map((t) => ({ value: t, label: t }));

export default function Escanear() {
  const { empresaId, productos, notificar, recargar, esGestor } = useApp();
  const router = useRouter();
  const navegar = useNavegar();
  const camara = useRef(null);
  const archivo = useRef(null);
  const [vista, setVista] = useState(null);
  const [fase, setFase] = useState("inicio"); // inicio | leyendo | revisar
  const [doc, setDoc] = useState(null);
  const [documentoId, setDocumentoId] = useState(null);
  const [guardando, setGuardando] = useState(false);

  if (!esGestor) return <Pagina titulo="Escanear documento">Esta función es para el titular o el encargado.</Pagina>;

  async function procesar(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFase("leyendo");
    try {
      const esPdf = f.type === "application/pdf";
      if (esPdf && f.size > 3.5 * 1024 * 1024) throw new Error("El PDF es demasiado grande (máx. 3,5 MB). Haz una foto del albarán.");
      const { blob, tipo } = esPdf ? { blob: f, tipo: f.type } : await comprimirImagen(f, 2000, 0.85);
      if (!esPdf) setVista(URL.createObjectURL(blob));
      // 1) Guardar el original (FLUJO-049: todo queda archivado)
      const ext = esPdf ? "pdf" : "jpg";
      const ruta = `${empresaId}/albaranes/${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.${ext}`;
      const up = await supabase.storage.from("documentos").upload(ruta, blob, { contentType: tipo });
      if (up.error) throw up.error;
      const { data: d } = await supabase.from("documentos").insert({ empresa_id: empresaId, tipo: "albaran", nombre: f.name, archivo_path: ruta, mime_type: tipo }).select("id").single();
      setDocumentoId(d?.id || null);
      // 2) Lectura con IA
      const res = await apiPost("/api/escanear", { empresa_id: empresaId, base64: await blobABase64(blob), media_type: tipo });
      if (d?.id) await supabase.from("documentos").update({ estado_ia: "procesado", datos_extraidos: res }).eq("id", d.id);
      setDoc({
        ...res,
        con_factura: res.tipo_documento !== "ticket",
        lineas: (res.lineas || []).map((l) => ({ ...l, tipo: l.tipo || "otro", unidad: l.unidad || "kg" })),
      });
      setFase("revisar");
    } catch (err) {
      notificar(err.message, "error");
      setFase("inicio");
    }
  }

  const set = (k, v) => setDoc((d) => ({ ...d, [k]: v }));
  const setLinea = (i, k, v) => setDoc((d) => ({ ...d, lineas: d.lineas.map((l, j) => (j === i ? { ...l, [k]: v } : l)) }));

  async function guardar() {
    setGuardando(true);
    try {
      const n = (x) => (x === "" || x == null ? null : Number(String(x).replace(",", ".")));
      const payload = {
        empresa_id: empresaId,
        documento_id: documentoId,
        proveedor_nombre: doc.proveedor_nombre,
        proveedor_nif: doc.proveedor_nif,
        numero: doc.numero,
        fecha: doc.fecha,
        base_imponible: n(doc.base_imponible),
        iva: n(doc.iva),
        total: n(doc.total),
        con_factura: doc.con_factura,
        lineas: doc.lineas
          .filter((l) => !l.ignorar)
          .map((l) => ({
            producto_id: l.producto_id || null,
            producto_nombre: l.producto_id ? null : l.producto_nombre || l.descripcion,
            tipo: l.tipo,
            unidad: l.unidad,
            descripcion: l.descripcion,
            cantidad: n(l.cantidad),
            precio_unitario: n(l.precio_unitario),
            importe: n(l.importe),
          })),
      };
      const { error } = await supabase.rpc("registrar_albaran", { payload });
      if (error) throw error;
      await recargar();
      notificar("Compra registrada. Stock actualizado ✓");
      navegar("/productos");
    } catch (e) {
      notificar(e.message, "error");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Pagina titulo="Escanear documento" subtitulo="Albaranes, facturas y tickets de compra." volver="/">
      <input ref={camara} type="file" accept="image/*" capture="environment" className="hidden" onChange={procesar} />
      <input ref={archivo} type="file" accept="image/*,application/pdf" className="hidden" onChange={procesar} />

      {fase === "inicio" && (
        <div className="space-y-3">
          <Boton grande className="w-full !min-h-36 !text-2xl" onClick={() => camara.current?.click()}>
            📷 Fotografiar albarán
          </Boton>
          <Boton variante="secundario" grande className="w-full" onClick={() => archivo.current?.click()}>
            📎 Subir foto o PDF
          </Boton>
          <p className="pt-2 text-center text-sm text-stone-500">Cultivix leerá proveedor, productos, cantidades y precios. Tú solo revisas.</p>
          <p className="text-center text-xs text-stone-400">Comprar no es aplicar: el producto pasa a tu stock y lo usarás al registrar un tratamiento.</p>
        </div>
      )}

      {fase === "leyendo" && (
        <div className="py-10 text-center">
          {vista && <img src={vista} alt="" className="mx-auto mb-4 max-h-60 rounded-2xl opacity-70" />}
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-olivo-200 border-t-olivo-700" />
          <p className="mt-3 text-lg font-bold text-olivo-900">Leyendo el documento…</p>
        </div>
      )}

      {fase === "revisar" && doc && (
        <div className="space-y-4">
          {doc.notas && <p className="rounded-xl bg-amber-100 p-3 text-sm text-amber-900">⚠️ {doc.notas}</p>}
          <Tarjeta className="grid grid-cols-2 gap-3">
            <Campo etiqueta="Proveedor" className="col-span-2">
              <Input value={doc.proveedor_nombre || ""} onChange={(e) => set("proveedor_nombre", e.target.value)} />
            </Campo>
            <Campo etiqueta="Nº documento">
              <Input value={doc.numero || ""} onChange={(e) => set("numero", e.target.value)} />
            </Campo>
            <Campo etiqueta="Fecha">
              <Input type="date" value={doc.fecha || ""} onChange={(e) => set("fecha", e.target.value)} />
            </Campo>
            <Campo etiqueta="Total (€)">
              <Input inputMode="decimal" value={doc.total ?? ""} onChange={(e) => set("total", e.target.value)} />
            </Campo>
            <label className="flex items-end gap-2 pb-3 text-[15px] font-semibold">
              <input type="checkbox" className="h-5 w-5 accent-olivo-700" checked={!doc.con_factura} onChange={(e) => set("con_factura", !e.target.checked)} />
              Sin factura
            </label>
          </Tarjeta>

          <h2 className="text-sm font-bold uppercase tracking-wide text-stone-500">Productos ({doc.lineas.length})</h2>
          {doc.lineas.map((l, i) => (
            <Tarjeta key={i} className={l.ignorar ? "opacity-50" : ""}>
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm text-stone-500">{l.descripcion}</p>
                <button type="button" className="text-sm font-bold text-stone-500" onClick={() => setLinea(i, "ignorar", !l.ignorar)}>
                  {l.ignorar ? "Incluir" : "Quitar"}
                </button>
              </div>
              <div className="mt-2 grid grid-cols-6 gap-2">
                <div className="col-span-6">
                  <select
                    className={claseInput}
                    value={l.producto_id || ""}
                    onChange={(e) => setLinea(i, "producto_id", e.target.value || null)}
                  >
                    <option value="">➕ Nuevo: {l.producto_nombre || l.descripcion}</option>
                    {productos.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nombre}
                      </option>
                    ))}
                  </select>
                </div>
                {!l.producto_id && (
                  <>
                    <Input className="col-span-6" value={l.producto_nombre || ""} placeholder="Nombre del producto" onChange={(e) => setLinea(i, "producto_nombre", e.target.value)} />
                    <div className="col-span-4">
                      <Select vacio={null} opciones={TIPOS} value={l.tipo} onChange={(e) => setLinea(i, "tipo", e.target.value)} />
                    </div>
                  </>
                )}
                <div className={l.producto_id ? "col-span-6 grid grid-cols-3 gap-2" : "col-span-2"}>
                  {l.producto_id ? (
                    <>
                      <Input inputMode="decimal" value={l.cantidad ?? ""} onChange={(e) => setLinea(i, "cantidad", e.target.value)} placeholder="Cantidad" />
                      <Select vacio={null} opciones={UNIDADES} value={l.unidad} onChange={(e) => setLinea(i, "unidad", e.target.value)} />
                      <Input inputMode="decimal" value={l.importe ?? ""} onChange={(e) => setLinea(i, "importe", e.target.value)} placeholder="Importe €" />
                    </>
                  ) : (
                    <Select vacio={null} opciones={UNIDADES} value={l.unidad} onChange={(e) => setLinea(i, "unidad", e.target.value)} />
                  )}
                </div>
                {!l.producto_id && (
                  <>
                    <Input className="col-span-3" inputMode="decimal" value={l.cantidad ?? ""} onChange={(e) => setLinea(i, "cantidad", e.target.value)} placeholder="Cantidad" />
                    <Input className="col-span-3" inputMode="decimal" value={l.importe ?? ""} onChange={(e) => setLinea(i, "importe", e.target.value)} placeholder="Importe €" />
                  </>
                )}
              </div>
            </Tarjeta>
          ))}
          <p className="text-right text-[15px] text-stone-600">
            Suma de líneas: <b>{euros(doc.lineas.filter((l) => !l.ignorar).reduce((s, l) => s + (Number(String(l.importe ?? 0).replace(",", ".")) || 0), 0))}</b>
          </p>
          <div className="flex gap-3">
            <Boton variante="secundario" grande onClick={() => setFase("inicio")}>
              Repetir
            </Boton>
            <Boton grande className="flex-1" disabled={guardando} onClick={guardar}>
              {guardando ? "Guardando…" : "✓ Registrar compra"}
            </Boton>
          </div>
        </div>
      )}
    </Pagina>
  );
}
