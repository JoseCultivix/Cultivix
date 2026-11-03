"use client";
// Navegación pensada para el botón «atrás» del móvil:
//  - Desde cualquier pantalla, «atrás» vuelve a Inicio.
//  - En Inicio, «atrás» cierra la app (sin cerrar sesión).
// Para ello el historial siempre es [Inicio, pantalla actual]: al ir de una
// pantalla a otra se reemplaza la entrada en vez de apilarla.
import { useCallback, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

const CLAVE = "cultivix.nav.bajoInicio";
const leer = () => {
  try {
    return sessionStorage.getItem(CLAVE) === "1";
  } catch {
    return false;
  }
};
const marcar = (v) => {
  try {
    v ? sessionStorage.setItem(CLAVE, "1") : sessionStorage.removeItem(CLAVE);
  } catch {}
};

// Ventanas emergentes (Hoja): ocupan una entrada del historial para que
// «atrás» las cierre en lugar de salir de la pantalla.
let retrocediendo = false;
export function abrirEntradaHoja() {
  window.history.pushState({ ...(window.history.state || {}), hoja: true }, "");
}
export function cerrarEntradaHoja() {
  if (retrocediendo || !window.history.state?.hoja) return;
  retrocediendo = true;
  const fin = () => {
    window.removeEventListener("popstate", fin);
    retrocediendo = false;
  };
  window.addEventListener("popstate", fin);
  window.history.back();
}
function trasCerrarHoja(fn) {
  if (!window.history.state?.hoja && !retrocediendo) return fn();
  const seguir = () => {
    window.removeEventListener("popstate", seguir);
    retrocediendo = false;
    setTimeout(fn, 0);
  };
  window.addEventListener("popstate", seguir);
  if (!retrocediendo) {
    retrocediendo = true;
    window.history.back();
  }
}

export function useNavegar() {
  const router = useRouter();
  return useCallback(
    (href) => trasCerrarHoja(() => {
      const destino = new URL(href, window.location.href);
      const ruta = destino.pathname;
      const actual = window.location.pathname;
      const url = destino.pathname + destino.search + destino.hash;
      if (ruta === actual) return router.replace(url);
      if (actual === "/") {
        marcar(true);
        return router.push(url);
      }
      if (ruta === "/" && !destino.search) {
        if (leer()) {
          marcar(false);
          return router.back();
        }
        return router.replace("/");
      }
      return router.replace(url);
    }),
    [router],
  );
}

/** Se monta una vez en el layout: intercepta los enlaces internos. */
export function NavegacionMovil() {
  const navegar = useNavegar();
  const ruta = usePathname();

  useEffect(() => {
    if (ruta === "/") marcar(false);
  }, [ruta]);

  useEffect(() => {
    function alPulsar(e) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target.closest?.("a[href]");
      if (!a || a.target || a.hasAttribute("download")) return;
      const href = a.getAttribute("href");
      if (!href || href.startsWith("#") || /^(mailto|tel|sms):/i.test(href)) return;
      const url = new URL(href, window.location.href);
      if (url.origin !== window.location.origin) return;
      e.preventDefault();
      navegar(url.pathname + url.search + url.hash);
    }
    document.addEventListener("click", alPulsar, true);
    return () => document.removeEventListener("click", alPulsar, true);
  }, [navegar]);

  return null;
}
