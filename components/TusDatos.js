"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useApp } from "./AppProvider";
import { Boton, Hoja, Input, Seccion, Tarjeta } from "./ui";

/** Derechos RGPD: acceso/portabilidad (descarga) y supresión (borrado). */
export default function TusDatos({ esAdmin, esPropietario }) {
  const { empresaId, empresa, notificar } = useApp();
  const router = useRouter();
  const [hoja, setHoja] = useState(null); // 'empresa' | 'cuenta'
  const [conf, setConf] = useState("");
  const [trabajando, setTrabajando] = useState(false);

  async function descargar() {
    setTrabajando(true);
    const { data, error } = await supabase.rpc("exportar_datos_empresa", { p_empresa: empresaId });
    setTrabajando(false);
    if (error) return notificar(error.message, "error");
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `cultivix-${(empresa?.nombre || "datos").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\W+/g, "-")}-${new Date().toISOString().slice(0, 10)}.json` });
    a.click();
    URL.revokeObjectURL(url);
    notificar("Datos descargados ✓");
  }

  async function borrarArchivos() {
    const rutas = new Set();
    const [d, f, m] = await Promise.all([
      supabase.from("documentos").select("archivo_path").eq("empresa_id", empresaId),
      supabase.from("fotografias").select("archivo_path").eq("empresa_id", empresaId),
      supabase.from("maquinaria_documentos").select("archivo_path").eq("empresa_id", empresaId),
    ]);
    for (const r of [...(d.data || []), ...(f.data || []), ...(m.data || [])]) if (r.archivo_path) rutas.add(r.archivo_path);
    const lista = [...rutas];
    for (let i = 0; i < lista.length; i += 100) await supabase.storage.from("documentos").remove(lista.slice(i, i + 100));
  }

  async function borrar() {
    setTrabajando(true);
    try {
      if (hoja === "empresa") {
        await borrarArchivos();
        const { error } = await supabase.rpc("eliminar_empresa", { p_empresa: empresaId, p_confirmacion: conf.trim().toUpperCase() });
        if (error) throw error;
        localStorage.clear();
        notificar("Explotación borrada");
        window.location.href = "/";
      } else {
        const { error } = await supabase.rpc("eliminar_mi_cuenta", { p_confirmacion: conf.trim().toUpperCase() });
        if (error) throw error;
        await supabase.auth.signOut();
        localStorage.clear();
        router.replace("/login");
      }
    } catch (e) {
      notificar(e.message, "error");
    } finally {
      setTrabajando(false);
    }
  }

  return (
    <Seccion titulo="Tus datos y privacidad">
      <Tarjeta className="space-y-3">
        <p className="text-[15px] text-stone-700">
          Tus datos son tuyos. Consulta la <Link href="/privacidad" className="font-semibold text-olivo-700 underline">política de privacidad</Link> y las{" "}
          <Link href="/terminos" className="font-semibold text-olivo-700 underline">condiciones</Link>.
        </p>
        {esAdmin && (
          <Boton variante="secundario" className="w-full" disabled={trabajando} onClick={descargar}>
            ⬇️ Descargar todos los datos de la explotación
          </Boton>
        )}
        {esPropietario && (
          <Boton variante="peligro" className="w-full" onClick={() => { setConf(""); setHoja("empresa"); }}>
            Borrar esta explotación
          </Boton>
        )}
        <Boton variante="peligro" className="w-full" onClick={() => { setConf(""); setHoja("cuenta"); }}>
          Borrar mi cuenta
        </Boton>
      </Tarjeta>
      <Hoja abierta={!!hoja} onCerrar={() => setHoja(null)} titulo={hoja === "empresa" ? "Borrar la explotación" : "Borrar mi cuenta"}>
        <div className="space-y-4">
          <p className="text-[15px] text-stone-800">
            {hoja === "empresa"
              ? `Se borrarán para siempre «${empresa?.nombre}» y todos sus datos: parcelas, partes, cuaderno de campo, cosechas, compras, fotos y documentos. Los demás usuarios perderán el acceso.`
              : "Se borrará tu cuenta y tu acceso. Los partes que hayas registrado se quedan en la explotación para la que trabajas."}
          </p>
          <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">La normativa puede obligar a conservar el cuaderno de campo varios años. Descarga tus datos antes.</p>
          <Input placeholder="Escribe BORRAR para confirmar" value={conf} onChange={(e) => setConf(e.target.value)} />
          <Boton variante="peligro" grande className="w-full" disabled={conf.trim().toUpperCase() !== "BORRAR" || trabajando} onClick={borrar}>
            {trabajando ? "Borrando…" : "Borrar definitivamente"}
          </Boton>
        </div>
      </Hoja>
    </Seccion>
  );
}
