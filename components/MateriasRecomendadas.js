"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { claseInput } from "./ui";

/**
 * Recomendación del técnico: materias activas (no productos comerciales) del Registro del MAPA,
 * con la plaga para la que se recomiendan en los cultivos de las parcelas elegidas.
 * valor: [{ materia, agente, codigo_cultivo, cultivo, plazo_max, nota }]
 */
export default function MateriasRecomendadas({ valor = [], onCambio, grupos = [], online = true }) {
  const [texto, setTexto] = useState("");
  const [res, setRes] = useState(null);
  const [buscando, setBuscando] = useState(false);
  const [elegida, setElegida] = useState(null); // { materia, autorizada }
  const [plagas, setPlagas] = useState(null);
  const [agente, setAgente] = useState(null); // { agente, codigo_cultivo, plazo_max }
  const [nota, setNota] = useState("");
  const codigos = grupos.map((g) => g.codigo).filter(Boolean);
  const nombreCultivo = (c) => grupos.find((g) => g.codigo === c)?.cultivo || "";

  useEffect(() => {
    if (!online || texto.trim().length < 2) return setRes(null);
    let vivo = true;
    setBuscando(true);
    const t = setTimeout(async () => {
      const { data } = await supabase.rpc("fito_buscar_materia", { p_texto: texto.trim(), p_codigos: codigos });
      if (vivo) {
        setRes(data || []);
        setBuscando(false);
      }
    }, 350);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [texto, codigos.join(","), online]); // eslint-disable-line

  async function elegir(m) {
    setElegida(m);
    setAgente(null);
    setNota("");
    setPlagas(null);
    if (!codigos.length) return setPlagas([]);
    const { data } = await supabase.rpc("fito_plagas_materia", { p_materia: m.materia, p_codigos: codigos });
    setPlagas(data || []);
  }

  function añadir() {
    onCambio([
      ...valor,
      {
        materia: elegida.materia,
        agente: agente?.agente || null,
        codigo_cultivo: agente?.codigo_cultivo || null,
        cultivo: agente ? nombreCultivo(agente.codigo_cultivo) : null,
        plazo_max: agente?.plazo_max ?? null,
        nota: nota.trim() || null,
      },
    ]);
    setElegida(null);
    setTexto("");
    setRes(null);
  }

  return (
    <div className="rounded-2xl border-2 border-tierra-100 bg-tierra-50 p-3">
      <p className="text-sm font-bold text-tierra-700">🧪 Materias activas recomendadas</p>
      <p className="mb-2 text-xs text-tierra-700">El agricultor elegirá el producto comercial que tenga o compre con esa materia activa.</p>

      {valor.map((m, i) => (
        <div key={i} className="mb-2 flex items-start gap-2 rounded-xl bg-white p-2">
          <div className="min-w-0 flex-1 text-[15px]">
            <p className="font-extrabold text-olivo-900">{m.materia}</p>
            {m.agente && (
              <p className="text-sm text-stone-700">
                Para: {m.agente}
                {m.cultivo ? ` (${m.cultivo})` : ""}
              </p>
            )}
            {m.plazo_max != null && <p className="text-xs text-stone-500">Plazo de seguridad según producto: hasta {m.plazo_max} días</p>}
            {m.nota && <p className="text-sm text-stone-600">📝 {m.nota}</p>}
          </div>
          <button type="button" aria-label="Quitar" onClick={() => onCambio(valor.filter((_, j) => j !== i))} className="h-9 w-9 shrink-0 rounded-full bg-stone-100 font-bold text-stone-600">
            ✕
          </button>
        </div>
      ))}

      {!elegida && (
        <>
          <input className={claseInput} placeholder="Buscar materia activa (cobre, deltametrin, azufre…)" value={texto} onChange={(e) => setTexto(e.target.value)} disabled={!online} />
          {!online && <p className="mt-1 text-xs text-stone-500">Sin cobertura: la búsqueda en el Registro necesita conexión.</p>}
          {!codigos.length && <p className="mt-1 text-xs text-stone-500">Elige antes las parcelas para ver si está autorizada en su cultivo.</p>}
          {buscando && <p className="mt-2 text-sm text-stone-500">Buscando en el Registro del MAPA…</p>}
          {res && !buscando && (
            <div className="mt-2 max-h-72 space-y-1.5 overflow-y-auto">
              {res.length === 0 && <p className="text-sm text-stone-500">No hay materias activas vigentes con ese nombre.</p>}
              {res.map((m) => (
                <button key={m.materia} type="button" onClick={() => elegir(m)} className="flex w-full items-center justify-between gap-2 rounded-xl bg-white px-3 py-2 text-left">
                  <span className="min-w-0">
                    <span className="block font-bold text-olivo-900">{m.materia}</span>
                    <span className="text-xs text-stone-500">{m.productos} producto(s) vigentes</span>
                  </span>
                  {m.autorizada === true && <span className="shrink-0 rounded-full bg-olivo-100 px-2 py-0.5 text-xs font-bold text-olivo-800">✓ Autorizada</span>}
                  {m.autorizada === false && <span className="shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-800">No en tu cultivo</span>}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {elegida && (
        <div className="rounded-xl bg-white p-3">
          <div className="flex items-start justify-between gap-2">
            <p className="font-extrabold text-olivo-900">{elegida.materia}</p>
            <button type="button" onClick={() => setElegida(null)} className="text-sm font-bold text-stone-500">
              Cambiar
            </button>
          </div>
          {elegida.autorizada === false && (
            <p className="mt-1 rounded-lg bg-red-50 px-2 py-1 text-xs font-semibold text-red-800">⚠️ Ningún producto con esta materia activa está autorizado en los cultivos de las parcelas elegidas.</p>
          )}
          <p className="mb-1 mt-2 text-sm font-bold text-stone-700">¿Para qué plaga o enfermedad?</p>
          {plagas === null ? (
            <p className="text-sm text-stone-500">Cargando usos autorizados…</p>
          ) : (
            <div className="max-h-64 space-y-1.5 overflow-y-auto">
              {plagas.map((p) => {
                const sel = agente?.agente === p.agente && agente?.codigo_cultivo === p.codigo_cultivo;
                return (
                  <button
                    key={p.codigo_cultivo + p.agente}
                    type="button"
                    onClick={() => setAgente(sel ? null : p)}
                    className={`block w-full rounded-xl px-3 py-2 text-left text-sm ${sel ? "bg-olivo-700 text-white" : "bg-stone-100 text-stone-800"}`}
                  >
                    <b>{p.agente}</b>
                    <span className={`block text-xs ${sel ? "text-olivo-100" : "text-stone-500"}`}>
                      {grupos.length > 1 ? `${nombreCultivo(p.codigo_cultivo)} · ` : ""}
                      {p.productos} producto(s){p.plazo_max != null ? ` · plazo hasta ${p.plazo_max} días` : ""}
                    </span>
                  </button>
                );
              })}
              {plagas.length === 0 && <p className="text-sm text-stone-500">Sin usos autorizados en estos cultivos.</p>}
            </div>
          )}
          <input className={`${claseInput} mt-2`} placeholder="Indicaciones (dosis, momento, mojado…) opcional" value={nota} onChange={(e) => setNota(e.target.value)} />
          <button type="button" onClick={añadir} className="mt-2 min-h-11 w-full rounded-2xl bg-tierra-600 font-bold text-white">
            + Añadir a la recomendación
          </button>
        </div>
      )}
    </div>
  );
}
