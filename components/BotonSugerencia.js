"use client";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useApp } from "./AppProvider";
import { Boton, Fichas, Hoja, claseInput } from "./ui";
import { useVoz } from "./useVoz";

const TIPOS = [
  { value: "sugerencia", label: "💡 Sugerencia" },
  { value: "error", label: "🐞 Algo falla" },
  { value: "duda", label: "❓ No entiendo algo" },
  { value: "idea", label: "✨ Echo en falta…" },
];

/** Botón flotante para enviar opiniones desde cualquier pantalla (se guarda en qué pantalla estabas). */
export default function BotonSugerencia({ comoEnlace = false }) {
  const { empresaId, notificar, online } = useApp();
  const ruta = usePathname();
  const [abierta, setAbierta] = useState(false);
  const [tipo, setTipo] = useState("sugerencia");
  const [texto, setTexto] = useState("");
  const [nota, setNota] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const voz = useVoz({ onFinal: (t) => setTexto((x) => (x ? x + " " : "") + t) });

  async function enviar() {
    setEnviando(true);
    const { error } = await supabase.from("sugerencias").insert({
      empresa_id: empresaId,
      tipo,
      texto: texto.trim(),
      valoracion: nota,
      pantalla: ruta,
      dispositivo: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 200) : null,
    });
    setEnviando(false);
    if (error) return notificar(online ? error.message : "Sin cobertura: inténtalo cuando tengas señal", "error");
    setAbierta(false);
    setTexto("");
    setNota(null);
    notificar("¡Gracias! Lo leeremos con atención 🙌");
  }

  return (
    <>
      {comoEnlace ? (
        <button type="button" onClick={() => setAbierta(true)} className="flex min-h-24 w-full flex-col justify-center rounded-2xl bg-white p-4 text-left shadow-sm active:bg-olivo-50">
          <span className="text-3xl">💬</span>
          <span className="mt-1 text-[17px] font-extrabold leading-tight text-olivo-900">Enviar sugerencia</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setAbierta(true)}
          className="no-print fixed right-3 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-30 flex h-12 items-center gap-1.5 rounded-full bg-tierra-600 px-4 text-sm font-bold text-white shadow-lg active:scale-95"
          aria-label="Enviar sugerencia"
        >
          💬 <span className="hidden sm:inline">Sugerencia</span>
        </button>
      )}
      <Hoja abierta={abierta} onCerrar={() => setAbierta(false)} titulo="Ayúdanos a mejorar">
        <div className="space-y-4">
          <Fichas opciones={TIPOS} valor={tipo} onCambio={(v) => setTipo(v || "sugerencia")} />
          <div className="relative">
            <textarea
              className={`${claseInput} min-h-32`}
              placeholder={tipo === "error" ? "¿Qué estabas haciendo y qué ha pasado?" : "Cuéntanos con tus palabras…"}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              maxLength={4000}
            />
            {voz.disponible && (
              <button
                type="button"
                onClick={voz.escuchando ? voz.parar : voz.empezar}
                className={`absolute right-2 bottom-2 h-11 w-11 rounded-full text-xl ${voz.escuchando ? "animate-pulse bg-red-600 text-white" : "bg-olivo-100"}`}
                aria-label="Dictar"
              >
                🎤
              </button>
            )}
          </div>
          <div>
            <p className="mb-2 text-sm font-semibold text-stone-700">¿Qué te parece Cultivix hasta ahora? (opcional)</p>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" onClick={() => setNota(nota === n ? null : n)} className={`h-11 flex-1 rounded-xl text-xl ${nota && n <= nota ? "bg-amber-100" : "bg-white"}`}>
                  {nota && n <= nota ? "⭐" : "☆"}
                </button>
              ))}
            </div>
          </div>
          <p className="text-xs text-stone-500">Se envía junto con la pantalla en la que estás, para entenderlo mejor.</p>
          <Boton grande className="w-full" disabled={!texto.trim() || enviando} onClick={enviar}>
            {enviando ? "Enviando…" : "Enviar"}
          </Boton>
        </div>
      </Hoja>
    </>
  );
}
