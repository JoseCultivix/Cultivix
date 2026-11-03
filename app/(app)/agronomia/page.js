"use client";
import { Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { apiPost, supabase } from "@/lib/supabase";
import { useApp } from "@/components/AppProvider";
import { useVoz } from "@/components/useVoz";
import { Hoja, Select } from "@/components/ui";
import { blobABase64, comprimirImagen } from "@/lib/imagen";
import { fechaCorta } from "@/lib/formato";

const EJEMPLOS = [
  "¿Cuándo es buen momento para tratar el repilo en mi olivar?",
  "¿Cuánto nitrógeno le falta a mis parcelas esta campaña?",
  "Tengo hojas amarillas en los pistachos, ¿qué puede ser?",
  "¿Qué labores debería hacer este mes en mis cultivos?",
];

// Negritas y listas sencillas, sin HTML (seguro frente a inyección)
function Texto({ t }) {
  const linea = (s, k) =>
    s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith("**") && p.endsWith("**") ? <b key={`${k}-${i}`}>{p.slice(2, -2)}</b> : <span key={`${k}-${i}`}>{p}</span>));
  const bloques = [];
  let lista = null;
  t.split("\n").forEach((l, i) => {
    const m = l.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)/);
    if (m) {
      if (!lista) bloques.push((lista = { tipo: "ul", items: [] }));
      lista.items.push(m[1]);
      return;
    }
    lista = null;
    if (!l.trim()) return;
    const h = l.match(/^#{1,4}\s+(.*)/);
    bloques.push({ tipo: h ? "h" : "p", texto: h ? h[1] : l, k: i });
  });
  return (
    <div className="space-y-2 text-[16px] leading-relaxed">
      {bloques.map((b, i) =>
        b.tipo === "ul" ? (
          <ul key={i} className="ml-5 list-disc space-y-1">
            {b.items.map((x, j) => (
              <li key={j}>{linea(x, `${i}-${j}`)}</li>
            ))}
          </ul>
        ) : b.tipo === "h" ? (
          <p key={i} className="font-extrabold text-olivo-900">
            {linea(b.texto, i)}
          </p>
        ) : (
          <p key={i}>{linea(b.texto, i)}</p>
        ),
      )}
    </div>
  );
}

function AgronomIA() {
  const { empresaId, recintos, online, notificar } = useApp();
  const q = useSearchParams();
  const [msgs, setMsgs] = useState([]);
  const [texto, setTexto] = useState("");
  const [pensando, setPensando] = useState(false);
  const [recintoId, setRecintoId] = useState("");
  const [foto, setFoto] = useState(null); // { data, media_type, url }
  const [historial, setHistorial] = useState(null);
  const fin = useRef(null);
  const inputFoto = useRef(null);
  const voz = useVoz({ onFinal: (t) => setTexto((x) => (x ? x + " " : "") + t) });

  // La conversación se guarda en el móvil para poder seguirla al volver
  const clave = `cultivix.agronomia.${empresaId}`;
  const cargada = useRef(false);
  useEffect(() => {
    try {
      const g = JSON.parse(localStorage.getItem(clave) || "null");
      if (g?.msgs?.length) setMsgs(g.msgs);
    } catch {}
    cargada.current = true;
    const inicial = q.get("q");
    if (inicial) setTexto(inicial);
  }, [clave]); // eslint-disable-line
  useLayoutEffect(() => {
    if (!cargada.current) return;
    try {
      const limpios = msgs.filter((m) => !m.error).slice(-30).map(({ foto, ...m }) => ({ ...m, conFoto: !!foto || m.conFoto }));
      localStorage.setItem(clave, JSON.stringify({ msgs: limpios }));
    } catch {}
  }, [msgs, clave]);

  function nuevaConsulta() {
    setMsgs([]);
    setTexto("");
    setFoto(null);
  }

  function continuar(h) {
    setMsgs([
      { rol: "usuario", texto: h.pregunta },
      { rol: "asistente", texto: h.respuesta, id: h.id },
    ]);
    setHistorial(null);
    setTimeout(() => document.getElementById("pregunta-agro")?.focus(), 200);
  }
  useEffect(() => {
    fin.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, pensando]);

  async function elegirFoto(e) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    try {
      const { blob } = await comprimirImagen(f, 1568, 0.85);
      setFoto({ data: await blobABase64(blob), media_type: "image/jpeg", url: URL.createObjectURL(blob) });
    } catch {
      notificar("No se pudo leer la foto", "error");
    }
  }

  async function enviar(t) {
    const m = (t ?? texto).trim();
    if ((!m && !foto) || pensando) return;
    if (!online) return notificar("AgronomIA necesita conexión a internet", "error");
    const hist = msgs.filter((x) => !x.error).map((x) => ({ rol: x.rol, texto: x.texto }));
    const f = foto;
    setTexto("");
    setFoto(null);
    setMsgs((x) => [...x, { rol: "usuario", texto: m || "¿Qué ves en esta foto?", foto: f?.url }]);
    setPensando(true);
    try {
      const r = await apiPost("/api/agronomia", { empresa_id: empresaId, pregunta: m, historial: hist, recinto_id: recintoId || null, imagen: f ? { data: f.data, media_type: f.media_type } : null });
      setMsgs((x) => [...x, { rol: "asistente", texto: r.respuesta, fuentes: r.fuentes, id: r.id }]);
    } catch (e) {
      setMsgs((x) => [...x, { rol: "asistente", texto: e.message, error: true }]);
    }
    setPensando(false);
  }

  async function valorar(i, v) {
    const m = msgs[i];
    if (!m.id) return;
    await supabase.from("consultas_agronomia").update({ valoracion: v }).eq("id", m.id);
    setMsgs((x) => x.map((y, j) => (j === i ? { ...y, valoracion: v } : y)));
  }

  async function verHistorial() {
    const { data } = await supabase.from("consultas_agronomia").select("id, created_at, pregunta, respuesta").eq("empresa_id", empresaId).order("created_at", { ascending: false }).limit(30);
    setHistorial(data || []);
  }

  const parcelas = [...new Map(recintos.map((r) => [r.id, { value: r.id, label: `${r.parcela_nombre}${r.n_en_parcela > 1 && r.recinto_sigpac ? ` rec. ${r.recinto_sigpac}` : ""}${r.cultivo ? ` · ${r.cultivo}` : ""}` }])).values()];

  return (
    <div className="mx-auto flex h-[calc(100dvh-4rem)] max-w-2xl flex-col">
      <div className="flex-1 overflow-y-auto px-4 pt-5 pb-4">
        <div className="mb-3 flex items-center justify-between">
          <h1 className="text-2xl font-black text-olivo-900">🌿 AgronomIA</h1>
          <div className="flex gap-3">
            {msgs.length > 0 && (
              <button type="button" onClick={nuevaConsulta} className="text-sm font-bold text-tierra-700">
                + Nueva
              </button>
            )}
            <button type="button" onClick={verHistorial} className="text-sm font-bold text-olivo-700">
              Anteriores
            </button>
          </div>
        </div>
        {msgs.length === 0 && (
          <div>
            <p className="text-[16px] text-stone-700">Tu asesor técnico de bolsillo: plagas, enfermedades, abonado, riego, poda… Conoce tus cultivos y lo que has aplicado. Puedes mandarle una foto.</p>
            <div className="mt-4 space-y-2">
              {EJEMPLOS.map((e) => (
                <button key={e} type="button" onClick={() => enviar(e)} className="block w-full rounded-2xl bg-white px-4 py-3 text-left text-[15px] text-stone-700 shadow-sm">
                  «{e}»
                </button>
              ))}
            </div>
            <p className="mt-4 rounded-2xl bg-amber-50 p-3 text-xs text-amber-900">
              Las respuestas son orientativas y pueden contener errores. No sustituyen a tu asesor inscrito en el ROPO ni a la etiqueta del producto: antes de tratar, comprueba que el producto está autorizado para tu cultivo, la dosis y el plazo de seguridad.
            </p>
          </div>
        )}
        <div className="space-y-3">
          {msgs.map((m, i) =>
            m.rol === "usuario" ? (
              <div key={i} className="ml-10 rounded-2xl bg-olivo-700 px-4 py-3 text-white">
                {m.foto && <img src={m.foto} alt="Foto enviada" className="mb-2 max-h-48 rounded-xl" />}
                {!m.foto && m.conFoto && <p className="mb-1 text-xs opacity-80">📷 con foto</p>}
                {m.texto}
              </div>
            ) : (
              <div key={i} className={`mr-4 rounded-2xl px-4 py-3 shadow-sm ${m.error ? "bg-red-50 text-red-800" : "bg-white"}`}>
                <Texto t={m.texto} />
                {m.fuentes?.length > 0 && (
                  <div className="mt-2 border-t border-stone-100 pt-2 text-xs text-stone-500">
                    Fuentes:{" "}
                    {m.fuentes.map((f, j) => (
                      <a key={j} href={f.url} target="_blank" rel="noopener noreferrer" className="mr-2 underline">
                        {f.titulo.slice(0, 50)}
                      </a>
                    ))}
                  </div>
                )}
                {m.id && (
                  <div className="mt-2 flex items-center gap-3 text-sm text-stone-500">
                    <span>¿Te ha servido?</span>
                    <button type="button" onClick={() => valorar(i, 1)} className={m.valoracion === 1 ? "text-2xl" : "text-xl opacity-60"} aria-label="Útil">
                      👍
                    </button>
                    <button type="button" onClick={() => valorar(i, -1)} className={m.valoracion === -1 ? "text-2xl" : "text-xl opacity-60"} aria-label="No útil">
                      👎
                    </button>
                  </div>
                )}
              </div>
            ),
          )}
          {pensando && <div className="mr-10 w-40 animate-pulse rounded-2xl bg-white px-4 py-3 text-stone-500 shadow-sm">Pensando… 🌱</div>}
          <div ref={fin} />
        </div>
      </div>

      <div className="border-t border-stone-200 bg-arena px-3 pt-2 pb-3">
        <div className="mb-2 flex items-center gap-2">
          <Select className="!py-1.5 text-sm" vacio="Sobre toda la explotación" opciones={parcelas} value={recintoId} onChange={(e) => setRecintoId(e.target.value)} />
          {foto && (
            <span className="relative shrink-0">
              <img src={foto.url} alt="Foto" className="h-10 w-10 rounded-lg object-cover" />
              <button type="button" onClick={() => setFoto(null)} className="absolute -top-2 -right-2 h-5 w-5 rounded-full bg-stone-700 text-xs text-white" aria-label="Quitar foto">
                ×
              </button>
            </span>
          )}
        </div>
        {voz.escuchando && <p className="mb-2 text-center text-[15px] font-semibold text-olivo-800">{voz.parcial || "Te escucho…"}</p>}
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            enviar();
          }}
        >
          <button type="button" onClick={() => inputFoto.current?.click()} className="h-14 w-12 shrink-0 rounded-full bg-white text-2xl shadow" aria-label="Foto">
            📷
          </button>
          <input ref={inputFoto} type="file" accept="image/*" capture="environment" className="hidden" onChange={elegirFoto} />
          {voz.disponible && (
            <button type="button" onClick={voz.escuchando ? voz.parar : voz.empezar} className={`h-14 w-12 shrink-0 rounded-full text-2xl shadow ${voz.escuchando ? "animate-pulse bg-red-600 text-white" : "bg-olivo-700 text-white"}`} aria-label="Dictar">
              🎤
            </button>
          )}
          <input id="pregunta-agro" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={msgs.length ? "Sigue preguntando…" : "Pregunta lo que quieras…"} className="h-14 min-w-0 flex-1 rounded-full border-2 border-stone-200 bg-white px-4 text-[17px] outline-none focus:border-olivo-500" />
          <button type="submit" disabled={(!texto.trim() && !foto) || pensando} className="h-14 w-12 shrink-0 rounded-full bg-tierra-600 text-2xl text-white disabled:opacity-40" aria-label="Enviar">
            ➤
          </button>
        </form>
      </div>

      <Hoja abierta={!!historial} onCerrar={() => setHistorial(null)} titulo="Consultas anteriores">
        {historial?.length === 0 && <p className="text-stone-500">Aún no hay consultas.</p>}
        <div className="space-y-3">
          {historial?.map((h) => (
            <details key={h.id} className="rounded-2xl bg-white p-3 shadow-sm">
              <summary className="cursor-pointer font-bold text-olivo-900">
                {h.pregunta} <span className="text-xs font-normal text-stone-500">· {fechaCorta(h.created_at)}</span>
              </summary>
              <div className="mt-2">
                <Texto t={h.respuesta} />
              </div>
              <button type="button" onClick={() => continuar(h)} className="mt-3 w-full rounded-xl bg-olivo-700 py-2.5 font-bold text-white">
                Seguir con esta consulta
              </button>
            </details>
          ))}
        </div>
      </Hoja>
    </div>
  );
}

export default function Pagina() {
  return (
    <Suspense>
      <AgronomIA />
    </Suspense>
  );
}
