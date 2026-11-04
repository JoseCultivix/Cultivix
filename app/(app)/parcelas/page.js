"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { apiGet, supabase } from "@/lib/supabase";
import { useApp } from "@/components/AppProvider";
import { Boton, Campo, Etiqueta, Fichas, Hoja, Input, Pagina, Select, Tarjeta, Vacio } from "@/components/ui";
import { bbox, centro } from "@/lib/geo";
import { asignarCultivo } from "@/lib/campanas";
import { CULTIVO_POR_USO, USOS_SIGPAC, num } from "@/lib/formato";
import dynamic from "next/dynamic";

const MapaSigpac = dynamic(() => import("@/components/MapaSigpac"), { ssr: false, loading: () => <div className="grid h-full place-items-center text-stone-500">Cargando mapa…</div> });

export default function PaginaParcelas() {
  return (
    <Suspense>
      <Parcelas />
    </Suspense>
  );
}

function Parcelas() {
  const { empresaId, recintos, esGestor, recargar, notificar } = useApp();
  const q = useSearchParams();
  const [fincas, setFincas] = useState([]);
  const [parcelas, setParcelas] = useState([]);
  const [hojaSigpac, setHojaSigpac] = useState(q.get("bienvenida") === "1");
  const [hojaManual, setHojaManual] = useState(false);
  const [editar, setEditar] = useState(null);

  async function cargar() {
    const [f, p] = await Promise.all([
      supabase.from("fincas").select("*").eq("empresa_id", empresaId).eq("activa", true).order("nombre"),
      supabase.from("parcelas").select("*").eq("empresa_id", empresaId).eq("activa", true).order("nombre"),
    ]);
    setFincas(f.data || []);
    setParcelas(p.data || []);
  }
  useEffect(() => {
    cargar();
  }, [empresaId]); // eslint-disable-line

  const total = recintos.reduce((s, r) => s + Number(r.superficie_sigpac_ha || 0), 0);
  const porFinca = useMemo(() => {
    const g = {};
    for (const p of parcelas) {
      const k = p.finca_id || "sin";
      (g[k] = g[k] || []).push({ ...p, recintos: recintos.filter((r) => r.parcela_id === p.id) });
    }
    return g;
  }, [parcelas, recintos]);

  async function trasGuardar(msg) {
    await Promise.all([cargar(), recargar()]);
    notificar(msg);
  }

  return (
    <Pagina
      titulo="Parcelas"
      subtitulo={`${parcelas.length} parcelas · ${recintos.length} recintos · ${num(total)} ha`}
      volver="/mas"
      accion={esGestor && <Boton onClick={() => setHojaSigpac(true)}>+ SIGPAC</Boton>}
    >
      {q.get("bienvenida") === "1" && (
        <p className="mb-4 rounded-2xl bg-olivo-100 p-4 text-[15px] text-olivo-900">
          🎉 ¡Explotación creada! Añade ahora tus parcelas. La forma más rápida: ve a la parcela y pulsa <b>«Estoy en la parcela»</b>, o escribe la referencia SIGPAC de tu PAC.
        </p>
      )}
      {parcelas.length === 0 ? (
        <Vacio icono="🗺️" titulo="Sin parcelas todavía" texto="Impórtalas de SIGPAC: superficie, uso y linderos se rellenan solos.">
          {esGestor && <Boton onClick={() => setHojaSigpac(true)}>Importar de SIGPAC</Boton>}
          {esGestor && (
            <Boton variante="secundario" onClick={() => setHojaManual(true)}>
              Añadir a mano
            </Boton>
          )}
        </Vacio>
      ) : (
        <>
          {Object.entries(porFinca).map(([fid, lista]) => (
            <div key={fid} className="mb-5">
              <p className="mb-2 text-sm font-bold uppercase tracking-wide text-stone-500">{fincas.find((f) => f.id === fid)?.nombre || "Sin finca"}</p>
              <div className="space-y-2">
                {lista.map((p) => {
                  const ha = p.recintos.reduce((s, r) => s + Number(r.superficie_sigpac_ha || 0), 0) || p.superficie_total_ha;
                  const cult = [...new Set(p.recintos.map((r) => r.cultivo).filter(Boolean))].join(", ");
                  const conSigpac = p.recintos.some((r) => r.fuente === "sigpac");
                  return (
                    <button key={p.id} type="button" onClick={() => esGestor && setEditar(p)} className="block w-full rounded-2xl bg-white p-3 text-left shadow-sm">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-lg font-extrabold text-olivo-900">{p.nombre}</p>
                        <span className="font-bold text-stone-700">{num(ha)} ha</span>
                      </div>
                      <p className="text-[15px] text-stone-600">
                        {cult || "Sin cultivo"} · {p.recintos.length} recinto{p.recintos.length === 1 ? "" : "s"}{" "}
                        {conSigpac ? <Etiqueta>SIGPAC</Etiqueta> : <Etiqueta color="ambar">sin SIGPAC</Etiqueta>}
                      </p>
                      {conSigpac && <p className="mt-1 text-xs text-stone-500">{p.recintos.map((r) => r.referencia_sigpac).join(" · ")}</p>}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {esGestor && (
            <Boton variante="secundario" className="w-full" onClick={() => setHojaManual(true)}>
              + Añadir parcela a mano
            </Boton>
          )}
        </>
      )}

      <Hoja abierta={hojaSigpac} onCerrar={() => setHojaSigpac(false)} titulo="Importar de SIGPAC">
        <ImportarSigpac
          fincas={fincas}
          parcelas={parcelas}
          onHecho={(m) => {
            setHojaSigpac(false);
            trasGuardar(m);
          }}
        />
      </Hoja>
      <Hoja abierta={hojaManual} onCerrar={() => setHojaManual(false)} titulo="Parcela a mano">
        <ParcelaManual
          fincas={fincas}
          onHecho={(m) => {
            setHojaManual(false);
            trasGuardar(m);
          }}
        />
      </Hoja>
      <Hoja abierta={!!editar} onCerrar={() => setEditar(null)} titulo={editar?.nombre}>
        {editar && (
          <EditarParcela
            parcela={editar}
            fincas={fincas}
            onHecho={(m) => {
              setEditar(null);
              trasGuardar(m);
            }}
          />
        )}
      </Hoja>
    </Pagina>
  );
}

// ---------------------------------------------------------------------
async function obtenerFinca(empresaId, fincaId, nuevaFinca) {
  if (fincaId) return fincaId;
  if (!nuevaFinca?.trim()) return null;
  const { data, error } = await supabase.from("fincas").insert({ empresa_id: empresaId, nombre: nuevaFinca.trim() }).select("id").single();
  if (error) throw error;
  return data.id;
}

function SelectorFinca({ fincas, fincaId, setFincaId, nueva, setNueva }) {
  return (
    <Campo etiqueta="Finca (agrupación)">
      <Select
        vacio="➕ Nueva finca / ninguna"
        opciones={fincas.map((f) => ({ value: f.id, label: f.nombre }))}
        value={fincaId || ""}
        onChange={(e) => setFincaId(e.target.value || null)}
      />
      {!fincaId && <Input className="mt-2" placeholder="Nombre de la nueva finca (opcional)" value={nueva} onChange={(e) => setNueva(e.target.value)} />}
    </Campo>
  );
}

function ImportarSigpac({ fincas, parcelas, onHecho }) {
  const { empresaId, campanas, cultivos, actualizarGps, notificar, recintos: existentes, gps } = useApp();
  const [modo, setModo] = useState("mapa");
  const [lugar, setLugar] = useState("");
  const [lugares, setLugares] = useState(null);
  const [centrarEn, setCentrarEn] = useState(null);

  async function buscarLugar() {
    if (lugar.trim().length < 2) return;
    setLugares([]);
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&countrycodes=es&limit=6&accept-language=es&q=${encodeURIComponent(lugar.trim())}`);
      const j = await r.json();
      setLugares(j.map((x) => ({ nombre: x.display_name, lat: Number(x.lat), lon: Number(x.lon) })));
      if (j.length === 1) irA(j[0].lat, j[0].lon);
    } catch {
      notificar("No se ha podido buscar ese sitio ahora", "error");
      setLugares(null);
    }
  }
  function irA(lat, lon, zoom = 15) {
    setCentrarEn({ lat: Number(lat), lon: Number(lon), zoom, t: Date.now() });
    setLugares(null);
  }
  const [ref, setRef] = useState({ pr: "", mu: "", po: "", pa: "", ag: "0", zo: "0" });
  const [buscando, setBuscando] = useState(false);
  const [res, setRes] = useState(null);
  const [sel, setSel] = useState([]);
  const [cultivoDe, setCultivoDe] = useState({});
  const [nombre, setNombre] = useState("");
  const [destino, setDestino] = useState(""); // parcela existente
  const [fincaId, setFincaId] = useState(null);
  const [nuevaFinca, setNuevaFinca] = useState("");
  const [guardando, setGuardando] = useState(false);

  async function buscar(punto) {
    setBuscando(true);
    if (!punto) setRes(null);
    try {
      let url;
      if (punto) url = `/api/sigpac?lat=${punto.lat}&lon=${punto.lon}`;
      else if (modo === "gps") {
        const p = await actualizarGps();
        if (!p) throw new Error("No se pudo obtener tu ubicación. Activa el GPS.");
        url = `/api/sigpac?lat=${p.lat}&lon=${p.lon}`;
      } else url = `/api/sigpac?pr=${ref.pr}&mu=${ref.mu}&ag=${ref.ag || 0}&zo=${ref.zo || 0}&po=${ref.po}&pa=${ref.pa}`;
      const j = await apiGet(url);
      if (!j.recintos?.length) throw new Error(j.aviso || "No se encontraron recintos");
      // Útiles primero, sin viales/edificaciones
      const utiles = j.recintos.filter((r) => !["CA", "ED", "ZU", "AG", "IM"].includes(r.uso_sigpac));
      setRes(j.recintos);
      setSel(j.recinto_en_punto ? [j.recinto_en_punto] : utiles.map((r) => r.recinto));
      const c = {};
      for (const r of j.recintos) {
        const nom = CULTIVO_POR_USO[r.uso_sigpac];
        c[r.recinto] = cultivos.find((x) => x.nombre === nom)?.id || "";
      }
      setCultivoDe(c);
      const r0 = j.recintos[0];
      setNombre(`Pol. ${r0.poligono} Parc. ${r0.parcela}`);
    } catch (e) {
      notificar(e.message, "error");
    } finally {
      setBuscando(false);
    }
  }

  async function guardar() {
    setGuardando(true);
    try {
      const elegidos = res.filter((r) => sel.includes(r.recinto));
      const yaEstan = elegidos.filter((r) =>
        existentes.some((e) => e.provincia_sigpac === r.provincia && e.municipio_sigpac === r.municipio && e.poligono_sigpac === r.poligono && e.parcela_sigpac === r.parcela && e.recinto_sigpac === r.recinto)
      );
      if (yaEstan.length === elegidos.length) throw new Error("Esos recintos ya están en tus parcelas");
      let parcelaId = destino || null;
      if (!parcelaId) {
        const fid = await obtenerFinca(empresaId, fincaId, nuevaFinca);
        const c = centro(elegidos.find((r) => r.geometria)?.geometria);
        const { data, error } = await supabase
          .from("parcelas")
          .insert({
            empresa_id: empresaId,
            finca_id: fid,
            nombre: nombre.trim() || "Parcela",
            superficie_total_ha: elegidos.reduce((s, r) => s + (r.superficie || 0), 0),
            latitud_centro: c?.lat,
            longitud_centro: c?.lon,
          })
          .select("id")
          .single();
        if (error) throw error;
        parcelaId = data.id;
      }
      // Si la parcela tenía un recinto provisional (sin SIGPAC), se completa en lugar de duplicar
      const provisional = destino ? existentes.find((e) => e.parcela_id === destino && e.fuente === "manual" && e.recinto_sigpac == null) : null;
      let usado = false;
      for (const r of elegidos) {
        if (yaEstan.includes(r)) continue;
        const b = bbox(r.geometria);
        const c = centro(r.geometria);
        const fila = {
          empresa_id: empresaId,
          parcela_id: parcelaId,
          provincia_sigpac: r.provincia,
          municipio_sigpac: r.municipio,
          agregado_sigpac: r.agregado,
          zona_sigpac: r.zona,
          poligono_sigpac: r.poligono,
          parcela_sigpac: r.parcela,
          recinto_sigpac: r.recinto,
          uso_sigpac: r.uso_sigpac,
          superficie_sigpac_ha: r.superficie,
          pendiente_media: r.pendiente_media,
          coef_regadio: r.coef_regadio,
          geometria: r.geometria,
          bbox_min_lon: b?.minLon,
          bbox_min_lat: b?.minLat,
          bbox_max_lon: b?.maxLon,
          bbox_max_lat: b?.maxLat,
          centro_lat: c?.lat,
          centro_lon: c?.lon,
          fuente: "sigpac",
          fecha_importacion: new Date().toISOString(),
        };
        let recId;
        if (provisional && !usado) {
          const { error } = await supabase.from("recintos").update(fila).eq("id", provisional.id);
          if (error) throw error;
          recId = provisional.id;
          usado = true;
        } else {
          const { data, error } = await supabase.from("recintos").insert(fila).select("id").single();
          if (error) throw error;
          recId = data.id;
        }
        if (cultivoDe[r.recinto]) {
          await asignarCultivo({ empresaId, recintoId: recId, cultivoId: cultivoDe[r.recinto], superficie: r.superficie, campanasActivas: campanas.filter((c) => c.activa) });
        }
      }
      onHecho(`${elegidos.length - yaEstan.length} recinto(s) importados de SIGPAC ✓`);
    } catch (e) {
      notificar(e.message, "error");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-1 rounded-2xl bg-stone-200/70 p-1 text-[15px] font-bold">
        {[["mapa", "🗺️ En el mapa"], ["gps", "📍 Estoy aquí"], ["ref", "🔢 Referencia"]].map(([k, t]) => (
          <button key={k} type="button" onClick={() => { setModo(k); setRes(null); }} className={`rounded-xl py-3 ${modo === k ? "bg-white text-olivo-800 shadow" : "text-stone-600"}`}>
            {t}
          </button>
        ))}
      </div>
      {modo === "mapa" && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <Input placeholder="Pueblo o paraje (ej. Martos, Jaén)" value={lugar} onChange={(e) => setLugar(e.target.value)} onKeyDown={(e) => e.key === "Enter" && buscarLugar()} />
            <Boton variante="secundario" onClick={buscarLugar}>
              Buscar
            </Boton>
            <Boton
              variante="secundario"
              aria-label="Ir a mi ubicación"
              onClick={async () => {
                const p = await actualizarGps();
                if (p) irA(p.lat, p.lon, 17);
                else notificar("No se pudo obtener tu ubicación", "error");
              }}
            >
              📍
            </Boton>
          </div>
          {lugares && (
            <div className="max-h-48 space-y-1 overflow-y-auto rounded-xl bg-white p-1 shadow">
              {lugares.length === 0 && <p className="p-2 text-sm text-stone-500">Buscando…</p>}
              {lugares.map((l, i) => (
                <button key={i} type="button" onClick={() => irA(l.lat, l.lon)} className="block w-full rounded-lg px-2 py-2 text-left text-sm active:bg-olivo-50">
                  {l.nombre}
                </button>
              ))}
            </div>
          )}
          <div className="h-[55vh] overflow-hidden rounded-2xl border border-stone-200">
            <MapaSigpac
              existentes={existentes}
              resultado={res || []}
              sel={sel}
              gps={gps}
              centrarEn={centrarEn}
              onPunto={(lat, lon) => !buscando && buscar({ lat, lon })}
              onToggle={(rec) => setSel((s) => (s.includes(rec) ? s.filter((x) => x !== rec) : [...s, rec]))}
            />
          </div>
          <p className="text-sm text-stone-600">
            {buscando ? "Consultando SIGPAC…" : res ? "Toca más recintos de esta parcela para añadirlos, o toca otra parcela." : "Toca tu parcela en el mapa. En azul, las que ya tienes."}
          </p>
        </div>
      )}
      {modo === "ref" && (
        <div className="grid grid-cols-4 gap-2">
          {[["pr", "Prov."], ["mu", "Munic."], ["po", "Políg."], ["pa", "Parcela"]].map(([k, t]) => (
            <Campo key={k} etiqueta={t}>
              <Input inputMode="numeric" value={ref[k]} onChange={(e) => setRef({ ...ref, [k]: e.target.value })} />
            </Campo>
          ))}
          <p className="col-span-4 text-xs text-stone-500">Los códigos están en tu declaración PAC o en el visor SIGPAC (ej. Jaén = 23). Agregado y zona suelen ser 0.</p>
        </div>
      )}
      {modo !== "mapa" && (
        <Boton grande className="w-full" disabled={buscando} onClick={() => buscar()}>
          {buscando ? "Consultando SIGPAC…" : modo === "gps" ? "Buscar recinto aquí" : "Buscar parcela"}
        </Boton>
      )}

      {res && (
        <>
          <div className="space-y-2">
            {res.map((r) => (
              <Tarjeta key={r.recinto} className={`!p-3 ${sel.includes(r.recinto) ? "border-2 border-olivo-500" : ""}`}>
                <label className="flex items-start gap-3">
                  <input type="checkbox" className="mt-1 h-6 w-6 accent-olivo-700" checked={sel.includes(r.recinto)} onChange={(e) => setSel(e.target.checked ? [...sel, r.recinto] : sel.filter((x) => x !== r.recinto))} />
                  <div className="flex-1">
                    <p className="font-extrabold">
                      Recinto {r.recinto} · {num(r.superficie)} ha
                    </p>
                    <p className="text-sm text-stone-600">
                      {r.uso_sigpac} {USOS_SIGPAC[r.uso_sigpac] ? `(${USOS_SIGPAC[r.uso_sigpac]})` : ""} {r.coef_regadio > 0 ? "· regadío" : ""} {r.pendiente_media != null ? `· pend. ${num(r.pendiente_media, 1)}%` : ""}
                    </p>
                    {sel.includes(r.recinto) && (
                      <Select className="mt-2 !py-1.5" vacio="Cultivo: sin indicar" opciones={cultivos.map((c) => ({ value: c.id, label: c.nombre }))} value={cultivoDe[r.recinto] || ""} onChange={(e) => setCultivoDe({ ...cultivoDe, [r.recinto]: e.target.value })} />
                    )}
                  </div>
                </label>
              </Tarjeta>
            ))}
          </div>
          <Campo etiqueta="Guardar en">
            <Select vacio="➕ Parcela nueva" opciones={parcelas.map((p) => ({ value: p.id, label: p.nombre }))} value={destino} onChange={(e) => setDestino(e.target.value)} />
          </Campo>
          {!destino && (
            <>
              <Campo etiqueta="Nombre de la parcela" ayuda="El nombre con el que la llamas (ej. La Mesa).">
                <Input value={nombre} onChange={(e) => setNombre(e.target.value)} />
              </Campo>
              <SelectorFinca fincas={fincas} fincaId={fincaId} setFincaId={setFincaId} nueva={nuevaFinca} setNueva={setNuevaFinca} />
            </>
          )}
          <Boton grande className="w-full" disabled={!sel.length || guardando} onClick={guardar}>
            {guardando ? "Guardando…" : `Guardar ${sel.length} recinto(s)`}
          </Boton>
        </>
      )}
    </div>
  );
}

function ParcelaManual({ fincas, onHecho }) {
  const { empresaId, cultivos, notificar } = useApp();
  const [nombre, setNombre] = useState("");
  const [ha, setHa] = useState("");
  const [cultivo, setCultivo] = useState(null);
  const [fincaId, setFincaId] = useState(null);
  const [nuevaFinca, setNuevaFinca] = useState("");
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    setGuardando(true);
    try {
      const sup = Number(String(ha).replace(",", ".")) || null;
      const fid = await obtenerFinca(empresaId, fincaId, nuevaFinca);
      const { data: p, error } = await supabase.from("parcelas").insert({ empresa_id: empresaId, finca_id: fid, nombre, superficie_total_ha: sup }).select("id").single();
      if (error) throw error;
      const { data: r, error: e2 } = await supabase.from("recintos").insert({ empresa_id: empresaId, parcela_id: p.id, superficie_sigpac_ha: sup, fuente: "manual" }).select("id").single();
      if (e2) throw e2;
      if (cultivo) await asignarCultivo({ empresaId, recintoId: r.id, cultivoId: cultivo, superficie: sup });
      onHecho("Parcela añadida ✓");
    } catch (e) {
      notificar(e.message, "error");
    } finally {
      setGuardando(false);
    }
  }
  return (
    <div className="space-y-4">
      <Campo etiqueta="Nombre">
        <Input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="La Mesa P1" />
      </Campo>
      <Campo etiqueta="Superficie (ha)">
        <Input inputMode="decimal" value={ha} onChange={(e) => setHa(e.target.value)} />
      </Campo>
      <div>
        <p className="mb-2 text-sm font-semibold text-stone-700">Cultivo</p>
        <Fichas opciones={cultivos.map((c) => ({ value: c.id, label: c.nombre }))} valor={cultivo} onCambio={setCultivo} />
      </div>
      <SelectorFinca fincas={fincas} fincaId={fincaId} setFincaId={setFincaId} nueva={nuevaFinca} setNueva={setNuevaFinca} />
      <p className="text-xs text-stone-500">Podrás vincularla a SIGPAC más tarde (Importar → Guardar en esta parcela).</p>
      <Boton grande className="w-full" disabled={!nombre.trim() || guardando} onClick={guardar}>
        Guardar
      </Boton>
    </div>
  );
}

function EditarParcela({ parcela, fincas, onHecho }) {
  const { campanas, cultivos, recintos, notificar, empresaId } = useApp();
  const mios = recintos.filter((r) => r.parcela_id === parcela.id);
  const [nombre, setNombre] = useState(parcela.nombre);
  const [fincaId, setFincaId] = useState(parcela.finca_id);
  const [nuevaFinca, setNuevaFinca] = useState("");
  const [cult, setCult] = useState(Object.fromEntries(mios.map((r) => [r.id, cultivos.find((c) => c.nombre === r.cultivo)?.id || ""])));
  const [variedad, setVariedad] = useState(Object.fromEntries(mios.map((r) => [r.id, r.variedad || ""])));
  const [vulnerable, setVulnerable] = useState(Object.fromEntries(mios.map((r) => [r.id, !!r.zona_vulnerable])));

  async function guardar() {
    try {
      const fid = await obtenerFinca(empresaId, fincaId, nuevaFinca);
      const { error } = await supabase.from("parcelas").update({ nombre, finca_id: fid }).eq("id", parcela.id);
      if (error) throw error;
      for (const r of mios)
        if (!!r.zona_vulnerable !== !!vulnerable[r.id]) await supabase.from("recintos").update({ zona_vulnerable: !!vulnerable[r.id] }).eq("id", r.id);
      for (const r of mios)
        await asignarCultivo({
          empresaId,
          recintoId: r.id,
          cultivoId: cult[r.id] || null,
          variedad: variedad[r.id] || null,
          superficie: r.superficie_sigpac_ha,
          campanasActivas: campanas.filter((c) => c.activa),
        });
      onHecho("Parcela actualizada ✓");
    } catch (e) {
      notificar(e.message, "error");
    }
  }
  async function baja() {
    if (!confirm("¿Dar de baja esta parcela? Su histórico se conserva.")) return;
    await supabase.from("parcelas").update({ activa: false }).eq("id", parcela.id);
    await supabase.from("recintos").update({ activo: false }).eq("parcela_id", parcela.id);
    onHecho("Parcela dada de baja");
  }
  return (
    <div className="space-y-4">
      <Campo etiqueta="Nombre">
        <Input value={nombre} onChange={(e) => setNombre(e.target.value)} />
      </Campo>
      <SelectorFinca fincas={fincas} fincaId={fincaId} setFincaId={setFincaId} nueva={nuevaFinca} setNueva={setNuevaFinca} />
      <p className="text-sm font-bold text-stone-700">Cultivo actual de cada recinto</p>
      {mios.map((r) => (
        <Tarjeta key={r.id} className="!p-3">
          <p className="text-sm font-semibold">
            {r.recinto_sigpac ? `Recinto ${r.recinto_sigpac} · ${r.uso_sigpac || ""}` : "Recinto sin SIGPAC"} · {num(r.superficie_sigpac_ha)} ha
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Select vacio="Sin cultivo" opciones={cultivos.map((c) => ({ value: c.id, label: c.nombre }))} value={cult[r.id]} onChange={(e) => setCult({ ...cult, [r.id]: e.target.value })} />
            <Input placeholder="Variedad" value={variedad[r.id]} onChange={(e) => setVariedad({ ...variedad, [r.id]: e.target.value })} />
          </div>
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-5 w-5 accent-olivo-700" checked={!!vulnerable[r.id]} onChange={(e) => setVulnerable({ ...vulnerable, [r.id]: e.target.checked })} />
            En zona vulnerable a nitratos
          </label>
        </Tarjeta>
      ))}
      <Boton grande className="w-full" onClick={guardar}>
        Guardar
      </Boton>
      <Boton variante="peligro" className="w-full" onClick={baja}>
        Dar de baja
      </Boton>
    </div>
  );
}
