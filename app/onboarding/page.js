"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useApp } from "@/components/AppProvider";
import { Boton, Campo, Fichas, Input, Cargando } from "@/components/ui";

const CULTIVOS = ["Olivar", "Pistacho", "Almendro", "Espárrago verde", "Viñedo", "Cereal", "Cítricos", "Frutales", "Hortícolas"];
const MAQUINAS = ["Tractor principal", "Tractor pequeño", "Vibrador", "Quad", "Furgoneta"];
const APEROS = ["Cultivador", "Rastra", "Atomizador", "Cuba herbicida", "Desbrozadora", "Abonadora", "Remolque", "Kongskilde", "Mochila"];

export default function Onboarding() {
  const { sesion, empresas, cargarEmpresas, perfil } = useApp();
  const router = useRouter();
  const [paso, setPaso] = useState(1);
  const [nombre, setNombre] = useState("");
  const [provincia, setProvincia] = useState("");
  const [cultivos, setCultivos] = useState(["Olivar"]);
  const [maq, setMaq] = useState(["Tractor principal"]);
  const [aperos, setAperos] = useState([]);
  const [campana, setCampana] = useState("natural");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (sesion === null) router.replace("/login");
  }, [sesion, router]);

  useEffect(() => {
    if (perfil?.nombre && !nombre) setNombre(`Explotación ${perfil.nombre}`);
  }, [perfil]); // eslint-disable-line

  if (sesion === undefined || empresas === null) return <Cargando />;

  async function crear() {
    setGuardando(true);
    setError(null);
    const y = new Date().getFullYear();
    const inicio = campana === "olivar" ? `${y}-10-01` : `${y}-01-01`;
    const { error } = await supabase.rpc("crear_empresa", {
      p_nombre: nombre,
      p_provincia: provincia || null,
      p_municipio: null,
      p_cultivos: cultivos,
      p_maquinaria: maq,
      p_aperos: aperos,
      p_inicio_campana: inicio,
    });
    if (error) {
      setError(error.message);
      setGuardando(false);
      return;
    }
    await cargarEmpresas();
    router.replace("/parcelas?bienvenida=1");
  }

  return (
    <main className="mx-auto max-w-lg px-5 py-8">
      <p className="text-sm font-bold uppercase tracking-wide text-olivo-600">Paso {paso} de 3</p>
      {paso === 1 && (
        <>
          <h1 className="mt-1 text-3xl font-black text-olivo-900">Vamos a preparar tu explotación</h1>
          <p className="mt-2 text-stone-600">Solo lo imprescindible. Todo se puede cambiar después.</p>
          <div className="mt-6 space-y-4">
            <Campo etiqueta="Nombre de la explotación o empresa">
              <Input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Explotación Ibáñez" />
            </Campo>
            <Campo etiqueta="Provincia (opcional)">
              <Input value={provincia} onChange={(e) => setProvincia(e.target.value)} placeholder="Jaén" />
            </Campo>
            <div>
              <p className="mb-2 text-sm font-semibold text-stone-700">¿Qué cultivas?</p>
              <Fichas multiple opciones={CULTIVOS.map((c) => ({ value: c, label: c }))} valor={cultivos} onCambio={setCultivos} />
            </div>
          </div>
          <Boton grande className="mt-8 w-full" disabled={!nombre.trim() || !cultivos.length} onClick={() => setPaso(2)}>
            Siguiente
          </Boton>
        </>
      )}
      {paso === 2 && (
        <>
          <h1 className="mt-1 text-3xl font-black text-olivo-900">¿Con qué trabajas?</h1>
          <p className="mt-2 text-stone-600">Marca lo que tengas. Cultivix lo propondrá solo al registrar trabajos.</p>
          <p className="mb-2 mt-6 text-sm font-semibold text-stone-700">Maquinaria</p>
          <Fichas multiple opciones={MAQUINAS.map((c) => ({ value: c, label: c }))} valor={maq} onCambio={setMaq} />
          <p className="mb-2 mt-6 text-sm font-semibold text-stone-700">Aperos</p>
          <Fichas multiple opciones={APEROS.map((c) => ({ value: c, label: c }))} valor={aperos} onCambio={setAperos} />
          <div className="mt-8 flex gap-3">
            <Boton variante="secundario" grande onClick={() => setPaso(1)}>
              Atrás
            </Boton>
            <Boton grande className="flex-1" onClick={() => setPaso(3)}>
              Siguiente
            </Boton>
          </div>
        </>
      )}
      {paso === 3 && (
        <>
          <h1 className="mt-1 text-3xl font-black text-olivo-900">¿Cómo cuentas tu campaña?</h1>
          <p className="mt-2 text-stone-600">Todo el histórico se ordena por campañas.</p>
          <div className="mt-6 space-y-3">
            {[
              ["natural", "Año natural", "1 de enero – 31 de diciembre"],
              ["olivar", "Campaña oleícola", "1 de octubre – 30 de septiembre"],
            ].map(([k, t, d]) => (
              <button
                key={k}
                type="button"
                onClick={() => setCampana(k)}
                className={`w-full rounded-2xl border-2 p-4 text-left ${campana === k ? "border-olivo-700 bg-olivo-50" : "border-stone-200 bg-white"}`}
              >
                <p className="text-lg font-bold">{t}</p>
                <p className="text-stone-600">{d}</p>
              </button>
            ))}
          </div>
          {error && <p className="mt-4 rounded-xl bg-red-100 p-3 text-red-800">{error}</p>}
          <div className="mt-8 flex gap-3">
            <Boton variante="secundario" grande onClick={() => setPaso(2)}>
              Atrás
            </Boton>
            <Boton grande className="flex-1" disabled={guardando} onClick={crear}>
              {guardando ? "Creando…" : "Empezar"}
            </Boton>
          </div>
          <p className="mt-4 text-center text-sm text-stone-500">Después añadirás tus parcelas directamente desde SIGPAC.</p>
        </>
      )}
    </main>
  );
}
