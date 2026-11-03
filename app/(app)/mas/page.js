"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useApp } from "@/components/AppProvider";
import { Pagina } from "@/components/ui";
import BotonSugerencia from "@/components/BotonSugerencia";

export default function Mas() {
  const { esGestor, empresas, empresa, cambiarEmpresa, perfil, rol, esAdminPlataforma } = useApp();
  const router = useRouter();
  const items = [
    ["/partes", "📋", esGestor ? "Partes de trabajo" : "Mis partes", true],
    ["/cosechas", "🧺", "Cosechas", true],
    ["/parcelas", "🗺️", "Parcelas y SIGPAC", true],
    ["/maquinaria", "🚜", "Maquinaria y aperos", true],
    ["/productos", "🧴", "Productos y stock", true],
    ["/tecnico", "🧑‍🌾", "Mis explotaciones", empresas?.length > 1 || rol === "tecnico"],
    ["/agronomia", "🌿", "AgronomIA", true],
    ["/plazos", "⏳", "Plazos de seguridad", true],
    ["/cuaderno", "📒", "Cuaderno de campo", esGestor || rol === "tecnico"],
    ["/fertilizacion", "🌾", "Fertilización", esGestor || rol === "tecnico"],
    ["/escanear", "📄", "Escanear albarán", esGestor],
    ["/economia", "💶", "Economía", esGestor],
    ["/foto", "📷", "Foto de campo", true],
    ["/ajustes", "⚙️", "Ajustes y equipo", true],
    ["/admin", "📊", "Panel de la beta", esAdminPlataforma],
  ].filter((x) => x[3]);

  return (
    <Pagina titulo="Más" subtitulo={`${perfil?.nombre || ""} · ${rol}`}>
      <div className="grid grid-cols-2 gap-3">
        {items.map(([href, ic, t]) => (
          <Link key={href} href={href} className="flex min-h-24 flex-col justify-center rounded-2xl bg-white p-4 shadow-sm active:bg-olivo-50">
            <span className="text-3xl">{ic}</span>
            <span className="mt-1 text-[17px] font-extrabold leading-tight text-olivo-900">{t}</span>
          </Link>
        ))}
        <BotonSugerencia comoEnlace />
      </div>
      {empresas?.length > 1 && (
        <div className="mt-6">
          <p className="mb-2 text-sm font-bold uppercase text-stone-500">Cambiar de empresa</p>
          <div className="space-y-2">
            {empresas.map((e) => (
              <button key={e.id} type="button" onClick={() => cambiarEmpresa(e.id)} className={`block w-full rounded-2xl p-3 text-left font-bold ${e.id === empresa?.id ? "bg-olivo-700 text-white" : "bg-white"}`}>
                {e.nombre} <span className="text-sm font-normal opacity-80">· {e.rol}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={async () => {
          await supabase.auth.signOut();
          localStorage.removeItem("cultivix.trabajoEnCurso");
          router.replace("/login");
        }}
        className="mt-8 w-full rounded-2xl border-2 border-stone-200 py-3 font-bold text-stone-600"
      >
        Cerrar sesión
      </button>
      <p className="mt-6 text-center text-sm text-stone-500">
        <Link href="/privacidad" className="underline">Privacidad</Link> · <Link href="/terminos" className="underline">Condiciones de uso</Link>
      </p>
    </Pagina>
  );
}
