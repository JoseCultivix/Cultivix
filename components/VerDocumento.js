"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/lib/supabase";
import { abrirEntradaHoja, cerrarEntradaHoja } from "@/lib/navegacion";

/** Botón que abre a pantalla completa la foto o el PDF archivado de un documento (ticket, albarán…). */
export default function VerDocumento({ documentoId, texto = "👁️ Ver ticket", className = "" }) {
  const [abierto, setAbierto] = useState(false);
  const [doc, setDoc] = useState(null); // { url, pdf, nombre } | { error }

  async function abrir(e) {
    e?.stopPropagation();
    setAbierto(true);
    setDoc(null);
    const { data, error } = await supabase.from("documentos").select("archivo_path, mime_type, nombre").eq("id", documentoId).maybeSingle();
    if (error || !data?.archivo_path) return setDoc({ error: "No se encuentra el archivo." });
    const { data: s, error: e2 } = await supabase.storage.from("documentos").createSignedUrl(data.archivo_path, 3600);
    if (e2 || !s?.signedUrl) return setDoc({ error: "No se ha podido abrir el archivo. ¿Tienes conexión?" });
    setDoc({ url: s.signedUrl, pdf: (data.mime_type || "").includes("pdf") || data.archivo_path.endsWith(".pdf"), nombre: data.nombre });
  }

  if (!documentoId) return null;
  return (
    <>
      <button type="button" onClick={abrir} className={`inline-flex min-h-11 items-center justify-center gap-1 rounded-2xl border-2 border-olivo-200 bg-white px-4 font-bold text-olivo-800 ${className}`}>
        {texto}
      </button>
      {abierto && typeof document !== "undefined" && createPortal(<Visor doc={doc} onCerrar={() => setAbierto(false)} />, document.body)}
    </>
  );
}

function Visor({ doc, onCerrar }) {
  const cb = useRef(onCerrar);
  cb.current = onCerrar;
  // El botón atrás de Android cierra solo el visor (no la hoja que hay debajo)
  useEffect(() => {
    abrirEntradaHoja();
    window.__cultivixVisor = true;
    let porAtras = false;
    const alVolver = () => {
      porAtras = true;
      // Se deja la marca un instante para que la hoja de debajo ignore este mismo «atrás»
      setTimeout(() => (window.__cultivixVisor = false), 0);
      cb.current?.();
    };
    window.addEventListener("popstate", alVolver);
    return () => {
      window.removeEventListener("popstate", alVolver);
      if (!porAtras) {
        // Cierre con la ×: quitar la entrada del historial sin cerrar la hoja de debajo
        cerrarEntradaHoja();
        setTimeout(() => (window.__cultivixVisor = false), 300);
      }
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[3000] flex flex-col bg-black" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between gap-2 p-3">
        <p className="truncate text-sm text-white/80">{doc?.nombre || ""}</p>
        <div className="flex shrink-0 gap-2">
          {doc?.url && (
            <a href={doc.url} target="_blank" rel="noreferrer" className="rounded-full bg-white/15 px-4 py-2 text-sm font-bold text-white">
              Abrir / descargar
            </a>
          )}
          <button type="button" onClick={onCerrar} aria-label="Cerrar" className="h-10 w-10 rounded-full bg-white text-xl font-bold text-stone-700">
            ×
          </button>
        </div>
      </div>
      <div className="flex flex-1 items-center justify-center overflow-auto p-2" style={{ touchAction: "pinch-zoom" }}>
        {!doc && <p className="text-white/80">Cargando…</p>}
        {doc?.error && <p className="text-white">{doc.error}</p>}
        {doc?.url && !doc.pdf && <img src={doc.url} alt="Documento escaneado" className="max-h-full max-w-full object-contain" />}
        {doc?.url && doc.pdf && <iframe src={doc.url} title="Documento" className="h-full w-full rounded bg-white" />}
      </div>
    </div>
  );
}
