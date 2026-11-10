"use client";
import VerDocumento from "@/components/VerDocumento";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { apiPost, supabase } from "@/lib/supabase";
import { useApp } from "@/components/AppProvider";
import SelectorCampana, { campanasSeleccionadas } from "@/components/SelectorCampana";
import { Boton, Campo, Cargando, Etiqueta, Fichas, Hoja, Input, Pagina, Seccion, Select, Tarjeta, Vacio } from "@/components/ui";
import { blobABase64, comprimirImagen } from "@/lib/imagen";
import { euros, fechaCorta, hoyISO, nombreRecinto, num } from "@/lib/formato";

const CALIDADES = {
  olivar: ["Vuelo", "Suelo", "Árbol", "Mesa"],
  pistacho: ["Abierto", "Cerrado", "Extra", "Primera"],
  almendro: ["Grano", "Cáscara"],
  "espárrago verde": ["Extra", "Primera", "Segunda", "Industria"],
};
const TIPOS_DESTINO = ["almazara", "cooperativa", "comprador", "industria", "otro"];
const n = (x) => (x === "" || x == null ? null : Number(String(x).replace(",", ".")));
const esOlivar = (nombre) => (nombre || "").toLowerCase().startsWith("olivar");

export default function PaginaCosechas() {
  return (
    <Suspense>
      <Cosechas />
    </Suspense>
  );
}

function Cosechas() {
  const { empresaId, campanas, cultivos, recintos, esGestor, notificar } = useApp();
  const [sel, setSel] = useState("activas");
  const [pestana, setPestana] = useState("resumen");
  const [entregas, setEntregas] = useState(null);
  const [destinos, setDestinos] = useState([]);
  const [liqs, setLiqs] = useState([]);
  const q = useSearchParams();
  const [hoja, setHoja] = useState(q.get("nueva") === "1" ? { tipo: "entrega" } : null); // {tipo:'entrega'|'liquidar', item?}
  const elegidas = useMemo(() => campanasSeleccionadas(campanas, sel), [campanas, sel]);
  const ids = elegidas.map((c) => c.id).join(",");

  const cargar = useCallback(async () => {
    const [d, e, l] = await Promise.all([
      supabase.from("destinos_cosecha").select("*").eq("empresa_id", empresaId).eq("activo", true).order("nombre"),
      ids
        ? supabase
            .from("entregas_cosecha")
            .select("*, cultivos(nombre), destinos_cosecha(nombre), entregas_cosecha_recintos(recinto_id)")
            .eq("empresa_id", empresaId)
            .in("campana_id", ids.split(","))
            .order("fecha", { ascending: false })
            .limit(500)
        : Promise.resolve({ data: [] }),
      esGestor && ids
        ? supabase.from("liquidaciones_cosecha").select("*, destinos_cosecha(nombre), cultivos(nombre)").eq("empresa_id", empresaId).in("campana_id", ids.split(",")).order("fecha", { ascending: false })
        : Promise.resolve({ data: [] }),
    ]);
    setDestinos(d.data || []);
    setEntregas(e.data || []);
    setLiqs(l.data || []);
  }, [empresaId, ids, esGestor]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function hecho(m) {
    setHoja(null);
    await cargar();
    notificar(m);
  }

  // ---------- resumen por cultivo / calidad / destino ----------
  const resumen = useMemo(() => {
    const porCultivo = {};
    for (const e of entregas || []) {
      const k = e.cultivo_id;
      const c = (porCultivo[k] = porCultivo[k] || { nombre: e.cultivos?.nombre, kilos: 0, aceite: 0, kgConRend: 0, importe: 0, kgConPrecio: 0, sinPrecio: 0, n: 0, calidades: {}, destinos: {} });
      const kg = +e.kilos_netos || 0;
      c.kilos += kg;
      c.n++;
      if (e.kilos_aceite != null) {
        c.aceite += +e.kilos_aceite;
        c.kgConRend += kg;
      }
      if (e.importe != null) {
        c.importe += +e.importe;
        c.kgConPrecio += kg;
      } else c.sinPrecio += kg;
      const q = e.calidad || "Sin calidad";
      const cq = (c.calidades[q] = c.calidades[q] || { kilos: 0, importe: 0, kgConPrecio: 0, aceite: 0, kgConRend: 0 });
      cq.kilos += kg;
      if (e.importe != null) {
        cq.importe += +e.importe;
        cq.kgConPrecio += kg;
      }
      if (e.kilos_aceite != null) {
        cq.aceite += +e.kilos_aceite;
        cq.kgConRend += kg;
      }
      const dn = e.destinos_cosecha?.nombre || "Sin destino";
      c.destinos[dn] = (c.destinos[dn] || 0) + kg;
    }
    // Superficie de cada cultivo para kg/ha
    for (const [k, c] of Object.entries(porCultivo)) c.ha = recintos.filter((r) => r.cultivo_id === k).reduce((s, r) => s + (+r.superficie_sigpac_ha || 0), 0);
    return porCultivo;
  }, [entregas, recintos]);

  return (
    <Pagina titulo="Cosechas" subtitulo="Entregas, calidades y liquidaciones" volver="/mas" accion={<Boton onClick={() => setHoja({ tipo: "entrega" })}>+ Entrega</Boton>}>
      <SelectorCampana valor={sel} onCambio={setSel} />
      <div className="mb-4 grid grid-cols-3 gap-1 rounded-2xl bg-stone-200/70 p-1 text-sm font-bold">
        {[["resumen", "Resumen"], ["entregas", "Entregas"], ...(esGestor ? [["liquidaciones", "Liquidaciones"]] : [])].map(([k, t]) => (
          <button key={k} type="button" onClick={() => setPestana(k)} className={`rounded-xl py-2.5 ${pestana === k ? "bg-white text-olivo-800 shadow" : "text-stone-600"}`}>
            {t}
          </button>
        ))}
      </div>

      {entregas === null ? (
        <Cargando />
      ) : entregas.length === 0 && pestana !== "liquidaciones" ? (
        <Vacio icono="🧺" titulo="Sin entregas en esta campaña" texto="Apunta cada ticket o albarán de entrega: kilos, calidad y destino. Con la foto del ticket se rellena solo.">
          <Boton onClick={() => setHoja({ tipo: "entrega" })}>Apuntar entrega</Boton>
        </Vacio>
      ) : pestana === "resumen" ? (
        <div className="space-y-4">
          {Object.entries(resumen).map(([k, c]) => (
            <Tarjeta key={k}>
              <div className="flex items-start justify-between">
                <p className="text-xl font-black text-olivo-900">{c.nombre}</p>
                <span className="text-sm text-stone-500">{c.n} entregas</span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Dato t="Kilos" v={`${num(c.kilos, 0)} kg`} p={c.ha > 0 ? `${num(c.kilos / c.ha, 0)} kg/ha` : null} />
                {c.kgConRend > 0 && <Dato t="Aceite" v={`${num(c.aceite, 0)} kg`} p={`Rend. ${num((c.aceite / c.kgConRend) * 100, 1)} %`} />}
                {esGestor && <Dato t="Importe" v={euros(c.importe)} p={c.kgConPrecio > 0 ? `${euros(c.importe / c.kgConPrecio)}/kg` : null} />}
                {esGestor && c.sinPrecio > 0 && <Dato t="Sin liquidar" v={`${num(c.sinPrecio, 0)} kg`} p="pendiente de precio" alerta />}
              </div>
              <p className="mb-1 mt-4 text-xs font-bold uppercase text-stone-500">Por calidad</p>
              {Object.entries(c.calidades)
                .sort((a, b) => b[1].kilos - a[1].kilos)
                .map(([q, v]) => (
                  <div key={q} className="flex items-center justify-between border-b border-stone-100 py-1.5 text-[15px] last:border-0">
                    <span>
                      <b>{q}</b> <span className="text-stone-500">· {num((v.kilos / c.kilos) * 100, 0)} %</span>
                    </span>
                    <span className="text-right">
                      {num(v.kilos, 0)} kg
                      {v.kgConRend > 0 && <span className="text-stone-500"> · rend. {num((v.aceite / v.kgConRend) * 100, 1)} %</span>}
                      {esGestor && v.kgConPrecio > 0 && <span className="block text-xs text-stone-500">{euros(v.importe)} · {euros(v.importe / v.kgConPrecio)}/kg</span>}
                    </span>
                  </div>
                ))}
              <p className="mb-1 mt-4 text-xs font-bold uppercase text-stone-500">Por destino</p>
              {Object.entries(c.destinos).map(([dn, kg]) => (
                <div key={dn} className="flex justify-between py-1 text-[15px]">
                  <span>{dn}</span>
                  <span>{num(kg, 0)} kg</span>
                </div>
              ))}
            </Tarjeta>
          ))}
        </div>
      ) : pestana === "entregas" ? (
        <div className="space-y-2">
          {entregas.map((e) => (
            <button key={e.id} type="button" onClick={() => (esGestor || !e.liquidacion_id) && setHoja({ tipo: "entrega", item: e })} className="block w-full rounded-2xl bg-white p-3 text-left shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <p className="text-lg font-extrabold text-olivo-900">
                  {num(e.kilos_netos, 0)} kg <span className="text-base font-semibold text-stone-600">{e.cultivos?.nombre}</span>
                </p>
                {e.precio != null ? <Etiqueta>{esGestor ? euros(e.importe) : "Liquidada"}</Etiqueta> : <Etiqueta color="ambar">Sin precio</Etiqueta>}
              </div>
              <p className="text-[15px] text-stone-700">
                {fechaCorta(e.fecha)} · {e.destinos_cosecha?.nombre || "Sin destino"}
                {e.numero_ticket ? ` · Ticket ${e.numero_ticket}` : ""}
                {e.documento_id ? " · 📷" : ""}
              </p>
              <p className="text-sm text-stone-500">
                {[
                  e.calidad,
                  e.rendimiento_pct != null && `rend. ${num(e.rendimiento_pct, 1)} %`,
                  e.humedad_pct != null && `hum. ${num(e.humedad_pct, 1)} %`,
                  e.entregas_cosecha_recintos?.length &&
                    recintos.filter((r) => e.entregas_cosecha_recintos.some((x) => x.recinto_id === r.id)).map((r) => r.parcela_nombre).join(", "),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </button>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          <Boton grande className="w-full" onClick={() => setHoja({ tipo: "liquidar" })} disabled={!entregas.some((e) => !e.liquidacion_id)}>
            💶 Registrar liquidación
          </Boton>
          {!entregas.some((e) => !e.liquidacion_id) && <p className="text-center text-sm text-stone-500">Todas las entregas de esta campaña tienen precio.</p>}
          {liqs.map((l) => (
            <Tarjeta key={l.id} className="!p-3">
              <div className="flex justify-between">
                <b>{l.destinos_cosecha?.nombre || "Destino"}</b>
                <b>{euros(l.importe_neto ?? l.importe_bruto)}</b>
              </div>
              <p className="text-sm text-stone-500">
                {fechaCorta(l.fecha)} · {l.numero || "s/n"} · {l.tipo} · {l.cultivos?.nombre || ""} · {entregas.filter((e) => e.liquidacion_id === l.id).length} entregas
              </p>
            </Tarjeta>
          ))}
        </div>
      )}

      <Hoja abierta={!!hoja} onCerrar={() => setHoja(null)} titulo={hoja?.tipo === "liquidar" ? "Liquidación" : hoja?.item ? "Editar entrega" : "Entrega de cosecha"}>
        {hoja?.tipo === "entrega" && <FormEntrega item={hoja.item} destinos={destinos} entregas={entregas || []} onHecho={hecho} />}
        {hoja?.tipo === "liquidar" && <FormLiquidacion destinos={destinos} entregas={(entregas || []).filter((e) => !e.liquidacion_id)} onHecho={hecho} />}
      </Hoja>
    </Pagina>
  );
}

function Dato({ t, v, p, alerta }) {
  return (
    <div className={`rounded-xl px-3 py-2 ${alerta ? "bg-amber-50" : "bg-olivo-50"}`}>
      <p className="text-xs font-semibold text-stone-500">{t}</p>
      <p className={`text-lg font-black ${alerta ? "text-amber-800" : "text-olivo-900"}`}>{v}</p>
      {p && <p className="text-xs text-stone-500">{p}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------
function FormEntrega({ item, destinos, entregas, onHecho }) {
  const { empresaId, cultivos, recintos, deteccion, esGestor, notificar } = useApp();
  const cultivosUsados = cultivos.filter((c) => recintos.some((r) => r.cultivo_id === c.id));
  const inicialCultivo = item?.cultivo_id || deteccion?.recinto?.cultivo_id || cultivosUsados[0]?.id || null;
  const [f, setF] = useState(() => ({
    fecha: item?.fecha || hoyISO(),
    cultivo_id: inicialCultivo,
    destino_id: item?.destino_id || entregas[0]?.destino_id || null,
    destino_nombre: "",
    destino_tipo: "almazara",
    recinto_ids: item?.entregas_cosecha_recintos?.map((x) => x.recinto_id) || (deteccion?.recinto && deteccion.recinto.cultivo_id === inicialCultivo ? [deteccion.recinto.id] : []),
    kilos_netos: item?.kilos_netos ?? "",
    kilos_brutos: item?.kilos_brutos ?? "",
    calidad: item?.calidad || null,
    rendimiento_pct: item?.rendimiento_pct ?? "",
    humedad_pct: item?.humedad_pct ?? "",
    impurezas_pct: item?.impurezas_pct ?? "",
    acidez: item?.acidez ?? "",
    numero_ticket: item?.numero_ticket || "",
    precio: item?.precio ?? "",
    precio_unidad: item?.precio_unidad || "kg",
    observaciones: item?.observaciones || "",
    documento_id: item?.documento_id || null,
  }));
  const [nuevoDestino, setNuevoDestino] = useState(!destinos.length);
  const [otraCalidad, setOtraCalidad] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [leyendo, setLeyendo] = useState(false);
  const camara = useRef(null);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  const cultivo = cultivos.find((c) => c.id === f.cultivo_id);
  const olivar = esOlivar(cultivo?.nombre);
  const sugeridas = [...new Set([...(CALIDADES[(cultivo?.nombre || "").toLowerCase()] || ["Extra", "Primera", "Segunda"]), ...entregas.filter((e) => e.cultivo_id === f.cultivo_id && e.calidad).map((e) => e.calidad)])];
  const recintosCultivo = recintos.filter((r) => !f.cultivo_id || r.cultivo_id === f.cultivo_id || f.recinto_ids.includes(r.id));

  // Aviso si alguna parcela está dentro del plazo de seguridad de un tratamiento
  const [enPlazo, setEnPlazo] = useState([]);
  useEffect(() => {
    if (!f.recinto_ids.length || !f.fecha) return setEnPlazo([]);
    supabase
      .from("v_plazos_seguridad")
      .select("recinto_id, parcela, producto, fecha_segura")
      .in("recinto_id", f.recinto_ids)
      .gt("fecha_segura", f.fecha)
      .lte("fecha", f.fecha)
      .then(({ data }) => setEnPlazo(data || []));
  }, [f.recinto_ids.join(","), f.fecha]); // eslint-disable-line

  // Foto del ticket: se archiva y, si la IA está activa, rellena los datos
  async function fotoTicket(ev) {
    const file = ev.target.files?.[0];
    if (!file) return;
    setLeyendo(true);
    try {
      const { blob, tipo } = await comprimirImagen(file, 2000, 0.85);
      const ruta = `${empresaId}/cosechas/${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.jpg`;
      const up = await supabase.storage.from("documentos").upload(ruta, blob, { contentType: tipo });
      if (up.error) throw up.error;
      const { data: d } = await supabase.from("documentos").insert({ empresa_id: empresaId, tipo: "ticket", nombre: file.name, archivo_path: ruta, mime_type: tipo }).select("id").single();
      set("documento_id", d?.id || null);
      try {
        const r = await apiPost("/api/escanear", { empresa_id: empresaId, base64: await blobABase64(blob), media_type: tipo, tipo: "cosecha" });
        setF((x) => ({
          ...x,
          fecha: r.fecha || x.fecha,
          numero_ticket: r.numero_ticket || x.numero_ticket,
          kilos_netos: r.kilos_netos ?? x.kilos_netos,
          kilos_brutos: r.kilos_brutos ?? x.kilos_brutos,
          calidad: r.calidad || x.calidad,
          rendimiento_pct: r.rendimiento_pct ?? x.rendimiento_pct,
          humedad_pct: r.humedad_pct ?? x.humedad_pct,
          impurezas_pct: r.impurezas_pct ?? x.impurezas_pct,
          acidez: r.acidez ?? x.acidez,
          destino_id: destinos.find((dd) => r.destino_nombre && dd.nombre.toLowerCase() === r.destino_nombre.toLowerCase())?.id || x.destino_id,
        }));
        if (r.destino_nombre && !destinos.some((dd) => dd.nombre.toLowerCase() === r.destino_nombre.toLowerCase())) {
          setNuevoDestino(true);
          set("destino_nombre", r.destino_nombre);
        }
        notificar("Ticket leído. Revisa los datos ✓");
      } catch (e) {
        notificar("Foto guardada. " + (e.message.includes("ANTHROPIC") || e.message.includes("IA") ? "La lectura automática estará disponible al activar la IA." : e.message));
      }
    } catch (e) {
      notificar(e.message, "error");
    } finally {
      setLeyendo(false);
    }
  }

  async function guardar() {
    setGuardando(true);
    try {
      const payload = {
        empresa_id: empresaId,
        id: item?.id,
        ...f,
        destino_id: nuevoDestino ? null : f.destino_id,
        destino_nombre: nuevoDestino ? f.destino_nombre : null,
        calidad: otraCalidad.trim() || f.calidad,
        kilos_netos: n(f.kilos_netos),
        kilos_brutos: n(f.kilos_brutos),
        rendimiento_pct: n(f.rendimiento_pct),
        humedad_pct: n(f.humedad_pct),
        impurezas_pct: n(f.impurezas_pct),
        acidez: n(f.acidez),
        precio: esGestor ? n(f.precio) : null,
      };
      const { error } = await supabase.rpc("guardar_entrega", { payload });
      if (error) throw error;
      onHecho(item ? "Entrega actualizada ✓" : "Entrega apuntada ✓");
    } catch (e) {
      notificar(e.message, "error");
    } finally {
      setGuardando(false);
    }
  }

  async function borrar() {
    if (!confirm("¿Borrar esta entrega?")) return;
    const { error } = await supabase.from("entregas_cosecha").delete().eq("id", item.id);
    if (error) return notificar(error.message, "error");
    onHecho("Entrega borrada");
  }

  const kg = n(f.kilos_netos);
  return (
    <div className="space-y-4">
      <input ref={camara} type="file" accept="image/*" capture="environment" className="hidden" onChange={fotoTicket} />
      <div className="flex gap-2">
        <Boton variante="secundario" className="flex-1" disabled={leyendo} onClick={() => camara.current?.click()}>
          {leyendo ? "Leyendo ticket…" : f.documento_id ? "📷 Repetir foto" : "📷 Foto del ticket"}
        </Boton>
        {f.documento_id && !leyendo && <VerDocumento documentoId={f.documento_id} texto="👁️ Ver ticket" className="flex-1" />}
      </div>

      <div>
        <p className="mb-2 text-sm font-bold text-stone-700">Cultivo</p>
        <Fichas opciones={(cultivosUsados.length ? cultivosUsados : cultivos).map((c) => ({ value: c.id, label: c.nombre }))} valor={f.cultivo_id} onCambio={(v) => setF((x) => ({ ...x, cultivo_id: v, recinto_ids: [], calidad: null }))} />
      </div>

      <div>
        <p className="mb-2 text-sm font-bold text-stone-700">¿Dónde la has llevado?</p>
        {!nuevoDestino ? (
          <>
            <Fichas opciones={destinos.map((d) => ({ value: d.id, label: d.nombre }))} valor={f.destino_id} onCambio={(v) => set("destino_id", v)} vacio="" />
            <button type="button" className="mt-2 text-sm font-bold text-olivo-700" onClick={() => setNuevoDestino(true)}>
              + Otro destino
            </button>
          </>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            <Input className="col-span-2" placeholder="Almazara San Isidro" value={f.destino_nombre} onChange={(e) => set("destino_nombre", e.target.value)} />
            <Select vacio={null} opciones={TIPOS_DESTINO.map((t) => ({ value: t, label: t }))} value={f.destino_tipo} onChange={(e) => set("destino_tipo", e.target.value)} />
            {destinos.length > 0 && (
              <button type="button" className="col-span-3 text-left text-sm font-bold text-olivo-700" onClick={() => setNuevoDestino(false)}>
                ← Elegir uno de mis destinos
              </button>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Campo etiqueta="Kilos netos">
          <Input inputMode="decimal" className="!text-2xl font-black" value={f.kilos_netos} onChange={(e) => set("kilos_netos", e.target.value)} placeholder="0" />
        </Campo>
        <Campo etiqueta="Fecha">
          <Input type="date" value={f.fecha} onChange={(e) => set("fecha", e.target.value)} />
        </Campo>
      </div>

      <div>
        <p className="mb-2 text-sm font-bold text-stone-700">Calidad</p>
        <Fichas opciones={sugeridas.map((q) => ({ value: q, label: q }))} valor={otraCalidad ? null : f.calidad} onCambio={(v) => { setOtraCalidad(""); set("calidad", v); }} />
        <Input className="mt-2" placeholder="Otra calidad…" value={otraCalidad} onChange={(e) => setOtraCalidad(e.target.value)} />
      </div>

      <div>
        <p className="mb-2 text-sm font-bold text-stone-700">¿De qué parcelas? <span className="font-normal text-stone-500">(opcional, para la rentabilidad por parcela)</span></p>
        <Fichas multiple opciones={recintosCultivo.map((r) => ({ value: r.id, label: nombreRecinto(r, r.n_en_parcela) }))} valor={f.recinto_ids} onCambio={(v) => set("recinto_ids", v)} vacio="No hay parcelas con este cultivo." />
        {enPlazo.length > 0 && (
          <div className="mt-2 rounded-xl bg-red-100 p-2 text-sm font-semibold text-red-900">
            ⚠️ Plazo de seguridad sin cumplir:{" "}
            {enPlazo.map((x) => `${x.parcela} (${x.producto}, se puede cosechar desde el ${new Date(x.fecha_segura + "T12:00").toLocaleDateString("es-ES")})`).join("; ")}. Si la almazara o la cooperativa analiza residuos, podría rechazar la partida.
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2">
        {olivar && (
          <Campo etiqueta="Rendimiento %">
            <Input inputMode="decimal" value={f.rendimiento_pct} onChange={(e) => set("rendimiento_pct", e.target.value)} />
          </Campo>
        )}
        <Campo etiqueta="Humedad %">
          <Input inputMode="decimal" value={f.humedad_pct} onChange={(e) => set("humedad_pct", e.target.value)} />
        </Campo>
        <Campo etiqueta="Impurezas %">
          <Input inputMode="decimal" value={f.impurezas_pct} onChange={(e) => set("impurezas_pct", e.target.value)} />
        </Campo>
        {olivar && (
          <Campo etiqueta="Acidez">
            <Input inputMode="decimal" value={f.acidez} onChange={(e) => set("acidez", e.target.value)} />
          </Campo>
        )}
        <Campo etiqueta="Kilos brutos">
          <Input inputMode="decimal" value={f.kilos_brutos} onChange={(e) => set("kilos_brutos", e.target.value)} />
        </Campo>
        <Campo etiqueta="Nº ticket">
          <Input value={f.numero_ticket} onChange={(e) => set("numero_ticket", e.target.value)} />
        </Campo>
      </div>
      {olivar && kg && n(f.rendimiento_pct) ? <p className="text-sm text-olivo-800">≈ {num((kg * n(f.rendimiento_pct)) / 100, 0)} kg de aceite</p> : null}

      {esGestor && (
        <div className="rounded-2xl bg-white p-3">
          <p className="mb-2 text-sm font-bold text-stone-700">Precio <span className="font-normal text-stone-500">(si ya lo sabes; si no, se pone al liquidar)</span></p>
          <div className="grid grid-cols-2 gap-2">
            <Input inputMode="decimal" placeholder="€" value={f.precio} onChange={(e) => set("precio", e.target.value)} />
            <Select vacio={null} opciones={[{ value: "kg", label: "€ / kg" }, ...(olivar ? [{ value: "kg_aceite", label: "€ / kg aceite" }] : [])]} value={f.precio_unidad} onChange={(e) => set("precio_unidad", e.target.value)} />
          </div>
        </div>
      )}

      <Input placeholder="Notas (opcional)" value={f.observaciones} onChange={(e) => set("observaciones", e.target.value)} />

      <Boton grande className="w-full" disabled={!kg || !f.cultivo_id || guardando || (nuevoDestino && !f.destino_nombre.trim())} onClick={guardar}>
        {guardando ? "Guardando…" : "Guardar entrega"}
      </Boton>
      {item && (
        <Boton variante="peligro" className="w-full" onClick={borrar}>
          Borrar entrega
        </Boton>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
function FormLiquidacion({ destinos, entregas, onHecho }) {
  const { empresaId, notificar } = useApp();
  const destinosConPendientes = destinos.filter((d) => entregas.some((e) => e.destino_id === d.id));
  const [destino, setDestino] = useState(destinosConPendientes[0]?.id || null);
  const dEntregas = entregas.filter((e) => e.destino_id === destino);
  const [selIds, setSelIds] = useState(dEntregas.map((e) => e.id));
  const [unidad, setUnidad] = useState("kg");
  const [precios, setPrecios] = useState({});
  const [f, setF] = useState({ fecha: hoyISO(), numero: "", tipo: "definitiva", retenciones: "" });
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    setSelIds(entregas.filter((e) => e.destino_id === destino).map((e) => e.id));
  }, [destino]); // eslint-disable-line

  const elegidas = dEntregas.filter((e) => selIds.includes(e.id));
  const calidades = [...new Set(elegidas.map((e) => e.calidad || ""))];
  const olivar = elegidas.some((e) => esOlivar(e.cultivos?.nombre));

  const total = elegidas.reduce((s, e) => {
    const p = n(precios[e.calidad || ""]);
    if (p == null) return s;
    const base = unidad === "kg_aceite" ? ((+e.kilos_netos || 0) * (+e.rendimiento_pct || 0)) / 100 : +e.kilos_netos || 0;
    return s + base * p;
  }, 0);
  const faltan = calidades.filter((q) => n(precios[q]) == null);

  async function guardar() {
    setGuardando(true);
    try {
      const cultivosSel = [...new Set(elegidas.map((e) => e.cultivo_id))];
      const { error } = await supabase.rpc("liquidar_entregas", {
        payload: {
          empresa_id: empresaId,
          destino_id: destino,
          cultivo_id: cultivosSel.length === 1 ? cultivosSel[0] : null,
          fecha: f.fecha,
          numero: f.numero,
          tipo: f.tipo,
          retenciones: n(f.retenciones),
          precio_unidad: unidad,
          precios: calidades.map((q) => ({ calidad: q, precio: n(precios[q]) })),
          entrega_ids: selIds,
        },
      });
      if (error) throw error;
      onHecho("Liquidación registrada. Ingresos actualizados ✓");
    } catch (e) {
      notificar(e.message, "error");
    } finally {
      setGuardando(false);
    }
  }

  if (!destinosConPendientes.length) return <p>No hay entregas pendientes de precio.</p>;
  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-sm font-bold text-stone-700">Destino</p>
        <Fichas opciones={destinosConPendientes.map((d) => ({ value: d.id, label: d.nombre }))} valor={destino} onCambio={(v) => v && setDestino(v)} />
      </div>
      <div>
        <p className="mb-2 text-sm font-bold text-stone-700">Entregas que liquida ({elegidas.length})</p>
        <div className="max-h-56 space-y-1 overflow-y-auto rounded-2xl bg-white p-2">
          {dEntregas.map((e) => (
            <label key={e.id} className="flex items-center gap-3 rounded-xl px-2 py-1.5 text-[15px]">
              <input type="checkbox" className="h-5 w-5 accent-olivo-700" checked={selIds.includes(e.id)} onChange={(ev) => setSelIds(ev.target.checked ? [...selIds, e.id] : selIds.filter((x) => x !== e.id))} />
              <span className="flex-1">
                {fechaCorta(e.fecha)} · {e.calidad || "Sin calidad"} {e.numero_ticket ? `· ${e.numero_ticket}` : ""}
              </span>
              <b>{num(e.kilos_netos, 0)} kg</b>
            </label>
          ))}
        </div>
      </div>
      {olivar && (
        <div className="grid grid-cols-2 gap-1 rounded-2xl bg-stone-200/70 p-1 text-sm font-bold">
          {[["kg", "€ por kg aceituna"], ["kg_aceite", "€ por kg aceite"]].map(([k, t]) => (
            <button key={k} type="button" onClick={() => setUnidad(k)} className={`rounded-xl py-2.5 ${unidad === k ? "bg-white text-olivo-800 shadow" : "text-stone-600"}`}>
              {t}
            </button>
          ))}
        </div>
      )}
      <div>
        <p className="mb-2 text-sm font-bold text-stone-700">Precio por calidad</p>
        {calidades.map((q) => (
          <div key={q} className="mb-2 flex items-center gap-2">
            <span className="flex-1 font-semibold">{q || "Sin calidad"}</span>
            <Input className="!w-32 text-right" inputMode="decimal" placeholder="€" value={precios[q] ?? ""} onChange={(e) => setPrecios({ ...precios, [q]: e.target.value })} />
            <span className="w-16 text-sm text-stone-500">{unidad === "kg_aceite" ? "€/kg ac." : "€/kg"}</span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Campo etiqueta="Nº liquidación">
          <Input value={f.numero} onChange={(e) => setF({ ...f, numero: e.target.value })} />
        </Campo>
        <Campo etiqueta="Fecha">
          <Input type="date" value={f.fecha} onChange={(e) => setF({ ...f, fecha: e.target.value })} />
        </Campo>
        <Campo etiqueta="Tipo">
          <Select vacio={null} opciones={["anticipo", "parcial", "definitiva"].map((t) => ({ value: t, label: t }))} value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })} />
        </Campo>
        <Campo etiqueta="Retenciones (€)">
          <Input inputMode="decimal" value={f.retenciones} onChange={(e) => setF({ ...f, retenciones: e.target.value })} />
        </Campo>
      </div>
      <p className="rounded-xl bg-white px-3 py-2 text-[15px]">
        Importe bruto: <b>{euros(total)}</b>
        {n(f.retenciones) ? ` · Neto: ${euros(total - n(f.retenciones))}` : ""}
      </p>
      <Boton grande className="w-full" disabled={!elegidas.length || faltan.length > 0 || guardando} onClick={guardar}>
        {guardando ? "Guardando…" : "Guardar liquidación"}
      </Boton>
    </div>
  );
}
