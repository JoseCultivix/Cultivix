"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { apiPost, supabase } from "@/lib/supabase";
import { useApp } from "@/components/AppProvider";
import ParteEditor from "@/components/ParteEditor";
import { hablar, useVoz } from "@/components/useVoz";
import { Boton, Hoja } from "@/components/ui";
import { guardarParte, guardarTrabajoEnCurso, nuevoIdLocal } from "@/lib/offline";
import { fechaCorta, nombreRecinto, num } from "@/lib/formato";

const EJEMPLOS = ["Voy a pasar el cultivador en La Mesa", "Esta mañana he estado 3 horas desbrozando", "Ayer traté el pistacho con cobre a 3 kilos", "¿Cuántas horas llevo de tractor esta campaña?", "He visto prays en el olivar de la Cequia"];

export default function PaginaAsistente() {
  return (
    <Suspense>
      <Asistente />
    </Suspense>
  );
}

function Asistente() {
  const app = useApp();
  const { empresaId, deteccion, labores, recintos, maquinaria, aperos, productos, esGestor, gps, notificar, recargar, online } = app;
  const q = useSearchParams();
  const router = useRouter();
  const [msgs, setMsgs] = useState([]);
  const [texto, setTexto] = useState("");
  const [pensando, setPensando] = useState(false);
  const [editar, setEditar] = useState(null); // {indice, propuesta}
  const [guardando, setGuardando] = useState(false);
  const fin = useRef(null);
  const porVoz = useRef(false);

  const voz = useVoz({
    onFinal: (t) => {
      porVoz.current = true;
      enviar(t);
    },
  });

  useEffect(() => {
    if (q.get("voz") === "1" && voz.disponible) setTimeout(voz.empezar, 300);
  }, [voz.disponible]); // eslint-disable-line

  useEffect(() => {
    fin.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, pensando]);

  async function enviar(t) {
    const m = (t ?? texto).trim();
    if (!m || pensando) return;
    setTexto("");
    if (!online) {
      setMsgs((x) => [...x, { rol: "usuario", texto: m }, { rol: "asistente", texto: "Ahora no tengo cobertura para pensar 🙂. Usa «Registrar trabajo», que funciona sin conexión." }]);
      return;
    }
    const historial = msgs.map((x) => ({ rol: x.rol, texto: x.texto }));
    setMsgs((x) => [...x, { rol: "usuario", texto: m }]);
    setPensando(true);
    try {
      const r = await apiPost("/api/asistente", {
        empresa_id: empresaId,
        mensaje: m,
        historial,
        recinto_actual_id: deteccion?.recinto?.id || null,
        canal: porVoz.current ? "voz" : "texto",
      });
      setMsgs((x) => [...x, { rol: "asistente", texto: r.mensaje, propuesta: r.tipo !== "consulta" && r.tipo !== "no_entendido" ? r : null, estado: "pendiente" }]);
      if (porVoz.current) hablar(r.mensaje);
    } catch (e) {
      setMsgs((x) => [...x, { rol: "asistente", texto: "⚠️ " + e.message }]);
    } finally {
      setPensando(false);
      porVoz.current = false;
    }
  }

  function marcar(i, estado) {
    setMsgs((x) => x.map((m, j) => (j === i ? { ...m, estado } : m)));
  }

  async function cerrarAccion(p, estado, registro) {
    if (p.accion_id) await supabase.from("acciones_ia").update({ estado, registro_tabla: registro?.tabla, registro_id: registro?.id }).eq("id", p.accion_id);
  }

  function aPayload(p) {
    const parte = p.parte || {};
    const out = {
      labor_id: parte.labor_id,
      fecha: parte.fecha,
      recinto_ids: parte.recinto_ids?.length ? parte.recinto_ids : deteccion?.recinto ? [deteccion.recinto.id] : [],
      maquinaria_ids: parte.maquinaria_ids || [],
      apero_ids: parte.apero_ids || [],
      trabajador_ids: parte.trabajador_ids || [],
      observaciones: parte.observaciones || null,
    };
    if (parte.hora_inicio && parte.horas) {
      const ini = new Date(`${parte.fecha}T${parte.hora_inicio}:00`);
      out.inicio = ini.toISOString();
      out.fin = new Date(ini.getTime() + parte.horas * 3600000).toISOString();
    } else out.horas_totales = parte.horas || null;
    const lab = labores.find((l) => l.id === parte.labor_id);
    if (p.aplicacion?.productos?.length) {
      out.aplicacion = {
        tipo: { tratamiento: "fitosanitario", fertilizacion: "fertilizacion", herbicida: "herbicida" }[lab?.categoria] || "fitosanitario",
        plaga_o_motivo: p.aplicacion.plaga_o_motivo || null,
        productos: p.aplicacion.productos.map((x) => ({ producto_id: x.producto_id, dosis_ha: x.dosis_ha ?? null, unidad_dosis: x.unidad_dosis || "kg/ha" })),
      };
    }
    return out;
  }

  async function confirmar(i, p, payloadEditado) {
    setGuardando(true);
    try {
      if (p.tipo === "registrar_observacion") {
        const { data, error } = await supabase
          .from("observaciones_agronomicas")
          .insert({ empresa_id: empresaId, recinto_id: p.observacion?.recinto_id || deteccion?.recinto?.id || null, tipo: p.observacion?.tipo, descripcion: p.observacion?.descripcion || p.texto })
          .select("id")
          .single();
        if (error) throw error;
        await cerrarAccion(p, "confirmada", { tabla: "observaciones_agronomicas", id: data.id });
        marcar(i, "guardado");
        notificar("Observación guardada ✓");
        return;
      }
      const base = payloadEditado || aPayload(p);
      if (p.tipo === "iniciar_trabajo") {
        const id_local = nuevoIdLocal();
        const payload = { ...base, empresa_id: empresaId, id_local, inicio: new Date().toISOString(), estado: "en_curso", origen: "voz", gps_inicio: gps };
        delete payload.horas_totales;
        delete payload.fin;
        const r = await guardarParte(payload);
        guardarTrabajoEnCurso({ ...payload, recorrido: gps ? [[gps.lon, gps.lat, Date.now()]] : [] });
        await cerrarAccion(p, payloadEditado ? "modificada" : "confirmada", { tabla: "partes_trabajo", id: r.id });
        marcar(i, "guardado");
        router.push("/trabajo");
        return;
      }
      const r = await guardarParte({ ...base, empresa_id: empresaId, estado: esGestor ? "validado" : "pendiente", origen: "voz" });
      await cerrarAccion(p, payloadEditado ? "modificada" : "confirmada", { tabla: "partes_trabajo", id: r.id });
      marcar(i, "guardado");
      notificar(r.enCola ? "Guardado en el móvil (sin cobertura)" : "Guardado ✓");
      setEditar(null);
    } catch (e) {
      notificar(e.message, "error");
    } finally {
      setGuardando(false);
    }
  }

  async function crearProducto(nombre) {
    const { error } = await supabase.from("productos").insert({ empresa_id: empresaId, nombre, tipo: "fitosanitario" });
    if (error) return notificar(error.message, "error");
    await recargar();
    notificar(`«${nombre}» añadido a tus productos. Pulsa «Cambiar algo» para incluirlo.`);
  }

  return (
    <div className="mx-auto flex h-[calc(100dvh-4rem)] max-w-2xl flex-col">
      <div className="flex-1 overflow-y-auto px-4 pt-5 pb-4">
        {msgs.length === 0 && (
          <div className="pt-4 text-center">
            <p className="text-5xl">🎤</p>
            <h1 className="mt-2 text-2xl font-black text-olivo-900">Cuéntame qué vas a hacer o qué has hecho</h1>
            <p className="mt-1 text-stone-600">Yo lo preparo y tú solo confirmas.</p>
            <div className="mt-6 space-y-2">
              {EJEMPLOS.map((e) => (
                <button key={e} type="button" onClick={() => enviar(e)} className="block w-full rounded-2xl bg-white px-4 py-3 text-left text-[15px] text-stone-700 shadow-sm">
                  «{e}»
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-3">
          {msgs.map((m, i) =>
            m.rol === "usuario" ? (
              <div key={i} className="ml-10 rounded-2xl rounded-br-md bg-olivo-700 px-4 py-3 text-[17px] text-white">
                {m.texto}
              </div>
            ) : (
              <div key={i} className="mr-4">
                <div className="whitespace-pre-wrap rounded-2xl rounded-bl-md bg-white px-4 py-3 text-[17px] text-stone-800 shadow-sm">{m.texto}</div>
                {m.propuesta && (
                  <Propuesta
                    p={m.propuesta}
                    estado={m.estado}
                    ctx={{ labores, recintos, maquinaria, aperos, productos }}
                    guardando={guardando}
                    onConfirmar={() => confirmar(i, m.propuesta)}
                    onEditar={() => setEditar({ i, p: m.propuesta })}
                    onDescartar={() => {
                      marcar(i, "descartado");
                      cerrarAccion(m.propuesta, "descartada");
                    }}
                    onCrearProducto={esGestor ? crearProducto : null}
                  />
                )}
              </div>
            )
          )}
          {pensando && <div className="mr-10 w-24 animate-pulse rounded-2xl bg-white px-4 py-3 text-2xl text-stone-400 shadow-sm">···</div>}
          <div ref={fin} />
        </div>
      </div>

      <div className="border-t border-stone-200 bg-arena px-3 pt-3 pb-3">
        {voz.escuchando && <p className="mb-2 text-center text-[15px] font-semibold text-olivo-800">{voz.parcial || "Te escucho…"}</p>}
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            enviar();
          }}
        >
          {voz.disponible && (
            <button
              type="button"
              onClick={voz.escuchando ? voz.parar : voz.empezar}
              className={`h-14 w-14 shrink-0 rounded-full text-2xl shadow ${voz.escuchando ? "animate-pulse bg-red-600 text-white" : "bg-olivo-700 text-white"}`}
              aria-label="Hablar"
            >
              🎤
            </button>
          )}
          <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Escribe o pulsa el micro…" className="h-14 min-w-0 flex-1 rounded-full border-2 border-stone-200 bg-white px-5 text-[17px] outline-none focus:border-olivo-500" />
          <button type="submit" disabled={!texto.trim() || pensando} className="h-14 w-14 shrink-0 rounded-full bg-tierra-600 text-2xl text-white disabled:opacity-40" aria-label="Enviar">
            ➤
          </button>
        </form>
      </div>

      <Hoja abierta={!!editar} onCerrar={() => setEditar(null)} titulo="Revisar propuesta">
        {editar && (
          <ParteEditor
            modo={editar.p.tipo === "iniciar_trabajo" ? "iniciar" : "completo"}
            inicial={{
              ...(editar.p.parte || {}),
              recinto_ids: editar.p.parte?.recinto_ids?.length ? editar.p.parte.recinto_ids : deteccion?.recinto ? [deteccion.recinto.id] : [],
              aplicacion: editar.p.aplicacion,
            }}
            textoGuardar={editar.p.tipo === "iniciar_trabajo" ? "▶ Empezar" : "Guardar"}
            guardando={guardando}
            onGuardar={(payload) => confirmar(editar.i, editar.p, payload)}
          />
        )}
      </Hoja>
    </div>
  );
}

function Propuesta({ p, estado, ctx, guardando, onConfirmar, onEditar, onDescartar, onCrearProducto }) {
  const { labores, recintos, maquinaria, aperos, productos } = ctx;
  if (estado === "guardado") return <p className="mt-2 pl-2 text-sm font-bold text-olivo-700">✓ Guardado</p>;
  if (estado === "descartado") return <p className="mt-2 pl-2 text-sm text-stone-500">Descartado</p>;

  const filas = [];
  if (p.tipo === "registrar_observacion") {
    const r = recintos.find((x) => x.id === p.observacion?.recinto_id);
    filas.push(["Observación", p.observacion?.descripcion], ["Tipo", p.observacion?.tipo], ["Parcela", r ? nombreRecinto(r, r.n_en_parcela) : "La de tu ubicación"]);
  } else {
    const pa = p.parte || {};
    const l = labores.find((x) => x.id === pa.labor_id);
    const rs = recintos.filter((r) => pa.recinto_ids?.includes(r.id));
    const ha = rs.reduce((s, r) => s + Number(r.superficie_sigpac_ha || 0), 0);
    filas.push(["Labor", l?.nombre || "❓ sin identificar"]);
    filas.push(["Parcelas", rs.length ? `${rs.map((r) => nombreRecinto(r, r.n_en_parcela)).join(", ")} (${num(ha)} ha)` : "📍 La de tu ubicación"]);
    if (p.tipo === "registrar_trabajo") filas.push(["Cuándo", `${fechaCorta(pa.fecha)}${pa.hora_inicio ? " · " + pa.hora_inicio : ""}${pa.horas ? ` · ${num(pa.horas)} h` : ""}`]);
    const eq = [...maquinaria.filter((m) => pa.maquinaria_ids?.includes(m.id)), ...aperos.filter((a) => pa.apero_ids?.includes(a.id))].map((x) => x.nombre);
    if (eq.length) filas.push(["Equipo", eq.join(" + ")]);
    for (const pr of p.aplicacion?.productos || []) {
      const x = productos.find((y) => y.id === pr.producto_id);
      filas.push(["Producto", `${x?.nombre || "?"}${pr.dosis_ha ? ` · ${num(pr.dosis_ha)} ${pr.unidad_dosis || ""}` : " · dosis ❓"}`]);
    }
    if (p.aplicacion?.plaga_o_motivo) filas.push(["Motivo", p.aplicacion.plaga_o_motivo]);
  }
  const incompleta = p.tipo !== "registrar_observacion" && (!p.parte?.labor_id || (p.tipo === "registrar_trabajo" && !p.parte?.horas));

  return (
    <div className="mt-2 rounded-2xl border-2 border-olivo-200 bg-olivo-50 p-3">
      <p className="mb-2 text-xs font-black uppercase tracking-wide text-olivo-700">
        {p.tipo === "iniciar_trabajo" ? "▶ Empezar trabajo" : p.tipo === "registrar_observacion" ? "👁 Anotar observación" : "✓ Registrar trabajo"}
      </p>
      <dl className="space-y-1">
        {filas.map(([k, v], i) => (
          <div key={i} className="flex gap-2 text-[15px]">
            <dt className="w-20 shrink-0 text-stone-500">{k}</dt>
            <dd className="font-semibold text-stone-900">{v}</dd>
          </div>
        ))}
      </dl>
      {p.dudas?.length > 0 && <p className="mt-2 text-sm text-tierra-700">Revisa: {p.dudas.join(" · ")}</p>}
      {p.aplicacion?.productos_nuevos?.length > 0 && (
        <div className="mt-2 text-sm text-tierra-700">
          No tengo en tu catálogo: {p.aplicacion.productos_nuevos.join(", ")}.
          {onCrearProducto &&
            p.aplicacion.productos_nuevos.map((n) => (
              <button key={n} type="button" onClick={() => onCrearProducto(n)} className="ml-2 font-bold underline">
                Añadir «{n}»
              </button>
            ))}
        </div>
      )}
      <div className="mt-3 flex gap-2">
        {incompleta ? (
          <Boton className="flex-1" onClick={onEditar}>
            Completar
          </Boton>
        ) : (
          <>
            <Boton className="flex-1" disabled={guardando} onClick={onConfirmar}>
              {p.tipo === "iniciar_trabajo" ? "▶ Empezar" : "✓ Confirmar"}
            </Boton>
            {p.tipo !== "registrar_observacion" && (
              <Boton variante="secundario" onClick={onEditar}>
                Cambiar
              </Boton>
            )}
          </>
        )}
        <Boton variante="suave" onClick={onDescartar} aria-label="Descartar">
          ✕
        </Boton>
      </div>
    </div>
  );
}
