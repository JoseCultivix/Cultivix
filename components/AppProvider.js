"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { supabase, supabaseConfigurado } from "@/lib/supabase";
import { detectarRecinto, posicionActual } from "@/lib/geo";
import { guardarCache, leerCache, leerCola, sincronizar } from "@/lib/offline";

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

const GESTORES = ["propietario", "administrador", "encargado"];

export default function AppProvider({ children }) {
  const [sesion, setSesion] = useState(undefined); // undefined = comprobando
  const [perfil, setPerfil] = useState(null);
  const [empresas, setEmpresas] = useState(null);
  const [empresaId, setEmpresaId] = useState(null);
  const [cat, setCat] = useState({ recintos: [], labores: [], maquinaria: [], aperos: [], trabajadores: [], productos: [], campana: null, campanas: [], cultivos: [] });
  const [gps, setGps] = useState(null);
  const [online, setOnline] = useState(true);
  const [pendientes, setPendientes] = useState(0);
  const [aviso, setAviso] = useState(null);
  const [errorCarga, setErrorCarga] = useState(null);
  const [esAdminPlataforma, setEsAdminPlataforma] = useState(false);
  const avisoTimer = useRef(null);

  const notificar = useCallback((texto, tipo = "ok") => {
    setAviso({ texto, tipo });
    clearTimeout(avisoTimer.current);
    avisoTimer.current = setTimeout(() => setAviso(null), 3500);
  }, []);

  // ---------- sesión ----------
  useEffect(() => {
    if (!supabaseConfigurado) {
      setSesion(null);
      return;
    }
    supabase.auth.getSession().then(({ data }) => setSesion(data.session || null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSesion(s || null));
    return () => sub.subscription.unsubscribe();
  }, []);

  // ---------- perfil y empresas ----------
  const cargarEmpresas = useCallback(async () => {
    if (!sesion) return;
    const uid = sesion.user.id;
    const cache = leerCache("empresas:" + uid);
    if (cache) {
      setEmpresas(cache.empresas);
      setPerfil(cache.perfil);
      setEmpresaId((prev) => prev || cache.activa);
    }
    try {
      setErrorCarga(null);
      await supabase.rpc("aceptar_invitaciones");
      supabase.rpc("registrar_acceso").then(() => {});
      supabase.rpc("es_admin_plataforma").then(({ data }) => setEsAdminPlataforma(!!data));
      const [{ data: p }, { data: eu, error }] = await Promise.all([
        supabase.from("usuarios").select("*").eq("id", uid).maybeSingle(),
        supabase.from("empresa_usuarios").select("rol, empresa_id, empresas(id, nombre)").eq("usuario_id", uid).eq("activo", true),
      ]);
      if (error) throw error;
      const lista = (eu || []).map((x) => ({ id: x.empresa_id, nombre: x.empresas?.nombre, rol: x.rol }));
      const activa = lista.find((e) => e.id === p?.empresa_activa_id)?.id || lista[0]?.id || null;
      setPerfil(p);
      setEmpresas(lista);
      setEmpresaId((prev) => (prev && lista.some((e) => e.id === prev) ? prev : activa));
      guardarCache("empresas:" + uid, { empresas: lista, perfil: p, activa });
    } catch (e) {
      // Nunca deducir "no tiene empresa" de un fallo de red: se mandaría a crear otra
      if (!cache) setErrorCarga(e?.message || "Sin conexión");
    }
  }, [sesion]);

  useEffect(() => {
    if (sesion) cargarEmpresas();
    if (sesion === null) {
      setEmpresas(null);
      setPerfil(null);
      setEmpresaId(null);
    }
  }, [sesion, cargarEmpresas]);

  const empresa = useMemo(() => empresas?.find((e) => e.id === empresaId) || null, [empresas, empresaId]);
  const rol = empresa?.rol || null;
  const esGestor = GESTORES.includes(rol);

  // ---------- catálogos ----------
  const recargar = useCallback(async () => {
    if (!empresaId) return;
    const cache = leerCache("cat:" + empresaId);
    if (cache) setCat(cache);
    try {
      const [rec, lab, maq, ape, tra, pro, camp, cul] = await Promise.all([
        supabase
          .from("recintos")
          .select("*, parcelas(nombre, finca_id, fincas(nombre)), recinto_cultivos(campana_id, cultivo_id, variedad, cultivos(nombre))")
          .eq("empresa_id", empresaId)
          .eq("activo", true),
        supabase.from("labores").select("*").eq("empresa_id", empresaId).eq("activa", true).order("nombre"),
        supabase.from("maquinaria").select("*").eq("empresa_id", empresaId).eq("activa", true).order("nombre"),
        supabase.from("aperos").select("*").eq("empresa_id", empresaId).eq("activo", true).order("nombre"),
        supabase.from("trabajadores").select("*").eq("empresa_id", empresaId).eq("activo", true).order("nombre"),
        supabase.from("productos").select("*").eq("empresa_id", empresaId).eq("activo", true).order("nombre"),
        supabase.from("campanas").select("*, cultivos(nombre)").eq("empresa_id", empresaId).order("fecha_inicio", { ascending: false }),
        supabase.from("cultivos").select("*").or(`empresa_id.is.null,empresa_id.eq.${empresaId}`).order("nombre"),
      ]);
      if (rec.error) throw rec.error;
      // Cada cultivo tiene su campaña; "campana" = la activa más reciente (compatibilidad)
      const campanas = (camp.data || []).map((c) => ({ ...c, cultivo_nombre: c.cultivos?.nombre || null }));
      const activas = new Set(campanas.filter((c) => c.activa).map((c) => c.id));
      const campana = campanas.find((c) => c.activa) || null;
      const porParcela = {};
      for (const r of rec.data || []) porParcela[r.parcela_id] = (porParcela[r.parcela_id] || 0) + 1;
      const recintos = (rec.data || [])
        .map((r) => {
          const rc = (r.recinto_cultivos || []).find((x) => activas.has(x.campana_id)) || r.recinto_cultivos?.[0];
          return {
            ...r,
            parcela_nombre: r.parcelas?.nombre,
            finca_nombre: r.parcelas?.fincas?.nombre,
            cultivo: rc?.cultivos?.nombre || null,
            cultivo_id: rc?.cultivo_id || null,
            variedad: rc?.variedad || null,
            n_en_parcela: porParcela[r.parcela_id],
          };
        })
        .sort((a, b) => (a.parcela_nombre || "").localeCompare(b.parcela_nombre || "") || (a.recinto_sigpac || 0) - (b.recinto_sigpac || 0));
      let productos = pro.data || [];
      if (esGestor) {
        const { data: st } = await supabase.from("v_stock_productos").select("producto_id, stock, ultima_compra, precio_medio").eq("empresa_id", empresaId);
        const m = Object.fromEntries((st || []).map((s) => [s.producto_id, s]));
        productos = productos.map((p) => ({ ...p, ...m[p.id] }));
      }
      const nuevo = {
        recintos,
        labores: lab.data || [],
        maquinaria: maq.data || [],
        aperos: ape.data || [],
        trabajadores: tra.data || [],
        productos,
        campana,
        campanas,
        cultivos: cul.data || [],
      };
      setCat(nuevo);
      guardarCache("cat:" + empresaId, nuevo);
    } catch (e) {
      console.warn("Sin conexión, usando datos guardados", e?.message);
    }
  }, [empresaId, esGestor]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  const cambiarEmpresa = useCallback(
    async (id) => {
      setEmpresaId(id);
      if (sesion) await supabase.from("usuarios").update({ empresa_activa_id: id }).eq("id", sesion.user.id);
    },
    [sesion]
  );

  // ---------- GPS ----------
  const actualizarGps = useCallback(async () => {
    const p = await posicionActual();
    if (p) setGps(p);
    return p;
  }, []);

  useEffect(() => {
    if (!empresaId) return;
    actualizarGps();
    const t = setInterval(actualizarGps, 120000);
    return () => clearInterval(t);
  }, [empresaId, actualizarGps]);

  const deteccion = useMemo(() => (gps ? detectarRecinto(cat.recintos, gps.lat, gps.lon) : null), [gps, cat.recintos]);

  // ---------- conexión y cola offline ----------
  useEffect(() => {
    const act = () => setPendientes(leerCola().length);
    const on = async () => {
      setOnline(true);
      const n = await sincronizar();
      if (n) notificar(`${n} registro(s) sincronizados`);
      act();
    };
    const off = () => setOnline(false);
    setOnline(navigator.onLine);
    act();
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    window.addEventListener("cultivix-cola", act);
    if (navigator.onLine) on();
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      window.removeEventListener("cultivix-cola", act);
    };
  }, [notificar, sesion]);

  // ---------- service worker (app instalable y abre sin cobertura) ----------
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  const valor = {
    sesion,
    perfil,
    empresas,
    empresa,
    empresaId,
    rol,
    esGestor,
    cambiarEmpresa,
    cargarEmpresas,
    errorCarga,
    esAdminPlataforma,
    ...cat,
    recargar,
    gps,
    deteccion,
    actualizarGps,
    online,
    pendientes,
    notificar,
  };

  return (
    <Ctx.Provider value={valor}>
      {children}
      {aviso && (
        <div
          role="status"
          className={`fixed left-1/2 top-4 z-[60] w-[92%] max-w-md -translate-x-1/2 rounded-2xl px-4 py-3 text-center text-base font-semibold shadow-lg ${
            aviso.tipo === "error" ? "bg-red-700 text-white" : "bg-olivo-800 text-white"
          }`}
        >
          {aviso.texto}
        </div>
      )}
    </Ctx.Provider>
  );
}
