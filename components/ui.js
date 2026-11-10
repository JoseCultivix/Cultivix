"use client";
import { useEffect, useRef } from "react";
import Link from "next/link";
import { abrirEntradaHoja, cerrarEntradaHoja } from "@/lib/navegacion";

export function Pagina({ titulo, subtitulo, accion, children, volver }) {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-5 pb-nav print-full">
      {(titulo || accion) && (
        <header className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {volver && (
              <Link href={volver} className="no-print mb-1 inline-block text-sm font-semibold text-olivo-700">
                ← Volver
              </Link>
            )}
            {titulo && <h1 className="text-2xl font-extrabold tracking-tight text-olivo-900">{titulo}</h1>}
            {subtitulo && <p className="mt-0.5 text-[15px] text-stone-600">{subtitulo}</p>}
          </div>
          {accion && <div className="no-print shrink-0">{accion}</div>}
        </header>
      )}
      {children}
    </div>
  );
}

export function Tarjeta({ children, className = "", ...p }) {
  return (
    <div className={`rounded-2xl border border-stone-200 bg-white p-4 shadow-sm ${className}`} {...p}>
      {children}
    </div>
  );
}

const VARIANTES = {
  primario: "bg-olivo-700 text-white active:bg-olivo-800 disabled:bg-olivo-300",
  secundario: "bg-white text-olivo-800 border-2 border-olivo-200 active:bg-olivo-50",
  peligro: "bg-white text-red-700 border-2 border-red-200 active:bg-red-50",
  tierra: "bg-tierra-600 text-white active:bg-tierra-700",
  suave: "bg-olivo-50 text-olivo-800 active:bg-olivo-100",
};

export function Boton({ variante = "primario", grande, className = "", href, children, ...p }) {
  const cls = `inline-flex items-center justify-center gap-2 rounded-2xl font-bold transition disabled:opacity-60 ${
    grande ? "min-h-14 px-5 text-lg" : "min-h-11 px-4 text-[15px]"
  } ${VARIANTES[variante]} ${className}`;
  if (href)
    return (
      <Link href={href} className={cls}>
        {children}
      </Link>
    );
  return (
    <button type="button" className={cls} {...p}>
      {children}
    </button>
  );
}

export function Campo({ etiqueta, ayuda, children, className = "" }) {
  return (
    <label className={`block ${className}`}>
      {etiqueta && <span className="mb-1 block text-sm font-semibold text-stone-700">{etiqueta}</span>}
      {children}
      {ayuda && <span className="mt-1 block text-xs text-stone-500">{ayuda}</span>}
    </label>
  );
}

export const claseInput =
  "w-full rounded-xl border-2 border-stone-200 bg-white px-3 py-2.5 text-[17px] outline-none focus:border-olivo-500";

export function Input(p) {
  return <input {...p} className={`${claseInput} ${p.className || ""}`} />;
}

export function Select({ opciones = [], vacio = "—", ...p }) {
  return (
    <select {...p} className={`${claseInput} ${p.className || ""}`}>
      {vacio !== null && <option value="">{vacio}</option>}
      {opciones.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** Selección por fichas grandes (más rápido que un desplegable con el dedo). */
export function Fichas({ opciones, valor, onCambio, multiple = false, vacio = "No hay opciones" }) {
  if (!opciones?.length) return <p className="text-sm text-stone-500">{vacio}</p>;
  const sel = multiple ? new Set(valor || []) : new Set(valor ? [valor] : []);
  const pulsar = (v) => {
    if (multiple) {
      const n = new Set(sel);
      n.has(v) ? n.delete(v) : n.add(v);
      onCambio([...n]);
    } else onCambio(sel.has(v) ? null : v);
  };
  return (
    <div className="flex flex-wrap gap-2">
      {opciones.map((o) => {
        const on = sel.has(o.value);
        return (
          <button
            type="button"
            key={o.value}
            onClick={() => pulsar(o.value)}
            className={`min-h-11 rounded-full border-2 px-4 text-[15px] font-semibold transition ${
              on ? "border-olivo-700 bg-olivo-700 text-white" : "border-stone-200 bg-white text-stone-800"
            }`}
          >
            {on && "✓ "}
            {o.label}
            {o.extra && <span className={`ml-1 text-xs ${on ? "text-olivo-100" : "text-stone-500"}`}>{o.extra}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function Etiqueta({ children, color = "olivo" }) {
  const c = {
    olivo: "bg-olivo-100 text-olivo-800",
    tierra: "bg-tierra-100 text-tierra-700",
    gris: "bg-stone-100 text-stone-700",
    rojo: "bg-red-100 text-red-800",
    ambar: "bg-amber-100 text-amber-800",
  }[color];
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold ${c}`}>{children}</span>;
}

export function Vacio({ icono = "🌱", titulo, texto, children }) {
  return (
    <div className="rounded-2xl border-2 border-dashed border-stone-300 bg-white/60 px-5 py-8 text-center">
      <div className="text-4xl">{icono}</div>
      <p className="mt-2 text-lg font-bold text-stone-800">{titulo}</p>
      {texto && <p className="mx-auto mt-1 max-w-sm text-[15px] text-stone-600">{texto}</p>}
      {children && <div className="mt-4 flex flex-wrap justify-center gap-2">{children}</div>}
    </div>
  );
}

/** Hoja inferior (modal) cómoda para el pulgar */
export function Hoja({ abierta, onCerrar, titulo, children }) {
  const cb = useRef(onCerrar);
  cb.current = onCerrar;
  useEffect(() => {
    if (!abierta) return;
    abrirEntradaHoja();
    let porAtras = false;
    const alVolver = () => {
      if (window.__cultivixVisor) return; // el atrás es para el visor de documentos que hay encima
      porAtras = true;
      cb.current?.();
    };
    window.addEventListener("popstate", alVolver);
    return () => {
      window.removeEventListener("popstate", alVolver);
      if (!porAtras) cerrarEntradaHoja();
    };
  }, [abierta]);
  if (!abierta) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onCerrar}>
      <div
        className="max-h-[92dvh] w-full max-w-xl overflow-y-auto rounded-t-3xl bg-arena p-4 pb-8 shadow-2xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xl font-extrabold text-olivo-900">{titulo}</h2>
          <button type="button" onClick={onCerrar} className="h-10 w-10 rounded-full bg-white text-xl font-bold text-stone-600" aria-label="Cerrar">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Cargando({ texto = "Cargando…" }) {
  return (
    <div className="flex items-center justify-center gap-3 py-10 text-stone-500">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-olivo-300 border-t-olivo-700" />
      {texto}
    </div>
  );
}

export function Seccion({ titulo, accion, children, className = "" }) {
  return (
    <section className={`mt-6 ${className}`}>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-wide text-stone-500">{titulo}</h2>
        {accion}
      </div>
      {children}
    </section>
  );
}
