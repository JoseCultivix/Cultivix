"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useNavegar } from "@/lib/navegacion";
import { apiPost, supabase } from "@/lib/supabase";
import { useApp } from "@/components/AppProvider";
import { blobABase64, comprimirImagen } from "@/lib/imagen";
import { Boton, Pagina } from "@/components/ui";
import FormCompra from "@/components/FormCompra";
import { CATEGORIAS, esAlmacen } from "@/lib/compras";

export default function Escanear() {
  const { empresaId, notificar, recargar, esGestor } = useApp();
  const router = useRouter();
  const navegar = useNavegar();
  const camara = useRef(null);
  const archivo = useRef(null);
  const [vista, setVista] = useState(null);
  const [fase, setFase] = useState("inicio"); // inicio | leyendo | revisar
  const [doc, setDoc] = useState(null);
  const [documentoId, setDocumentoId] = useState(null);

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
      if (d?.id && ["albaran", "factura", "ticket"].includes(res.tipo_documento)) await supabase.from("documentos").update({ tipo: res.tipo_documento }).eq("id", d.id);
      setDoc({
        ...res,
        tipo_documento: ["albaran", "factura", "ticket"].includes(res.tipo_documento) ? res.tipo_documento : "albaran",
        con_factura: res.tipo_documento !== "ticket",
        lineas: (res.lineas || []).map((l) => {
          const cat = CATEGORIAS.some((c) => c.v === l.tipo) ? l.tipo : "otro";
          return {
            ...l,
            clave: crypto.randomUUID(),
            categoria: cat,
            descripcion_original: l.descripcion,
            descripcion: esAlmacen(cat) ? l.descripcion : l.producto_nombre || l.descripcion,
            unidad: l.unidad || (esAlmacen(cat) ? "kg" : ""),
            imputaciones: [],
          };
        }),
      });
      setFase("revisar");
    } catch (err) {
      notificar(err.message, "error");
      setFase("inicio");
    }
  }

  return (
    <Pagina titulo="Escanear compra" subtitulo="Albaranes, facturas y tickets: productos, gasoil, reparaciones…" volver="/">
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
          <p className="text-center text-xs text-stone-400">Fitosanitarios, abonos y semillas van al almacén y su coste llega a la parcela al aplicarlos. El gasoil, las reparaciones y otros gastos los imputas tú a parcelas, fincas, máquinas o gasto general.</p>
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
        <div className="space-y-3">
          <FormCompra
            inicial={doc}
            documentoId={documentoId}
            textoGuardar="✓ Registrar compra"
            onHecho={async (m) => {
              await recargar();
              notificar(m);
              navegar("/economia");
            }}
          />
          <Boton variante="secundario" className="w-full" onClick={() => setFase("inicio")}>
            Repetir la foto
          </Boton>
        </div>
      )}
    </Pagina>
  );
}
