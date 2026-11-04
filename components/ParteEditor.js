"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "./AppProvider";
import { Boton, Campo, Fichas, Input, claseInput } from "./ui";
import { euros, hoyISO, nombreRecinto, num } from "@/lib/formato";
import ComprobacionFito from "./ComprobacionFito";

const SISTEMAS_RIEGO = [["goteo", "Goteo"], ["aspersion", "Aspersión"], ["microaspersion", "Microaspersión"], ["gravedad", "A manta / gravedad"], ["pivot", "Pívot"], ["otro", "Otro"]];

export const CATEGORIAS_APLICACION = ["tratamiento", "fertilizacion", "herbicida"];
const METODOS_FERTILIZACION = [["abonadora", "Abonadora"], ["fertirrigacion", "Fertirrigación"], ["foliar", "Foliar"], ["localizado", "Localizado"], ["enterrado", "Enterrado"], ["cuba", "Cuba"]];
const METODOS_TRATAMIENTO = [["pulverizacion", "Pulverización"], ["cuba", "Cuba / mochila"], ["espolvoreo", "Espolvoreo"], ["otro", "Otro"]];
const TIPO_APLICACION = { tratamiento: "fitosanitario", fertilizacion: "fertilizacion", herbicida: "herbicida" };

function horaDe(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Propone maquinaria/apero habituales de una labor (FLUJO-007) */
export function habitualesDe(labor) {
  return {
    maquinaria_ids: labor?.maquinaria_habitual_id ? [labor.maquinaria_habitual_id] : [],
    apero_ids: labor?.apero_habitual_id ? [labor.apero_habitual_id] : [],
  };
}

/**
 * Tarjeta de confirmación/edición de un parte.
 * modo "iniciar": sin horas (el trabajo empieza ahora). modo "completo": fecha + horas.
 */
export default function ParteEditor({ inicial = {}, modo = "completo", onGuardar, onCancelar, textoGuardar = "Guardar", guardando, planificar = false }) {
  const { labores, recintos, maquinaria, aperos, trabajadores, productos, esGestor, deteccion, perfil, cultivos, online } = useApp();
  const yo = trabajadores.find((t) => t.usuario_id === perfil?.id);

  const [laborId, setLaborId] = useState(inicial.labor_id || null);
  const [recintoIds, setRecintoIdsRaw] = useState(inicial.recinto_ids?.length ? inicial.recinto_ids : !planificar && deteccion?.recinto ? [deteccion.recinto.id] : []);
  const tocado = useRef(false);
  const setRecintoIds = (v) => {
    tocado.current = true;
    setRecintoIdsRaw(v);
  };
  // El GPS suele llegar después de pintar: si el usuario aún no ha elegido, marca la parcela detectada
  useEffect(() => {
    if (!planificar && !tocado.current && deteccion?.recinto && recintoIds.length === 0) setRecintoIdsRaw([deteccion.recinto.id]);
  }, [deteccion?.recinto?.id]); // eslint-disable-line
  const [maqIds, setMaqIds] = useState(inicial.maquinaria_ids || []);
  const [aperoIds, setAperoIds] = useState(inicial.apero_ids || []);
  const [trabIds, setTrabIds] = useState(inicial.trabajador_ids?.length ? inicial.trabajador_ids : yo && !planificar ? [yo.id] : []);
  const [fecha, setFecha] = useState(inicial.fecha || hoyISO());
  const [horaInicio, setHoraInicio] = useState(inicial.hora_inicio || horaDe(inicial.inicio) || "");
  const [horas, setHoras] = useState(inicial.horas ?? inicial.horas_totales ?? "");
  const [obs, setObs] = useState(inicial.observaciones || "");
  const [prods, setProds] = useState(inicial.aplicacion?.productos || []);
  const [motivo, setMotivo] = useState(inicial.aplicacion?.plaga_o_motivo || "");
  const [metodo, setMetodo] = useState(inicial.aplicacion?.metodo_aplicacion || "");
  const [justificacion, setJustificacion] = useState(inicial.aplicacion?.justificacion || "");
  const [caldo, setCaldo] = useState(inicial.aplicacion?.volumen_caldo_l_ha ?? "");
  const [riego, setRiego] = useState({ sistema: inicial.riego?.sistema || "", m3_ha: inicial.riego?.m3_ha ?? "", volumen_m3: inicial.riego?.volumen_m3 ?? "", porHa: inicial.riego?.volumen_m3 != null && inicial.riego?.m3_ha == null ? false : true, fertirrigacion: !!inicial.riego?.fertirrigacion });
  const [verTodasLabores, setVerTodasLabores] = useState(false);
  const [verTodosRecintos, setVerTodosRecintos] = useState(false);

  const labor = labores.find((l) => l.id === laborId);
  const esAplicacion = labor && CATEGORIAS_APLICACION.includes(labor.categoria);

  function elegirLabor(id) {
    setLaborId(id);
    const l = labores.find((x) => x.id === id);
    const h = habitualesDe(l);
    if (h.maquinaria_ids.length) setMaqIds(h.maquinaria_ids);
    if (h.apero_ids.length) setAperoIds(h.apero_ids);
  }

  // Labores: primero la propuesta, luego el resto
  const opcionesLabor = useMemo(() => {
    const ops = labores.map((l) => ({ value: l.id, label: l.nombre }));
    if (verTodasLabores || ops.length <= 16) return ops;
    const top = ops.slice(0, 8);
    if (laborId && !top.some((o) => o.value === laborId)) top.unshift(ops.find((o) => o.value === laborId));
    return top;
  }, [labores, verTodasLabores, laborId]);

  // Recintos: detectado por GPS primero
  const opcionesRecinto = useMemo(() => {
    const aqui = deteccion?.recinto?.id;
    const ops = [...recintos]
      .sort((a, b) => (b.id === aqui) - (a.id === aqui))
      .map((r) => ({
        value: r.id,
        label: (r.id === aqui ? "📍 " : "") + nombreRecinto(r, r.n_en_parcela),
        extra: `${r.cultivo ? r.cultivo + " · " : ""}${num(r.superficie_sigpac_ha)} ha`,
      }));
    if (verTodosRecintos || ops.length <= 10) return ops;
    const visibles = ops.slice(0, 8);
    for (const id of recintoIds) if (!visibles.some((o) => o.value === id)) visibles.push(ops.find((o) => o.value === id));
    return visibles.filter(Boolean);
  }, [recintos, deteccion, verTodosRecintos, recintoIds]);

  const superficie = recintos.filter((r) => recintoIds.includes(r.id)).reduce((s, r) => s + Number(r.superficie_sigpac_ha || 0), 0);

  // Productos sugeridos: con stock, luego usados, luego el resto (DEC-038)
  const productosOrdenados = useMemo(
    () => [...productos].sort((a, b) => (Number(b.stock) > 0) - (Number(a.stock) > 0) || (b.ultima_compra || "").localeCompare(a.ultima_compra || "")),
    [productos]
  );

  function toggleProducto(id) {
    if (prods.some((p) => p.producto_id === id)) setProds(prods.filter((p) => p.producto_id !== id));
    else {
      const pr = productos.find((p) => p.id === id);
      setProds([...prods, { producto_id: id, dosis_ha: pr?.dosis_habitual_ha ?? "", unidad_dosis: `${pr?.unidad || "kg"}/ha` }]);
    }
  }

  const horasNum = Number(String(horas).replace(",", ".")) || 0;
  const costeHora =
    trabajadores.filter((t) => trabIds.includes(t.id)).reduce((s, t) => s + Number(t.coste_hora || 0), 0) +
    maquinaria.filter((m) => maqIds.includes(m.id)).reduce((s, m) => s + Number(m.coste_hora || 0), 0) +
    aperos.filter((a) => aperoIds.includes(a.id)).reduce((s, a) => s + Number(a.coste_hora || 0), 0);
  const costeProductos = prods.reduce((s, p) => {
    const pr = productos.find((x) => x.id === p.producto_id);
    return s + (Number(p.dosis_ha) || 0) * superficie * (Number(pr?.precio_medio) || 0);
  }, 0);
  const coste = costeHora * horasNum + costeProductos;

  function guardar() {
    const payload = {
      labor_id: laborId,
      fecha,
      recinto_ids: recintoIds,
      maquinaria_ids: maqIds,
      apero_ids: aperoIds,
      trabajador_ids: esGestor ? trabIds : [],
      observaciones: obs || null,
    };
    if (modo === "completo") {
      if (horaInicio && horasNum) {
        const ini = new Date(`${fecha}T${horaInicio}:00`);
        payload.inicio = ini.toISOString();
        payload.fin = new Date(ini.getTime() + horasNum * 3600000).toISOString();
      } else {
        payload.horas_totales = horasNum || null;
        if (planificar && horaInicio) payload.inicio = new Date(`${fecha}T${horaInicio}:00`).toISOString();
      }
    }
    if (esAplicacion && prods.length) {
      payload.aplicacion = {
        tipo: TIPO_APLICACION[labor.categoria],
        plaga_o_motivo: motivo || null,
        metodo_aplicacion: metodo || null,
        justificacion: justificacion || null,
        volumen_caldo_l_ha: caldo === "" ? null : String(caldo).replace(",", "."),
        productos: prods.map((p) => ({ ...p, dosis_ha: String(p.dosis_ha).replace(",", ".") })),
      };
    }
    if (labor?.categoria === "riego") {
      const n = (x) => (x === "" || x == null ? null : String(x).replace(",", "."));
      payload.riego = {
        sistema: riego.sistema || null,
        m3_ha: riego.porHa ? n(riego.m3_ha) : null,
        volumen_m3: riego.porHa ? null : n(riego.volumen_m3),
        fertirrigacion: riego.fertirrigacion,
      };
    }
    onGuardar(payload);
  }

  const faltan = [];
  if (!laborId) faltan.push("la labor");
  if (!recintoIds.length) faltan.push("la parcela");
  if (modo === "completo" && !horasNum && !planificar) faltan.push("las horas");

  return (
    <div className="space-y-5">
      <div>
        <p className="mb-2 text-sm font-bold text-stone-700">¿Qué trabajo?</p>
        <Fichas opciones={opcionesLabor} valor={laborId} onCambio={elegirLabor} />
        {!verTodasLabores && labores.length > 16 && (
          <button type="button" onClick={() => setVerTodasLabores(true)} className="mt-2 text-sm font-semibold text-olivo-700">
            Ver todas las labores
          </button>
        )}
      </div>

      <div>
        <p className="mb-2 text-sm font-bold text-stone-700">
          ¿Dónde? {superficie > 0 && <span className="font-normal text-stone-500">· {num(superficie)} ha</span>}
        </p>
        <Fichas multiple opciones={opcionesRecinto} valor={recintoIds} onCambio={setRecintoIds} vacio="Aún no tienes parcelas. Añádelas en Más → Parcelas." />
        {!verTodosRecintos && recintos.length > 10 && (
          <button type="button" onClick={() => setVerTodosRecintos(true)} className="mt-2 text-sm font-semibold text-olivo-700">
            Ver todas las parcelas ({recintos.length})
          </button>
        )}
      </div>

      {esAplicacion && (
        <div className="rounded-2xl border-2 border-tierra-100 bg-tierra-50 p-3">
          <p className="mb-2 text-sm font-bold text-tierra-700">Productos aplicados</p>
          <Fichas
            multiple
            opciones={productosOrdenados.map((p) => ({
              value: p.id,
              label: p.nombre,
              extra: p.stock != null ? `${num(p.stock, 1)} ${p.unidad}` : null,
            }))}
            valor={prods.map((p) => p.producto_id)}
            onCambio={(ids) => {
              const actual = prods.map((p) => p.producto_id);
              const cambiado = ids.find((i) => !actual.includes(i)) || actual.find((i) => !ids.includes(i));
              if (cambiado) toggleProducto(cambiado);
            }}
            vacio="Sin productos. Escanea un albarán de compra y aparecerán aquí."
          />
          {prods.map((p, i) => {
            const pr = productos.find((x) => x.id === p.producto_id);
            return (
              <div key={p.producto_id} className="mt-3">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-semibold">{pr?.nombre}</span>
                <input
                  inputMode="decimal"
                  className={`${claseInput} w-24 text-right`}
                  value={p.dosis_ha}
                  placeholder="dosis"
                  onChange={(e) => setProds(prods.map((x, j) => (j === i ? { ...x, dosis_ha: e.target.value } : x)))}
                />
                <span className="w-12 text-sm text-stone-600">{p.unidad_dosis}</span>
              </div>
              <ComprobacionFito
                producto={pr}
                recintos={recintos.filter((r) => recintoIds.includes(r.id))}
                cultivos={cultivos}
                dosisHa={Number(String(p.dosis_ha).replace(",", ".")) || 0}
                caldoHa={Number(String(caldo).replace(",", ".")) || 0}
                plaga={motivo}
                fecha={fecha}
                online={online}
              />
              </div>
            );
          })}
          {prods.length > 0 && superficie > 0 && (
            <p className="mt-2 text-xs text-tierra-700">
              Total: {prods.map((p) => `${num((Number(String(p.dosis_ha).replace(",", ".")) || 0) * superficie, 1)} ${productos.find((x) => x.id === p.producto_id)?.unidad}`).join(" + ")} en {num(superficie)} ha
            </p>
          )}
          <Input className="mt-3" placeholder={labor.categoria === "fertilizacion" ? "Motivo (ej. abonado de fondo, cobertera…)" : "Motivo / plaga (ej. repilo, prays…)"} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          <p className="mb-1 mt-3 text-sm font-bold text-tierra-700">¿Cómo se ha aplicado?</p>
          <Fichas
            opciones={(labor.categoria === "fertilizacion" ? METODOS_FERTILIZACION : METODOS_TRATAMIENTO).map(([value, label]) => ({ value, label }))}
            valor={metodo}
            onCambio={(v) => setMetodo(v || "")}
          />
          {labor.categoria !== "fertilizacion" && prods.length > 0 && (
            <div className="mt-3 flex items-center gap-2">
              <span className="text-sm font-semibold text-tierra-700">Caldo</span>
              <input inputMode="decimal" className={`${claseInput} w-28 text-right`} value={caldo} placeholder="litros" onChange={(e) => setCaldo(e.target.value)} />
              <span className="text-sm text-stone-600">l/ha</span>
            </div>
          )}
          {labor.categoria !== "fertilizacion" && (
            <Input className="mt-3" placeholder="Justificación (opcional: umbral, aviso, recomendación del asesor…)" value={justificacion} onChange={(e) => setJustificacion(e.target.value)} />
          )}
        </div>
      )}

      {labor?.categoria === "riego" && (
        <div className="rounded-2xl border-2 border-sky-100 bg-sky-50 p-3">
          <p className="mb-2 text-sm font-bold text-sky-800">💧 Agua aplicada</p>
          <div className="mb-2 flex gap-2">
            {[
              [true, "Por hectárea (m³/ha)"],
              [false, "Total (m³)"],
            ].map(([v, t]) => (
              <button key={t} type="button" onClick={() => setRiego({ ...riego, porHa: v })} className={`rounded-full px-3 py-1.5 text-sm font-bold ${riego.porHa === v ? "bg-sky-700 text-white" : "bg-white text-stone-700"}`}>
                {t}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input
              inputMode="decimal"
              className={`${claseInput} w-32 text-right`}
              value={riego.porHa ? riego.m3_ha : riego.volumen_m3}
              placeholder="0"
              onChange={(e) => setRiego(riego.porHa ? { ...riego, m3_ha: e.target.value } : { ...riego, volumen_m3: e.target.value })}
            />
            <span className="text-sm text-stone-600">{riego.porHa ? "m³/ha" : "m³ en total"}</span>
          </div>
          {superficie > 0 && (Number(String(riego.porHa ? riego.m3_ha : riego.volumen_m3).replace(",", ".")) || 0) > 0 && (
            <p className="mt-1 text-xs text-sky-800">
              {riego.porHa
                ? `≈ ${num((Number(String(riego.m3_ha).replace(",", ".")) || 0) * superficie, 0)} m³ en ${num(superficie)} ha (${num((Number(String(riego.m3_ha).replace(",", ".")) || 0) / 10, 1)} mm)`
                : `≈ ${num((Number(String(riego.volumen_m3).replace(",", ".")) || 0) / superficie, 1)} m³/ha en ${num(superficie)} ha`}
            </p>
          )}
          <p className="mb-1 mt-3 text-sm font-bold text-sky-800">Sistema</p>
          <Fichas opciones={SISTEMAS_RIEGO.map(([value, label]) => ({ value, label }))} valor={riego.sistema} onCambio={(v) => setRiego({ ...riego, sistema: v || "" })} />
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-5 w-5" checked={riego.fertirrigacion} onChange={(e) => setRiego({ ...riego, fertirrigacion: e.target.checked })} />
            Con abono (fertirrigación)
          </label>
        </div>
      )}

      {(maquinaria.length > 0 || aperos.length > 0) && (
        <div>
          <p className="mb-2 text-sm font-bold text-stone-700">Maquinaria y aperos</p>
          <Fichas multiple opciones={maquinaria.map((m) => ({ value: m.id, label: m.nombre }))} valor={maqIds} onCambio={setMaqIds} vacio="" />
          {aperos.length > 0 && (
            <div className="mt-2">
              <Fichas multiple opciones={aperos.map((m) => ({ value: m.id, label: m.nombre }))} valor={aperoIds} onCambio={setAperoIds} vacio="" />
            </div>
          )}
        </div>
      )}

      {esGestor && trabajadores.length > 1 && (
        <div>
          <p className="mb-2 text-sm font-bold text-stone-700">¿Quién?</p>
          <Fichas multiple opciones={trabajadores.map((t) => ({ value: t.id, label: t.nombre }))} valor={trabIds} onCambio={setTrabIds} />
        </div>
      )}

      {modo === "completo" && (
        <div className="grid grid-cols-3 gap-2">
          <Campo etiqueta="Día">
            <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
          </Campo>
          <Campo etiqueta={planificar ? "Hora" : "Empezó"}>
            <Input type="time" value={horaInicio} onChange={(e) => setHoraInicio(e.target.value)} />
          </Campo>
          <Campo etiqueta={planificar ? "Horas prev." : "Horas"}>
            <div className="flex">
              <Input inputMode="decimal" value={horas} onChange={(e) => setHoras(e.target.value)} placeholder="0" className="text-center" />
            </div>
          </Campo>
          <div className="col-span-3 flex gap-2">
            {[1, 2, 3, 4, 6, 8].map((h) => (
              <button type="button" key={h} onClick={() => setHoras(h)} className={`h-10 flex-1 rounded-xl text-sm font-bold ${horasNum === h ? "bg-olivo-700 text-white" : "bg-white text-stone-700 border border-stone-200"}`}>
                {h}h
              </button>
            ))}
          </div>
        </div>
      )}

      <Campo etiqueta="Notas (opcional)">
        <Input value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Algo que quieras recordar" />
      </Campo>

      {esGestor && modo === "completo" && coste > 0 && (
        <p className="rounded-xl bg-white px-3 py-2 text-[15px] text-stone-700">
          Coste estimado: <b>{euros(coste)}</b> <span className="text-xs text-stone-500">(revisable después)</span>
        </p>
      )}

      {faltan.length > 0 && <p className="text-sm font-semibold text-tierra-700">Falta: {faltan.join(", ")}</p>}

      <div className="sticky bottom-20 flex gap-3 bg-arena/90 py-2 backdrop-blur">
        {onCancelar && (
          <Boton variante="secundario" grande onClick={onCancelar}>
            Cancelar
          </Boton>
        )}
        <Boton grande className="flex-1" disabled={faltan.length > 0 || guardando} onClick={guardar}>
          {guardando ? "Guardando…" : textoGuardar}
        </Boton>
      </div>
    </div>
  );
}
