"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useApp } from "@/components/AppProvider";
import { Boton, Campo, Etiqueta, Fichas, Hoja, Input, Pagina, Select, Seccion, Tarjeta } from "@/components/ui";
import { euros, fechaCorta } from "@/lib/formato";

const ROLES = [
  ["trabajador", "Trabajador", "Registra sus partes. No ve costes."],
  ["encargado", "Encargado", "Gestiona partes, parcelas, compras."],
  ["administrador", "Administrador", "Todo, incluido equipo y empresa."],
  ["tecnico", "Técnico / asesor", "Consulta cuaderno y partes."],
];
const CATEGORIAS = ["labor", "tratamiento", "fertilizacion", "herbicida", "recoleccion", "poda", "riego", "transporte", "otro"];

export default function Ajustes() {
  const app = useApp();
  const { empresaId, rol, esGestor, perfil, campana, trabajadores, labores, maquinaria, aperos, recargar, notificar, cargarEmpresas } = app;
  const esAdmin = ["propietario", "administrador"].includes(rol);
  const [emp, setEmp] = useState(null);
  const [miembros, setMiembros] = useState([]);
  const [invit, setInvit] = useState([]);
  const [hoja, setHoja] = useState(null);
  const [nombre, setNombre] = useState(perfil?.nombre || "");

  async function cargar() {
    const [e, m, i] = await Promise.all([
      supabase.from("empresas").select("*").eq("id", empresaId).single(),
      supabase.from("empresa_usuarios").select("id, rol, usuario_id, usuarios(nombre, email)").eq("empresa_id", empresaId),
      esAdmin ? supabase.from("invitaciones").select("*").eq("empresa_id", empresaId).eq("aceptada", false) : Promise.resolve({ data: [] }),
    ]);
    setEmp(e.data);
    setMiembros(m.data || []);
    setInvit(i.data || []);
  }
  useEffect(() => {
    cargar();
  }, [empresaId]); // eslint-disable-line

  async function guardarEmpresa() {
    const { nombre, nif, direccion, municipio, provincia, telefono, email, regimen_fiscal, iva_es_coste } = emp;
    const { error } = await supabase.from("empresas").update({ nombre, nif, direccion, municipio, provincia, telefono, email, regimen_fiscal: regimen_fiscal || null, iva_es_coste }).eq("id", empresaId);
    if (error) return notificar(error.message, "error");
    await cargarEmpresas();
    notificar("Empresa guardada ✓");
  }

  async function guardarPerfil() {
    await supabase.from("usuarios").update({ nombre }).eq("id", perfil.id);
    await cargarEmpresas();
    notificar("Guardado ✓");
  }

  async function hecho(m) {
    setHoja(null);
    await Promise.all([cargar(), recargar()]);
    notificar(m);
  }

  const c = (k) => ({ value: emp?.[k] ?? "", onChange: (e) => setEmp({ ...emp, [k]: e.target.value }) });

  return (
    <Pagina titulo="Ajustes" volver="/mas">
      <Tarjeta>
        <Campo etiqueta="Tu nombre">
          <div className="flex gap-2">
            <Input value={nombre} onChange={(e) => setNombre(e.target.value)} />
            <Boton onClick={guardarPerfil}>Guardar</Boton>
          </div>
        </Campo>
        <p className="mt-2 text-sm text-stone-500">{perfil?.email}</p>
      </Tarjeta>

      {esAdmin && emp && (
        <Seccion titulo="Empresa">
          <Tarjeta className="grid grid-cols-2 gap-3">
            <Campo etiqueta="Nombre" className="col-span-2">
              <Input {...c("nombre")} />
            </Campo>
            <Campo etiqueta="NIF">
              <Input {...c("nif")} />
            </Campo>
            <Campo etiqueta="Teléfono">
              <Input {...c("telefono")} />
            </Campo>
            <Campo etiqueta="Municipio">
              <Input {...c("municipio")} />
            </Campo>
            <Campo etiqueta="Provincia">
              <Input {...c("provincia")} />
            </Campo>
            <Campo etiqueta="Régimen fiscal">
              <Select opciones={[{ value: "modulos", label: "Módulos" }, { value: "estimacion_directa", label: "Estimación directa" }]} {...c("regimen_fiscal")} />
            </Campo>
            <label className="flex items-end gap-2 pb-3 text-[15px] font-semibold">
              <input type="checkbox" className="h-5 w-5 accent-olivo-700" checked={!!emp.iva_es_coste} onChange={(e) => setEmp({ ...emp, iva_es_coste: e.target.checked })} />
              El IVA es coste
            </label>
            <Boton className="col-span-2" onClick={guardarEmpresa}>
              Guardar empresa
            </Boton>
          </Tarjeta>
        </Seccion>
      )}

      {esGestor && (
        <Seccion titulo="Campaña" accion={esAdmin && <button type="button" className="text-sm font-bold text-olivo-700" onClick={() => setHoja({ tipo: "campana" })}>+ Nueva</button>}>
          <Tarjeta>
            {campana ? (
              <p className="text-lg font-bold">
                {campana.nombre} <span className="text-[15px] font-normal text-stone-500">· {fechaCorta(campana.fecha_inicio)} – {fechaCorta(campana.fecha_fin)}</span>
              </p>
            ) : (
              <p>Sin campaña activa.</p>
            )}
          </Tarjeta>
        </Seccion>
      )}

      {esAdmin && (
        <Seccion titulo="Equipo y accesos" accion={<button type="button" className="text-sm font-bold text-olivo-700" onClick={() => setHoja({ tipo: "invitar" })}>+ Invitar</button>}>
          <div className="space-y-2">
            {miembros.map((m) => (
              <Tarjeta key={m.id} className="flex items-center justify-between !p-3">
                <span>
                  <b>{m.usuarios?.nombre || m.usuarios?.email}</b>
                  <span className="block text-sm text-stone-500">{m.usuarios?.email}</span>
                </span>
                <Etiqueta>{m.rol}</Etiqueta>
              </Tarjeta>
            ))}
            {invit.map((i) => (
              <Tarjeta key={i.id} className="flex items-center justify-between !p-3 opacity-80">
                <span>
                  <b>{i.email}</b>
                  <span className="block text-sm text-stone-500">Invitado · entrará al crear su cuenta con este email</span>
                </span>
                <button type="button" className="text-sm font-bold text-red-700" onClick={async () => { await supabase.from("invitaciones").delete().eq("id", i.id); cargar(); }}>
                  Anular
                </button>
              </Tarjeta>
            ))}
          </div>
        </Seccion>
      )}

      {esGestor && (
        <Seccion titulo="Trabajadores" accion={<button type="button" className="text-sm font-bold text-olivo-700" onClick={() => setHoja({ tipo: "trabajador" })}>+ Añadir</button>}>
          <div className="space-y-2">
            {trabajadores.map((t) => (
              <button key={t.id} type="button" onClick={() => setHoja({ tipo: "trabajador", item: t })} className="flex w-full justify-between rounded-2xl bg-white p-3 text-left shadow-sm">
                <span>
                  <b>
                    {t.nombre} {t.apellidos}
                  </b>
                  <span className="block text-sm text-stone-500">
                    {t.tipo_trabajador} {t.usuario_id ? "· usa la app" : ""}
                  </span>
                </span>
                <span className="text-stone-600">{euros(t.coste_hora)}/h</span>
              </button>
            ))}
          </div>
        </Seccion>
      )}

      {esGestor && (
        <Seccion titulo="Labores" accion={<button type="button" className="text-sm font-bold text-olivo-700" onClick={() => setHoja({ tipo: "labor" })}>+ Añadir</button>}>
          <div className="space-y-2">
            {labores.map((l) => (
              <button key={l.id} type="button" onClick={() => setHoja({ tipo: "labor", item: l })} className="flex w-full justify-between rounded-2xl bg-white p-3 text-left shadow-sm">
                <span>
                  <b>{l.nombre}</b>
                  <span className="block text-sm text-stone-500">
                    {[maquinaria.find((m) => m.id === l.maquinaria_habitual_id)?.nombre, aperos.find((a) => a.id === l.apero_habitual_id)?.nombre].filter(Boolean).join(" + ") || "Sin equipo habitual"}
                  </span>
                </span>
                <Etiqueta color={["tratamiento", "fertilizacion", "herbicida"].includes(l.categoria) ? "tierra" : "gris"}>{l.categoria}</Etiqueta>
              </button>
            ))}
          </div>
        </Seccion>
      )}

      <Hoja abierta={!!hoja} onCerrar={() => setHoja(null)} titulo={{ campana: "Nueva campaña", invitar: "Invitar al equipo", trabajador: "Trabajador", labor: "Labor" }[hoja?.tipo]}>
        {hoja?.tipo === "campana" && <FormCampana empresaId={empresaId} actual={campana} onHecho={hecho} />}
        {hoja?.tipo === "invitar" && <FormInvitar empresaId={empresaId} trabajadores={trabajadores} onHecho={hecho} />}
        {hoja?.tipo === "trabajador" && <FormTrabajador empresaId={empresaId} item={hoja.item} onHecho={hecho} />}
        {hoja?.tipo === "labor" && <FormLabor empresaId={empresaId} item={hoja.item} maquinaria={maquinaria} aperos={aperos} onHecho={hecho} />}
      </Hoja>
    </Pagina>
  );
}

function FormCampana({ empresaId, actual, onHecho }) {
  const sig = actual ? new Date(new Date(actual.fecha_fin).getTime() + 86400000).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ nombre: "", fecha_inicio: sig, fecha_fin: "" });
  async function guardar() {
    if (actual) await supabase.from("campanas").update({ activa: false }).eq("id", actual.id);
    const { error } = await supabase.from("campanas").insert({ empresa_id: empresaId, ...f, activa: true });
    if (error) {
      if (actual) await supabase.from("campanas").update({ activa: true }).eq("id", actual.id);
      return alert(error.message);
    }
    onHecho("Nueva campaña activa ✓");
  }
  return (
    <div className="space-y-3">
      <Campo etiqueta="Nombre">
        <Input value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} placeholder="Campaña 2027" />
      </Campo>
      <div className="grid grid-cols-2 gap-2">
        <Campo etiqueta="Inicio">
          <Input type="date" value={f.fecha_inicio} onChange={(e) => setF({ ...f, fecha_inicio: e.target.value })} />
        </Campo>
        <Campo etiqueta="Fin">
          <Input type="date" value={f.fecha_fin} onChange={(e) => setF({ ...f, fecha_fin: e.target.value })} />
        </Campo>
      </div>
      <p className="text-sm text-stone-500">Los cultivos de cada recinto se asignan por campaña: revísalos en Parcelas tras crearla.</p>
      <Boton grande className="w-full" disabled={!f.nombre || !f.fecha_fin} onClick={guardar}>
        Crear y activar
      </Boton>
    </div>
  );
}

function FormInvitar({ empresaId, trabajadores, onHecho }) {
  const [email, setEmail] = useState("");
  const [rol, setRol] = useState("trabajador");
  const [trab, setTrab] = useState("");
  async function guardar() {
    const { error } = await supabase.from("invitaciones").insert({ empresa_id: empresaId, email: email.trim().toLowerCase(), rol, trabajador_id: trab || null });
    if (error) return alert(error.message.includes("duplicate") ? "Ya hay una invitación para ese email" : error.message);
    const enlace = window.location.origin + "/login";
    const texto = `Te he dado acceso a Cultivix. Entra en ${enlace} y crea tu cuenta con el email ${email.trim()}.`;
    if (navigator.share) navigator.share({ text: texto }).catch(() => {});
    else window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`);
    onHecho("Invitación creada ✓");
  }
  return (
    <div className="space-y-4">
      <Campo etiqueta="Email de la persona">
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Campo>
      <div className="space-y-2">
        {ROLES.map(([k, t, d]) => (
          <button key={k} type="button" onClick={() => setRol(k)} className={`block w-full rounded-2xl border-2 p-3 text-left ${rol === k ? "border-olivo-700 bg-olivo-50" : "border-stone-200 bg-white"}`}>
            <b>{t}</b>
            <span className="block text-sm text-stone-600">{d}</span>
          </button>
        ))}
      </div>
      {(rol === "trabajador" || rol === "encargado") && (
        <Campo etiqueta="¿Es uno de tus trabajadores?" ayuda="Así sus partes usan su coste/hora.">
          <Select vacio="Crear ficha nueva" opciones={trabajadores.filter((t) => !t.usuario_id).map((t) => ({ value: t.id, label: t.nombre }))} value={trab} onChange={(e) => setTrab(e.target.value)} />
        </Campo>
      )}
      <Boton grande className="w-full" disabled={!email.includes("@")} onClick={guardar}>
        Invitar y enviar por WhatsApp
      </Boton>
    </div>
  );
}

function FormTrabajador({ empresaId, item, onHecho }) {
  const [f, setF] = useState(item || { nombre: "", apellidos: "", telefono: "", tipo_trabajador: "fijo", coste_hora: "" });
  const c = (k) => ({ value: f[k] ?? "", onChange: (e) => setF({ ...f, [k]: e.target.value }) });
  async function guardar() {
    const datos = { empresa_id: empresaId, nombre: f.nombre, apellidos: f.apellidos || null, telefono: f.telefono || null, tipo_trabajador: f.tipo_trabajador, coste_hora: Number(String(f.coste_hora || 0).replace(",", ".")) };
    const { error } = item ? await supabase.from("trabajadores").update(datos).eq("id", item.id) : await supabase.from("trabajadores").insert(datos);
    if (error) return alert(error.message);
    onHecho("Guardado ✓");
  }
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <Campo etiqueta="Nombre">
          <Input {...c("nombre")} />
        </Campo>
        <Campo etiqueta="Apellidos">
          <Input {...c("apellidos")} />
        </Campo>
        <Campo etiqueta="Teléfono">
          <Input {...c("telefono")} inputMode="tel" />
        </Campo>
        <Campo etiqueta="Coste/hora (€)" ayuda="Salario + Seg. Social">
          <Input {...c("coste_hora")} inputMode="decimal" />
        </Campo>
      </div>
      <Fichas opciones={["propietario", "fijo", "eventual", "autonomo"].map((v) => ({ value: v, label: v }))} valor={f.tipo_trabajador} onCambio={(v) => setF({ ...f, tipo_trabajador: v || "fijo" })} />
      <Boton grande className="w-full" disabled={!f.nombre} onClick={guardar}>
        Guardar
      </Boton>
      {item && !item.usuario_id && (
        <Boton
          variante="peligro"
          className="w-full"
          onClick={async () => {
            await supabase.from("trabajadores").update({ activo: false, fecha_baja: new Date().toISOString().slice(0, 10) }).eq("id", item.id);
            onHecho("Trabajador dado de baja");
          }}
        >
          Dar de baja
        </Boton>
      )}
    </div>
  );
}

function FormLabor({ empresaId, item, maquinaria, aperos, onHecho }) {
  const [f, setF] = useState(item || { nombre: "", categoria: "labor", maquinaria_habitual_id: null, apero_habitual_id: null, palabras_clave: [] });
  const [claves, setClaves] = useState((item?.palabras_clave || []).join(", "));
  async function guardar() {
    const datos = {
      empresa_id: empresaId,
      nombre: f.nombre,
      categoria: f.categoria,
      maquinaria_habitual_id: f.maquinaria_habitual_id || null,
      apero_habitual_id: f.apero_habitual_id || null,
      requiere_maquinaria: !!f.maquinaria_habitual_id,
      palabras_clave: claves.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
    };
    const { error } = item ? await supabase.from("labores").update(datos).eq("id", item.id) : await supabase.from("labores").insert(datos);
    if (error) return alert(error.message);
    onHecho("Labor guardada ✓");
  }
  return (
    <div className="space-y-4">
      <Campo etiqueta="Nombre">
        <Input value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} />
      </Campo>
      <div>
        <p className="mb-2 text-sm font-semibold text-stone-700">Tipo</p>
        <Fichas opciones={CATEGORIAS.map((v) => ({ value: v, label: v }))} valor={f.categoria} onCambio={(v) => setF({ ...f, categoria: v || "labor" })} />
        <p className="mt-1 text-xs text-stone-500">Tratamiento, fertilización y herbicida piden productos y van al cuaderno de campo.</p>
      </div>
      <div>
        <p className="mb-2 text-sm font-semibold text-stone-700">Máquina habitual</p>
        <Fichas opciones={maquinaria.map((m) => ({ value: m.id, label: m.nombre }))} valor={f.maquinaria_habitual_id} onCambio={(v) => setF({ ...f, maquinaria_habitual_id: v })} vacio="Sin máquinas" />
      </div>
      <div>
        <p className="mb-2 text-sm font-semibold text-stone-700">Apero habitual</p>
        <Fichas opciones={aperos.map((m) => ({ value: m.id, label: m.nombre }))} valor={f.apero_habitual_id} onCambio={(v) => setF({ ...f, apero_habitual_id: v })} vacio="Sin aperos" />
      </div>
      <Campo etiqueta="Cómo lo dices tú (para el asistente)" ayuda="Separado por comas: sulfatar, echar cobre…">
        <Input value={claves} onChange={(e) => setClaves(e.target.value)} />
      </Campo>
      <Boton grande className="w-full" disabled={!f.nombre} onClick={guardar}>
        Guardar
      </Boton>
    </div>
  );
}
