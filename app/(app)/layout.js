"use client";
import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useApp } from "@/components/AppProvider";
import { Cargando } from "@/components/ui";

const NAV = [
  { href: "/", icono: "🏠", texto: "Inicio" },
  { href: "/asistente", icono: "🎤", texto: "Asistente" },
  { href: "/mapa", icono: "🗺️", texto: "Mapa" },
  { href: "/economia", icono: "💶", texto: "Economía", gestor: true },
  { href: "/mas", icono: "☰", texto: "Más" },
];

export default function AppLayout({ children }) {
  const { sesion, empresas, empresa, esGestor, online, pendientes, errorCarga, cargarEmpresas } = useApp();
  const router = useRouter();
  const ruta = usePathname();

  useEffect(() => {
    if (sesion === null) router.replace("/login");
    else if (sesion && empresas && empresas.length === 0) router.replace("/onboarding");
  }, [sesion, empresas, router]);

  if (sesion && !empresas && errorCarga)
    return (
      <div className="mx-auto max-w-sm px-6 py-20 text-center">
        <p className="text-4xl">📡</p>
        <p className="mt-3 text-lg font-bold">No se ha podido conectar</p>
        <p className="mt-1 text-stone-600">Comprueba la cobertura e inténtalo de nuevo.</p>
        <button type="button" onClick={cargarEmpresas} className="mt-5 rounded-2xl bg-olivo-700 px-6 py-3 font-bold text-white">
          Reintentar
        </button>
      </div>
    );
  if (!sesion || !empresas || !empresa) return <Cargando texto="Abriendo Cultivix…" />;

  const items = NAV.filter((n) => !n.gestor || esGestor);
  return (
    <>
      {(!online || pendientes > 0) && (
        <div className="no-print sticky top-0 z-40 bg-amber-500 px-4 py-1.5 text-center text-sm font-bold text-white">
          {!online ? "Sin cobertura · lo que registres se guardará en el móvil" : `Enviando ${pendientes} registro(s) pendiente(s)…`}
        </div>
      )}
      <main>{children}</main>
      <nav className="no-print fixed inset-x-0 bottom-0 z-40 border-t border-stone-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <ul className={`mx-auto grid max-w-2xl ${items.length === 5 ? "grid-cols-5" : "grid-cols-4"}`}>
          {items.map((n) => {
            const activo = n.href === "/" ? ruta === "/" : ruta.startsWith(n.href);
            return (
              <li key={n.href}>
                <Link href={n.href} className={`flex h-16 flex-col items-center justify-center gap-0.5 text-xs font-bold ${activo ? "text-olivo-800" : "text-stone-500"}`}>
                  <span className={`text-xl leading-none ${activo ? "" : "grayscale opacity-70"}`}>{n.icono}</span>
                  {n.texto}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
