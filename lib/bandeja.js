"use client";
// Bandeja sin cobertura: lo que se hace en el campo sin señal y necesita internet
// (notas para el asistente, fotos de albaranes y tickets, fotos de campo) se guarda
// en el propio móvil (IndexedDB, admite fotos) y se procesa al volver la cobertura.
import { supabase } from "./supabase";

const BD = "cultivix";
const ALMACEN = "bandeja";

function abrir() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(BD, 1);
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains(ALMACEN)) r.result.createObjectStore(ALMACEN, { keyPath: "id" });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function tx(modo, fn) {
  const db = await abrir();
  return new Promise((res, rej) => {
    const t = db.transaction(ALMACEN, modo);
    const st = t.objectStore(ALMACEN);
    let salida;
    Promise.resolve(fn(st)).then((v) => (salida = v));
    t.oncomplete = () => {
      db.close();
      res(salida);
    };
    t.onerror = () => {
      db.close();
      rej(t.error);
    };
  });
}

function avisar() {
  try {
    window.dispatchEvent(new Event("cultivix-bandeja"));
  } catch {}
}

const pedir = (r) => new Promise((res, rej) => ((r.onsuccess = () => res(r.result)), (r.onerror = () => rej(r.error))));

/** Guarda algo en la bandeja. tipo: nota | compra | cosecha | foto */
export async function agregarABandeja(item) {
  const it = { id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random(), creado: new Date().toISOString(), ...item };
  await tx("readwrite", (st) => st.put(it));
  avisar();
  return it;
}

export async function listarBandeja(empresaId) {
  try {
    const todos = await tx("readonly", (st) => pedir(st.getAll()));
    return (todos || []).filter((x) => !empresaId || x.empresa_id === empresaId).sort((a, b) => a.creado.localeCompare(b.creado));
  } catch {
    return [];
  }
}

export async function leerDeBandeja(id) {
  try {
    return (await tx("readonly", (st) => pedir(st.get(id)))) || null;
  } catch {
    return null;
  }
}

export async function actualizarBandeja(id, cambios) {
  const it = await leerDeBandeja(id);
  if (!it) return null;
  const nuevo = { ...it, ...cambios };
  await tx("readwrite", (st) => st.put(nuevo));
  avisar();
  return nuevo;
}

export async function quitarDeBandeja(id) {
  if (!id) return;
  await tx("readwrite", (st) => st.delete(id));
  avisar();
}

/** ¿Es un fallo por falta de conexión (y no un error de datos)? */
export function esFalloDeRed(e) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const m = String(e?.message || e || "").toLowerCase();
  return m.includes("failed to fetch") || m.includes("networkerror") || m.includes("network") || m.includes("load failed") || m.includes("conexión");
}

/** Qué hay que revisar y dónde (las fotos de campo se suben solas). */
export function enlaceDe(it) {
  if (it.tipo === "nota") return `/asistente?bandeja=${it.id}`;
  if (it.tipo === "compra") return `/escanear?bandeja=${it.id}`;
  if (it.tipo === "cosecha") return `/cosechas?bandeja=${it.id}`;
  return null;
}

export const ETIQUETA = {
  nota: { icono: "🎤", texto: "Nota para el asistente" },
  compra: { icono: "📄", texto: "Foto de albarán o factura" },
  cosecha: { icono: "🧺", texto: "Foto de ticket de cosecha" },
  foto: { icono: "📷", texto: "Foto de campo" },
};

/** Sube un archivo guardado al almacén de documentos y lo registra. Devuelve {ruta, documento_id}. */
export async function subirDocumento(empresaId, carpeta, blob, mime, nombre, tipoDoc) {
  const ext = mime === "application/pdf" ? "pdf" : "jpg";
  const ruta = `${empresaId}/${carpeta}/${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.${ext}`;
  const up = await supabase.storage.from("documentos").upload(ruta, blob, { contentType: mime });
  if (up.error) throw up.error;
  const { data: d } = await supabase.from("documentos").insert({ empresa_id: empresaId, tipo: tipoDoc, nombre: nombre || "documento", archivo_path: ruta, mime_type: mime }).select("id").single();
  return { ruta, documento_id: d?.id || null };
}

/** Sube las fotos de campo guardadas sin cobertura (no necesitan revisión). Devuelve cuántas. */
let subiendo = false;
export async function subirFotosPendientes() {
  if (subiendo || (typeof navigator !== "undefined" && !navigator.onLine)) return 0;
  subiendo = true;
  let n = 0;
  try {
    const fotos = (await listarBandeja()).filter((x) => x.tipo === "foto");
    for (const f of fotos) {
      try {
        const ruta = `${f.empresa_id}/fotos/${f.creado.slice(0, 10)}/${crypto.randomUUID()}.jpg`;
        const up = await supabase.storage.from("documentos").upload(ruta, f.blob, { contentType: "image/jpeg" });
        if (up.error) throw up.error;
        const { data: ft, error } = await supabase
          .from("fotografias")
          .insert({ empresa_id: f.empresa_id, archivo_path: ruta, lat: f.lat, lon: f.lon, recinto_id: f.recinto_id, descripcion: f.descripcion, tomada_en: f.creado })
          .select("id")
          .single();
        if (error) throw error;
        if (f.observacion) {
          await supabase.from("observaciones_agronomicas").insert({ ...f.observacion, empresa_id: f.empresa_id, recinto_id: f.recinto_id, fotografia_id: ft.id });
        }
        await quitarDeBandeja(f.id);
        n++;
      } catch (e) {
        if (esFalloDeRed(e)) break;
        await actualizarBandeja(f.id, { error: e.message });
      }
    }
  } finally {
    subiendo = false;
  }
  return n;
}
