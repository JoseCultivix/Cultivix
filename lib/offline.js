"use client";
// Cola de envíos pendientes: si no hay cobertura, los partes se guardan en el
// móvil y se envían solos al volver la conexión (FLUJO-005 / FLUJO-057).
import { supabase } from "./supabase";

const CLAVE = "cultivix.cola";

export function leerCola() {
  try {
    return JSON.parse(localStorage.getItem(CLAVE) || "[]");
  } catch {
    return [];
  }
}

function escribirCola(cola) {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(cola));
    window.dispatchEvent(new Event("cultivix-cola"));
  } catch {}
}

export function nuevoIdLocal() {
  return (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()).toString();
}

/** Guarda un parte: intenta enviarlo y si no hay red lo deja en cola. Devuelve {id, enCola}. */
export async function guardarParte(payload) {
  const p = { ...payload, id_local: payload.id_local || nuevoIdLocal() };
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    encolar(p);
    return { id: null, enCola: true, id_local: p.id_local };
  }
  const { data, error } = await supabase.rpc("guardar_parte", { payload: p });
  if (error) {
    if (esErrorDeRed(error)) {
      encolar(p);
      return { id: null, enCola: true, id_local: p.id_local };
    }
    throw new Error(error.message);
  }
  return { id: data, enCola: false, id_local: p.id_local };
}

function encolar(payload) {
  const cola = leerCola().filter((x) => x.payload.id_local !== payload.id_local);
  cola.push({ tipo: "parte", payload, creado: Date.now() });
  escribirCola(cola);
}

function esErrorDeRed(e) {
  const m = String(e?.message || e).toLowerCase();
  return m.includes("fetch") || m.includes("network") || m.includes("failed to") || m.includes("load failed");
}

let sincronizando = false;
export async function sincronizar() {
  if (sincronizando || (typeof navigator !== "undefined" && !navigator.onLine)) return 0;
  sincronizando = true;
  let enviados = 0;
  try {
    const cola = leerCola();
    const quedan = [];
    for (const item of cola) {
      const { error } = await supabase.rpc("guardar_parte", {
        payload: { ...item.payload, forzar_actualizacion: true },
      });
      if (error) {
        if (esErrorDeRed(error)) quedan.push(item);
        else quedan.push({ ...item, error: error.message });
      } else enviados++;
    }
    escribirCola(quedan);
  } finally {
    sincronizando = false;
  }
  return enviados;
}

// ---- caché de catálogos para abrir la app sin cobertura ----
export function guardarCache(clave, valor) {
  try {
    localStorage.setItem("cultivix.cache." + clave, JSON.stringify(valor));
  } catch {}
}
export function leerCache(clave) {
  try {
    return JSON.parse(localStorage.getItem("cultivix.cache." + clave) || "null");
  } catch {
    return null;
  }
}

// ---- trabajo en curso (persistente aunque se cierre la app) ----
const CLAVE_TRABAJO = "cultivix.trabajoEnCurso";
export function leerTrabajoEnCurso() {
  try {
    return JSON.parse(localStorage.getItem(CLAVE_TRABAJO) || "null");
  } catch {
    return null;
  }
}
export function guardarTrabajoEnCurso(t) {
  try {
    if (t) localStorage.setItem(CLAVE_TRABAJO, JSON.stringify(t));
    else localStorage.removeItem(CLAVE_TRABAJO);
    window.dispatchEvent(new Event("cultivix-trabajo"));
  } catch {}
}
