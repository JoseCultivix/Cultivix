"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useNavegar } from "@/lib/navegacion";
import { apiPost, supabase } from "@/lib/supabase";
import { useApp } from "@/components/AppProvider";
import { blobABase64, comprimirImagen } from "@/lib/imagen";
import { Boton, Pagina } from "@/components/ui";
import FormCompra from "@/components/FormCompra";
import { CATEGORIAS, esAlmacen } from "@/lib/compras";
import { actualizarBandeja, agregarABandeja, esFalloDeRed, leerDeBandeja, quitarDeBandeja, subirDocumento } from "@/lib/bandeja";

export default function PaginaEscanear() {
  return (
    <Suspense>
      <Escanear />
    </Suspense>
  );
}

function aPropuesta(res) {
  return {
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
  };
}

function Escanear() {
  const { empresaId, notificar, recargar, esGestor, online } = useApp();
  const q = useSearchParams();
  const [bandejaId, setBandejaId] = useState(null);
  const router = useRouter();
  const navegar = useNavegar();
  const camara = useRef(null);
  const archivo = useRef(null);
  const [vista, setVista] = useState(null);
  const [fase, setFase] = useState("inicio"); // inicio | leyendo | revisar
  const [doc, setDoc] = useState(null);
  const [documentoId, setDocumentoId] = useState(null);

  async function guardarEnBandeja(blob, tipo, nombre) {
    await agregarABandeja({ tipo: "compra", empresa_id: empresaId, blob, mime: tipo, nombre });
    notificar("📥 Sin cobertura: la foto queda guardada en el móvil. Cuando vuelva la señal te aviso en Inicio para leerla.");
    setTimeout(() => navegar("/"), 2500);
  }

  // Lee un documento: lo archiva y la IA extrae los datos. Si viene de la bandeja, retoma lo ya hecho.
  async function leer(blob, tipo, nombre, item) {
    setFase("leyendo");
    if (tipo !== "application/pdf") setVista(URL.createObjectURL(blob));
    let docId = item?.documento_id || null;
    try {
      // 1) Guardar el original (FLUJO-049: todo queda archivado)
      if (!docId) {
        docId = (await subirDocumento(empresaId, "albaranes", blob, tipo, nombre, "albaran")).documento_id;
        if (item) await actualizarBandeja(item.id, { documento_id: docId });
      }
      setDocumentoId(docId);
      // 2) Lectura con IA
      let res = item?.resultado;
      if (!res) {
        res = await apiPost("/api/escanear", { empresa_id: empresaId, base64: await blobABase64(blob), media_type: tipo });
        if (docId) await supabase.from("documentos").update({ estado_ia: "procesado", datos_extraidos: res }).eq("id", docId);
        if (docId && ["albaran", "factura", "ticket"].includes(res.tipo_documento)) await supabase.from("documentos").update({ tipo: res.tipo_documento }).eq("id", docId);
        if (item) await actualizarBandeja(item.id, { resultado: res });
      }
      setDoc(aPropuesta(res));
      setFase("revisar");
    } catch (err) {
      if (!item && !docId && esFalloDeRed(err)) return guardarEnBandeja(blob, tipo, nombre);
      notificar(esFalloDeRed(err) ? "Se ha cortado la conexión. Vuelve a intentarlo cuando tengas señal." : err.message, "error");
      setFase("inicio");
    }
  }

  async function procesar(e) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const esPdf = f.type === "application/pdf";
    if (esPdf && f.size > 3.5 * 1024 * 1024) return notificar("El PDF es demasiado grande (máx. 3,5 MB). Haz una foto del albarán.", "error");
    const { blob, tipo } = esPdf ? { blob: f, tipo: f.type } : await comprimirImagen(f, 2000, 0.85);
    setBandejaId(null);
    if (!navigator.onLine) return guardarEnBandeja(blob, tipo, f.name);
    leer(blob, tipo, f.name, null);
  }

  // Foto guardada sin cobertura → se lee ahora
  const iniciado = useRef(false);
  useEffect(() => {
    const id = q.get("bandeja");
    if (!id || !online || !empresaId || iniciado.current) return;
    iniciado.current = true;
    leerDeBandeja(id).then((it) => {
      if (!it || it.tipo !== "compra") return notificar("Esa foto ya estaba registrada");
      setBandejaId(it.id);
      leer(it.blob, it.mime, it.nombre, it);
    });
  }, [online, empresaId]); // eslint-disable-line

  if (!esGestor) return <Pagina titulo="Escanear documento">Esta función es para el titular o el encargado.</Pagina>;

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
              if (bandejaId) await quitarDeBandeja(bandejaId);
              await recargar();
              notificar(m);
              navegar("/economia");
            }}
          />
          {bandejaId ? (
            <Boton
              variante="secundario"
              className="w-full"
              onClick={async () => {
                await quitarDeBandeja(bandejaId);
                notificar("Foto descartada");
                navegar("/");
              }}
            >
              Descartar esta foto
            </Boton>
          ) : (
            <Boton variante="secundario" className="w-full" onClick={() => setFase("inicio")}>
              Repetir la foto
            </Boton>
          )}
        </div>
      )}
    </Pagina>
  );
}
