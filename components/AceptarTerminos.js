"use client";
import { useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useApp } from "./AppProvider";
import { Boton } from "./ui";
import { VERSION_TERMINOS } from "@/lib/legal";

/** Se muestra a quien aún no ha aceptado la versión vigente de condiciones y privacidad. */
export default function AceptarTerminos() {
  const { cargarEmpresas, notificar } = useApp();
  const [acepto, setAcepto] = useState(false);
  const [guardando, setGuardando] = useState(false);

  async function aceptar() {
    setGuardando(true);
    const { error } = await supabase.rpc("aceptar_terminos", { p_version: VERSION_TERMINOS });
    if (error) {
      notificar(error.message, "error");
      setGuardando(false);
      return;
    }
    await cargarEmpresas();
  }

  return (
    <main className="mx-auto max-w-md px-5 py-10">
      <p className="text-4xl">🔒</p>
      <h1 className="mt-2 text-2xl font-black text-olivo-900">Tu privacidad, antes de seguir</h1>
      <p className="mt-2 text-stone-700">Cultivix está en fase de pruebas. En resumen:</p>
      <ul className="mt-3 space-y-2 text-[15px] text-stone-800">
        <li>✅ Tus datos son tuyos: solo se usan para que la app funcione. Ni se venden ni hay publicidad.</li>
        <li>✅ Cada explotación está aislada: nadie más puede verla.</li>
        <li>📍 El GPS es opcional y solo sirve para detectar la parcela donde trabajas.</li>
        <li>🤖 La IA propone; tú siempre confirmas antes de guardar.</li>
        <li>⬇️ Puedes descargar o borrar tus datos cuando quieras desde Ajustes.</li>
        <li>👷 Si tienes trabajadores, infórmales antes de invitarles.</li>
      </ul>
      <label className="mt-6 flex items-start gap-3 text-[15px]">
        <input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-olivo-700" checked={acepto} onChange={(e) => setAcepto(e.target.checked)} />
        <span>
          He leído y acepto las{" "}
          <Link href="/terminos" target="_blank" className="font-semibold text-olivo-700 underline">
            condiciones de uso
          </Link>{" "}
          y la{" "}
          <Link href="/privacidad" target="_blank" className="font-semibold text-olivo-700 underline">
            política de privacidad
          </Link>
          .
        </span>
      </label>
      <Boton grande className="mt-6 w-full" disabled={!acepto || guardando} onClick={aceptar}>
        {guardando ? "Un momento…" : "Aceptar y continuar"}
      </Boton>
    </main>
  );
}
