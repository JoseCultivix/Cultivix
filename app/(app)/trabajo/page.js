"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useNavegar } from "@/lib/navegacion";
import { useApp } from "@/components/AppProvider";
import ParteEditor, { habitualesDe } from "@/components/ParteEditor";
import { Boton, Pagina, Tarjeta } from "@/components/ui";
import { guardarParte, guardarTrabajoEnCurso, leerTrabajoEnCurso, nuevoIdLocal } from "@/lib/offline";
import { distancia, recintosDelRecorrido } from "@/lib/geo";
import { duracion, hora, nombreRecinto } from "@/lib/formato";

export default function PaginaTrabajo() {
  return (
    <Suspense>
      <Trabajo />
    </Suspense>
  );
}

function Trabajo() {
  const app = useApp();
  const { labores, recintos, esGestor, gps, deteccion, notificar, actualizarGps } = app;
  const router = useRouter();
  const navegar = useNavegar();
  const q = useSearchParams();
  const [enCurso, setEnCurso] = useState(null);
  const [modo, setModo] = useState(q.get("modo") === "hecho" ? "completo" : "iniciar");
  const [cerrando, setCerrando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [, tick] = useState(0);
  const watchRef = useRef(null);

  useEffect(() => {
    const leer = () => setEnCurso(leerTrabajoEnCurso());
    leer();
    window.addEventListener("cultivix-trabajo", leer);
    const t = setInterval(() => tick((x) => x + 1), 30000);
    return () => {
      window.removeEventListener("cultivix-trabajo", leer);
      clearInterval(t);
    };
  }, []);

  // Registro del recorrido GPS mientras la pantalla está abierta (DEC-013)
  useEffect(() => {
    if (!enCurso || !navigator.geolocation) return;
    watchRef.current = navigator.geolocation.watchPosition(
      (p) => {
        const t = leerTrabajoEnCurso();
        if (!t) return;
        const rec = t.recorrido || [];
        const ult = rec[rec.length - 1];
        const lon = +p.coords.longitude.toFixed(6), lat = +p.coords.latitude.toFixed(6);
        if (!ult || distancia(ult[1], ult[0], lat, lon) > 15 || Date.now() - ult[2] > 60000) {
          rec.push([lon, lat, Date.now()]);
          guardarTrabajoEnCurso({ ...t, recorrido: rec.slice(-2000) });
        }
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 15000 }
    );
    return () => navigator.geolocation.clearWatch(watchRef.current);
  }, [enCurso?.id_local]); // eslint-disable-line

  // Propuesta inicial desde la URL (asistente / botones de inicio)
  const laborQ = q.get("labor");
  const lab = labores.find((l) => l.id === laborQ);
  const inicial = {
    labor_id: lab?.id || null,
    ...habitualesDe(lab),
    recinto_ids: q.get("recintos") ? q.get("recintos").split(",") : deteccion?.recinto ? [deteccion.recinto.id] : [],
  };

  async function empezar(payload) {
    setGuardando(true);
    try {
      const pos = gps || (await actualizarGps());
      const id_local = nuevoIdLocal();
      const inicio = new Date().toISOString();
      const p = {
        ...payload,
        empresa_id: app.empresaId,
        id_local,
        inicio,
        estado: "en_curso",
        origen: "manual",
        gps_inicio: pos,
        detectado_gps: !!deteccion,
      };
      await guardarParte(p);
      guardarTrabajoEnCurso({ ...p, recorrido: pos ? [[pos.lon, pos.lat, Date.now()]] : [] });
      notificar("Trabajo iniciado. Cuando acabes, pulsa Terminar.");
    } catch (e) {
      notificar(e.message, "error");
    } finally {
      setGuardando(false);
    }
  }

  async function terminar(payload) {
    setGuardando(true);
    try {
      const pos = await actualizarGps();
      const p = {
        ...enCurso,
        ...payload,
        empresa_id: app.empresaId,
        inicio: enCurso.inicio,
        fin: payload.fin || new Date().toISOString(),
        estado: esGestor ? "validado" : "pendiente",
        gps_fin: pos,
        recorrido: enCurso.recorrido,
        forzar_actualizacion: true,
      };
      if (payload.inicio) p.inicio = payload.inicio;
      const r = await guardarParte(p);
      guardarTrabajoEnCurso(null);
      setCerrando(false);
      notificar(r.enCola ? "Guardado en el móvil. Se enviará al tener cobertura." : esGestor ? "Trabajo guardado ✓" : "Enviado al encargado para validar ✓");
      navegar("/");
    } catch (e) {
      notificar(e.message, "error");
    } finally {
      setGuardando(false);
    }
  }

  async function registrarHecho(payload) {
    setGuardando(true);
    try {
      const r = await guardarParte({
        ...payload,
        empresa_id: app.empresaId,
        estado: esGestor ? "validado" : "pendiente",
        origen: "manual",
        gps_inicio: gps,
      });
      notificar(r.enCola ? "Guardado en el móvil. Se enviará al tener cobertura." : "Trabajo guardado ✓");
      navegar("/");
    } catch (e) {
      notificar(e.message, "error");
    } finally {
      setGuardando(false);
    }
  }

  function descartar() {
    if (!confirm("¿Descartar este trabajo? No se guardará.")) return;
    if (enCurso) guardarParte({ ...enCurso, estado: "descartado", forzar_actualizacion: true }).catch(() => {});
    guardarTrabajoEnCurso(null);
  }

  // ---------- trabajo en curso ----------
  if (enCurso) {
    const l = labores.find((x) => x.id === enCurso.labor_id);
    const recs = recintos.filter((r) => enCurso.recinto_ids?.includes(r.id));
    if (cerrando) {
      const detectados = recintosDelRecorrido(recintos, enCurso.recorrido);
      const horas = Math.max(0.25, Math.round(((Date.now() - new Date(enCurso.inicio)) / 3600000) * 4) / 4);
      const d = new Date(enCurso.inicio);
      return (
        <Pagina titulo="Resumen del trabajo" subtitulo="Revisa y guarda. Puedes cambiar cualquier dato.">
          {detectados.some((id) => !enCurso.recinto_ids?.includes(id)) && (
            <p className="mb-3 rounded-xl bg-olivo-100 p-3 text-[15px] text-olivo-900">📍 Por el recorrido GPS, también has pasado por otras parcelas. Las he añadido: quítalas si no corresponde.</p>
          )}
          <ParteEditor
            modo="completo"
            inicial={{
              ...enCurso,
              recinto_ids: [...new Set([...(enCurso.recinto_ids || []), ...detectados])],
              hora_inicio: `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`,
              horas,
            }}
            textoGuardar={esGestor ? "Guardar trabajo" : "Enviar parte"}
            guardando={guardando}
            onCancelar={() => setCerrando(false)}
            onGuardar={terminar}
          />
        </Pagina>
      );
    }
    return (
      <Pagina titulo="Trabajo en curso">
        <Tarjeta className="border-2 border-olivo-300">
          <p className="text-sm font-bold uppercase text-olivo-600">● En marcha desde las {hora(enCurso.inicio)}</p>
          <p className="mt-1 text-3xl font-black text-olivo-900">{l?.nombre || "Trabajo"}</p>
          <p className="mt-1 text-lg text-stone-700">{recs.map((r) => nombreRecinto(r, r.n_en_parcela)).join(", ") || "Sin parcela"}</p>
          <p className="mt-4 text-5xl font-black tabular-nums text-olivo-800">{duracion(enCurso.inicio)}</p>
          <p className="mt-2 text-sm text-stone-500">
            {enCurso.recorrido?.length > 1 ? `Recorrido GPS: ${enCurso.recorrido.length} puntos` : "Deja esta pantalla abierta para registrar el recorrido GPS (opcional)."}
          </p>
        </Tarjeta>
        <div className="mt-6 space-y-3">
          <Boton grande className="w-full !min-h-20 !text-2xl" onClick={() => setCerrando(true)}>
            ✓ Terminar trabajo
          </Boton>
          <Boton variante="peligro" className="w-full" onClick={descartar}>
            Descartar
          </Boton>
        </div>
      </Pagina>
    );
  }

  // ---------- nuevo trabajo ----------
  return (
    <Pagina titulo="Registrar trabajo" subtitulo={deteccion?.recinto ? `📍 Estás en ${nombreRecinto(deteccion.recinto, deteccion.recinto.n_en_parcela)}` : undefined}>
      <div className="mb-5 grid grid-cols-2 gap-1 rounded-2xl bg-stone-200/70 p-1 font-bold">
        <button type="button" onClick={() => setModo("iniciar")} className={`rounded-xl py-3 ${modo === "iniciar" ? "bg-white text-olivo-800 shadow" : "text-stone-600"}`}>
          ▶ Empiezo ahora
        </button>
        <button type="button" onClick={() => setModo("completo")} className={`rounded-xl py-3 ${modo === "completo" ? "bg-white text-olivo-800 shadow" : "text-stone-600"}`}>
          ✓ Ya lo hice
        </button>
      </div>
      <ParteEditor
        key={modo + (lab?.id || "")}
        modo={modo}
        inicial={inicial}
        textoGuardar={modo === "iniciar" ? "▶ Empezar" : esGestor ? "Guardar trabajo" : "Enviar parte"}
        guardando={guardando}
        onGuardar={modo === "iniciar" ? empezar : registrarHecho}
      />
    </Pagina>
  );
}
