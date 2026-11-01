"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useApp } from "@/components/AppProvider";
import { comprimirImagen } from "@/lib/imagen";
import { detectarRecinto } from "@/lib/geo";
import { nombreRecinto } from "@/lib/formato";
import { Boton, Fichas, Input, Pagina } from "@/components/ui";

const TIPOS = ["Seguimiento", "Plaga", "Enfermedad", "Daño (helada, granizo…)", "Riego", "Maquinaria"];

export default function Foto() {
  const { empresaId, recintos, actualizarGps, notificar } = useApp();
  const router = useRouter();
  const input = useRef(null);
  const [foto, setFoto] = useState(null);
  const [vista, setVista] = useState(null);
  const [pos, setPos] = useState(null);
  const [recintoId, setRecintoId] = useState(null);
  const [tipo, setTipo] = useState("Seguimiento");
  const [nota, setNota] = useState("");
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    input.current?.click();
  }, []);

  async function elegir(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFoto(f);
    setVista(URL.createObjectURL(f));
    const p = await actualizarGps();
    setPos(p);
    const d = p && detectarRecinto(recintos, p.lat, p.lon);
    if (d) setRecintoId(d.recinto.id);
  }

  async function guardar() {
    setGuardando(true);
    try {
      const { blob } = await comprimirImagen(foto);
      const ruta = `${empresaId}/fotos/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.jpg`;
      const up = await supabase.storage.from("documentos").upload(ruta, blob, { contentType: "image/jpeg" });
      if (up.error) throw up.error;
      const { data: ft, error } = await supabase
        .from("fotografias")
        .insert({ empresa_id: empresaId, archivo_path: ruta, lat: pos?.lat, lon: pos?.lon, recinto_id: recintoId, descripcion: nota || tipo })
        .select("id")
        .single();
      if (error) throw error;
      if (tipo !== "Seguimiento" || nota) {
        await supabase.from("observaciones_agronomicas").insert({
          empresa_id: empresaId,
          recinto_id: recintoId,
          tipo: tipo.split(" ")[0].toLowerCase(),
          descripcion: nota || tipo,
          fotografia_id: ft.id,
        });
      }
      notificar("Foto guardada ✓");
      router.push("/");
    } catch (e) {
      notificar("No se pudo subir la foto: " + e.message, "error");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Pagina titulo="Foto de campo" subtitulo="Se guarda con la ubicación y la parcela, para tu histórico.">
      <input ref={input} type="file" accept="image/*" capture="environment" className="hidden" onChange={elegir} />
      {!vista ? (
        <Boton grande className="w-full !min-h-40 !text-2xl" onClick={() => input.current?.click()}>
          📷 Hacer foto
        </Boton>
      ) : (
        <div className="space-y-4">
          <img src={vista} alt="" className="max-h-80 w-full rounded-2xl object-cover" />
          <div>
            <p className="mb-2 text-sm font-bold text-stone-700">Parcela {pos ? "" : "(sin GPS)"}</p>
            <Fichas opciones={recintos.map((r) => ({ value: r.id, label: nombreRecinto(r, r.n_en_parcela) }))} valor={recintoId} onCambio={setRecintoId} />
          </div>
          <div>
            <p className="mb-2 text-sm font-bold text-stone-700">¿Qué es?</p>
            <Fichas opciones={TIPOS.map((t) => ({ value: t, label: t }))} valor={tipo} onCambio={(v) => setTipo(v || "Seguimiento")} />
          </div>
          <Input placeholder="Nota (opcional)" value={nota} onChange={(e) => setNota(e.target.value)} />
          <div className="flex gap-3">
            <Boton variante="secundario" grande onClick={() => input.current?.click()}>
              Repetir
            </Boton>
            <Boton grande className="flex-1" disabled={guardando} onClick={guardar}>
              {guardando ? "Subiendo…" : "Guardar foto"}
            </Boton>
          </div>
        </div>
      )}
    </Pagina>
  );
}
