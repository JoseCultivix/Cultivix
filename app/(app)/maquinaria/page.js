"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useApp } from "@/components/AppProvider";
import { Boton, Campo, Etiqueta, Hoja, Input, Pagina, Select, Seccion, Tarjeta, Vacio } from "@/components/ui";
import { euros, fechaCorta } from "@/lib/formato";

const TIPOS_DOC = [
  ["itv", "ITV"],
  ["seguro", "Seguro"],
  ["roma", "ROMA"],
  ["inspeccion_equipo_fito", "Inspección equipo fitosanitario"],
  ["permiso_circulacion", "Permiso de circulación"],
  ["ficha_tecnica", "Ficha técnica"],
  ["otro", "Otro"],
];

function estadoDoc(f) {
  if (!f) return null;
  const d = Math.round((new Date(f) - new Date()) / 86400000);
  if (d < 0) return ["Caducado", "rojo"];
  if (d <= 30) return [`Vence en ${d} días`, "ambar"];
  return [`Hasta ${fechaCorta(f)}`, "olivo"];
}

export default function Maquinaria() {
  const { empresaId, maquinaria, aperos, esGestor, recargar, notificar } = useApp();
  const [docs, setDocs] = useState([]);
  const [averias, setAverias] = useState([]);
  const [hoja, setHoja] = useState(null); // {tipo:'maquina'|'apero'|'doc'|'averia', item?}

  async function cargar() {
    const [d, a] = await Promise.all([
      supabase.from("maquinaria_documentos").select("*").eq("empresa_id", empresaId).order("fecha_caducidad"),
      supabase.from("averias").select("*").eq("empresa_id", empresaId).eq("estado", "abierta").order("fecha", { ascending: false }),
    ]);
    setDocs(d.data || []);
    setAverias(a.data || []);
  }
  useEffect(() => {
    cargar();
  }, [empresaId]); // eslint-disable-line

  async function hecho(m) {
    setHoja(null);
    await Promise.all([cargar(), recargar()]);
    notificar(m);
  }

  const Equipo = ({ item, tipo }) => {
    const mis = docs.filter((d) => (tipo === "maquina" ? d.maquinaria_id : d.apero_id) === item.id);
    const av = averias.filter((a) => (tipo === "maquina" ? a.maquinaria_id : a.apero_id) === item.id);
    return (
      <Tarjeta className="!p-3">
        <button type="button" className="w-full text-left" onClick={() => esGestor && setHoja({ tipo, item })}>
          <div className="flex items-start justify-between">
            <p className="text-lg font-extrabold text-olivo-900">{item.nombre}</p>
            {esGestor && item.coste_hora > 0 && <span className="text-sm text-stone-500">{euros(item.coste_hora)}/h</span>}
          </div>
          <p className="text-sm text-stone-500">{[item.marca, item.modelo, item.matricula].filter(Boolean).join(" · ") || item.tipo}</p>
        </button>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {mis.map((d) => {
            const e = estadoDoc(d.fecha_caducidad);
            return (
              <Etiqueta key={d.id} color={e?.[1] || "gris"}>
                {TIPOS_DOC.find((t) => t[0] === d.tipo_documento)?.[1]} {e ? `· ${e[0]}` : ""}
              </Etiqueta>
            );
          })}
          {av.map((a) => (
            <Etiqueta key={a.id} color="rojo">
              🔧 {a.descripcion}
            </Etiqueta>
          ))}
        </div>
        <div className="mt-2 flex gap-3 text-sm font-bold text-olivo-700">
          {esGestor && (
            <button type="button" onClick={() => setHoja({ tipo: "doc", item, de: tipo })}>
              + Documento
            </button>
          )}
          <button type="button" onClick={() => setHoja({ tipo: "averia", item, de: tipo })}>
            + Avería
          </button>
        </div>
      </Tarjeta>
    );
  };

  return (
    <Pagina titulo="Maquinaria y aperos" volver="/mas" accion={esGestor && <Boton onClick={() => setHoja({ tipo: "maquina" })}>+ Máquina</Boton>}>
      {maquinaria.length + aperos.length === 0 && <Vacio icono="🚜" titulo="Sin maquinaria" texto="Añade tu tractor y aperos para que Cultivix los proponga y calcule costes." />}
      {maquinaria.length > 0 && (
        <div className="space-y-2">
          {maquinaria.map((m) => (
            <Equipo key={m.id} item={m} tipo="maquina" />
          ))}
        </div>
      )}
      <Seccion titulo="Aperos" accion={esGestor && <button type="button" className="text-sm font-bold text-olivo-700" onClick={() => setHoja({ tipo: "apero" })}>+ Apero</button>}>
        <div className="space-y-2">
          {aperos.map((a) => (
            <Equipo key={a.id} item={a} tipo="apero" />
          ))}
        </div>
      </Seccion>

      <Hoja abierta={!!hoja} onCerrar={() => setHoja(null)} titulo={{ maquina: "Máquina", apero: "Apero", doc: "Documento", averia: "Avería" }[hoja?.tipo]}>
        {hoja?.tipo === "maquina" || hoja?.tipo === "apero" ? (
          <FormEquipo tipo={hoja.tipo} item={hoja.item} empresaId={empresaId} onHecho={hecho} />
        ) : hoja?.tipo === "doc" ? (
          <FormDoc hoja={hoja} empresaId={empresaId} onHecho={hecho} />
        ) : hoja?.tipo === "averia" ? (
          <FormAveria hoja={hoja} empresaId={empresaId} onHecho={hecho} esGestor={esGestor} />
        ) : null}
      </Hoja>
    </Pagina>
  );
}

function FormEquipo({ tipo, item, empresaId, onHecho }) {
  const [f, setF] = useState(item || { nombre: "", tipo: "", marca: "", modelo: "", matricula: "", numero_roma: "", coste_hora: "" });
  const tabla = tipo === "maquina" ? "maquinaria" : "aperos";
  async function guardar() {
    const datos = { empresa_id: empresaId, nombre: f.nombre, tipo: f.tipo || null, marca: f.marca || null, modelo: f.modelo || null, coste_hora: Number(String(f.coste_hora || 0).replace(",", ".")) };
    if (tipo === "maquina") Object.assign(datos, { matricula: f.matricula || null, numero_roma: f.numero_roma || null });
    const { error } = item ? await supabase.from(tabla).update(datos).eq("id", item.id) : await supabase.from(tabla).insert(datos);
    if (error) return alert(error.message);
    onHecho("Guardado ✓");
  }
  async function baja() {
    if (!confirm("¿Dar de baja? El histórico se conserva.")) return;
    await supabase.from(tabla).update(tipo === "maquina" ? { activa: false } : { activo: false }).eq("id", item.id);
    onHecho("Dado de baja");
  }
  const c = (k) => ({ value: f[k] ?? "", onChange: (e) => setF({ ...f, [k]: e.target.value }) });
  return (
    <div className="space-y-3">
      <Campo etiqueta="Nombre">
        <Input {...c("nombre")} placeholder={tipo === "maquina" ? "Tractor principal" : "Cultivador"} />
      </Campo>
      <div className="grid grid-cols-2 gap-2">
        <Campo etiqueta="Marca">
          <Input {...c("marca")} />
        </Campo>
        <Campo etiqueta="Modelo">
          <Input {...c("modelo")} />
        </Campo>
        {tipo === "maquina" && (
          <>
            <Campo etiqueta="Matrícula">
              <Input {...c("matricula")} />
            </Campo>
            <Campo etiqueta="Nº ROMA">
              <Input {...c("numero_roma")} />
            </Campo>
          </>
        )}
        <Campo etiqueta="Coste por hora (€)" ayuda="Gasoil, amortización, mantenimiento…" className="col-span-2">
          <Input inputMode="decimal" {...c("coste_hora")} />
        </Campo>
      </div>
      <Boton grande className="w-full" disabled={!f.nombre} onClick={guardar}>
        Guardar
      </Boton>
      {item && (
        <Boton variante="peligro" className="w-full" onClick={baja}>
          Dar de baja
        </Boton>
      )}
    </div>
  );
}

function FormDoc({ hoja, empresaId, onHecho }) {
  const [tipo, setTipo] = useState("itv");
  const [cad, setCad] = useState("");
  const [archivo, setArchivo] = useState(null);
  async function guardar() {
    let ruta = null;
    if (archivo) {
      ruta = `${empresaId}/maquinaria/${crypto.randomUUID()}-${archivo.name.replace(/[^\w.-]/g, "_")}`;
      const up = await supabase.storage.from("documentos").upload(ruta, archivo);
      if (up.error) return alert(up.error.message);
    }
    const { error } = await supabase.from("maquinaria_documentos").insert({
      empresa_id: empresaId,
      [hoja.de === "maquina" ? "maquinaria_id" : "apero_id"]: hoja.item.id,
      tipo_documento: tipo,
      fecha_caducidad: cad || null,
      archivo_path: ruta,
    });
    if (error) return alert(error.message);
    onHecho("Documento guardado. Te avisaré antes de que venza ✓");
  }
  return (
    <div className="space-y-3">
      <p className="font-bold">{hoja.item.nombre}</p>
      <Campo etiqueta="Tipo">
        <Select vacio={null} opciones={TIPOS_DOC.map(([v, l]) => ({ value: v, label: l }))} value={tipo} onChange={(e) => setTipo(e.target.value)} />
      </Campo>
      <Campo etiqueta="Fecha de caducidad" ayuda="Aparecerá un aviso en Inicio 30 días antes.">
        <Input type="date" value={cad} onChange={(e) => setCad(e.target.value)} />
      </Campo>
      <Campo etiqueta="Foto o PDF (opcional)">
        <input type="file" accept="image/*,application/pdf" onChange={(e) => setArchivo(e.target.files?.[0])} />
      </Campo>
      <Boton grande className="w-full" onClick={guardar}>
        Guardar
      </Boton>
    </div>
  );
}

function FormAveria({ hoja, empresaId, onHecho, esGestor }) {
  const [desc, setDesc] = useState("");
  const [coste, setCoste] = useState("");
  async function guardar() {
    const { error } = await supabase.from("averias").insert({
      empresa_id: empresaId,
      [hoja.de === "maquina" ? "maquinaria_id" : "apero_id"]: hoja.item.id,
      descripcion: desc,
      coste: coste ? Number(coste.replace(",", ".")) : null,
    });
    if (error) return alert(error.message);
    onHecho("Avería anotada ✓");
  }
  return (
    <div className="space-y-3">
      <p className="font-bold">{hoja.item.nombre}</p>
      <Campo etiqueta="¿Qué le pasa?">
        <Input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Pierde aceite el hidráulico" />
      </Campo>
      {esGestor && (
        <Campo etiqueta="Coste (opcional)">
          <Input inputMode="decimal" value={coste} onChange={(e) => setCoste(e.target.value)} />
        </Campo>
      )}
      <Boton grande className="w-full" disabled={!desc} onClick={guardar}>
        Guardar
      </Boton>
    </div>
  );
}
