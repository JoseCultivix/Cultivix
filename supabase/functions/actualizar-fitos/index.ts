// Actualiza el catálogo del Registro de Productos Fitosanitarios (MAPA) en la base de datos.
// Fuente: exportación oficial «Productos autorizados» de regfiweb, publicada como base SQLite
// por el proyecto público 005Jan/sulfata-datos (cita la fuente y no modifica los datos).
// Se ejecuta cada semana (pg_cron) y solo carga si la fecha de los datos es nueva.
//
// Para no pasar de los límites de memoria y CPU de una función, la carga va por partes:
// la llamada principal coordina y cada parte (?parte=N) sube un trozo de los usos autorizados.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import initSqlJs from "npm:sql.js@1.11.0";

const BASE = "https://github.com/005Jan/sulfata-datos/releases/latest/download";
const WASM = [
  "https://cdn.jsdelivr.net/npm/sql.js@1.11.0/dist/sql-wasm.wasm",
  "https://unpkg.com/sql.js@1.11.0/dist/sql-wasm.wasm",
];
const POR_PARTE = 7000; // usos por parte
const LOTE = 1000; // filas por petición a la base de datos

const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json" } });

async function sha256(buf: ArrayBuffer) {
  const h = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function wasm() {
  for (const u of WASM) {
    try {
      const r = await fetch(u);
      if (r.ok) return await r.arrayBuffer();
    } catch (_) { /* siguiente */ }
  }
  throw new Error("No se pudo descargar sql-wasm");
}

async function abrirBase(version: { archivo?: string; sha256_gz?: string }) {
  const gz = await (await fetch(`${BASE}/${version.archivo || "sulfata.db.gz"}`)).arrayBuffer();
  if (version.sha256_gz && (await sha256(gz)) !== version.sha256_gz) throw new Error("Huella SHA-256 incorrecta");
  const bytes = new Uint8Array(await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
  const SQL = await initSqlJs({ wasmBinary: await wasm() });
  return new SQL.Database(bytes);
}

function filas(s: { exec: (q: string) => { columns: string[]; values: unknown[][] }[] }, q: string) {
  const r = s.exec(q)[0];
  if (!r) return [] as Record<string, unknown>[];
  return r.values.map((v) => Object.fromEntries(r.columns.map((c, i) => [c, v[i]])));
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const forzar = url.searchParams.get("forzar") === "1";
  const parte = url.searchParams.get("parte");
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  const subir = async (tabla: string, arr: Record<string, unknown>[], conflicto?: string) => {
    for (let i = 0; i < arr.length; i += LOTE) {
      const { error } = await db.from(tabla).upsert(arr.slice(i, i + LOTE), conflicto ? { onConflict: conflicto, ignoreDuplicates: true } : {});
      if (error) throw new Error(`${tabla}: ${error.message}`);
    }
  };

  try {
    const version = await (await fetch(`${BASE}/version.json`)).json();

    // ---------- Una parte de la carga ----------
    if (parte !== null) {
      const n = Number(parte);
      const fecha = url.searchParams.get("fecha") || version.fecha_datos;
      if (fecha !== version.fecha_datos) return json({ estado: "fecha_cambiada" }, 409);
      const s = await abrirBase(version);
      if (n === 0) {
        await subir("fito_productos", filas(s, "select id, registro, nombre, titular, formulado, estado, caducidad, cancelacion, limite_venta from producto"));
        await subir("fito_cultivos", filas(s, "select id, codigo, nombre from cultivo"));
        await subir("fito_agentes", filas(s, "select id, codigo, nombre, tipo from agente"));
      }
      const usos = filas(
        s,
        `select rowid as orden, producto_id, cultivo_id, agente_id, dosis_min, dosis_max, unidad, plazo, plazo_dias,
                aplicaciones, intervalo, caldo, ambito, sistema, metodo
           from uso order by rowid limit ${POR_PARTE} offset ${n * POR_PARTE}`,
      ).map((u) => ({ ...u, lote: fecha }));
      s.close();
      await subir("fito_usos", usos, "lote,orden");
      return json({ estado: "parte_ok", parte: n, usos: usos.length });
    }

    // ---------- Coordinador ----------
    const { data: info } = await db.from("fito_info").select("clave, valor");
    const valor = (k: string) => info?.find((x) => x.clave === k)?.valor;
    const ultima = valor("actualizado_en");
    // Freno: como mucho una carga cada 6 horas (la función es pública)
    if (ultima && Date.now() - new Date(ultima).getTime() < 6 * 3600 * 1000) {
      return json({ estado: "reciente", fecha_datos: valor("fecha_datos") });
    }
    if (!forzar && version.fecha_datos && version.fecha_datos <= (valor("fecha_datos") || "")) {
      await db.from("fito_info").upsert({ clave: "comprobado_en", valor: new Date().toISOString() });
      return json({ estado: "sin_cambios", fecha_datos: version.fecha_datos });
    }

    // Cuántas partes hacen falta (y comprobación de que los datos están completos)
    const s = await abrirBase(version);
    const total = Number(filas(s, "select count(*) as n from uso")[0].n);
    const productos = filas(s, "select id from producto").map((p) => Number(p.id));
    s.close();
    if (productos.length < 1500 || total < 50000) throw new Error(`Datos incompletos: ${productos.length} productos, ${total} usos`);

    const fecha = version.fecha_datos;
    const yo = `${Deno.env.get("SUPABASE_URL")}/functions/v1/actualizar-fitos`;
    const partes = Math.ceil(total / POR_PARTE);
    const lanzar = async (n: number, intento = 1): Promise<void> => {
      const r = await fetch(`${yo}?parte=${n}&fecha=${fecha}`, { method: "POST" });
      if (r.ok) return;
      if (intento < 3) return lanzar(n, intento + 1);
      throw new Error(`parte ${n}: ${r.status} ${(await r.text()).slice(0, 200)}`);
    };
    for (let i = 0; i < partes; i += 3) await Promise.all([i, i + 1, i + 2].filter((n) => n < partes).map((n) => lanzar(n)));

    const { count } = await db.from("fito_usos").select("*", { count: "exact", head: true }).eq("lote", fecha);
    if ((count ?? 0) < total) throw new Error(`Solo se han cargado ${count} de ${total} usos`);

    const { error } = await db.rpc("fito_finalizar_carga", { p_lote: fecha, p_ids: productos });
    if (error) throw new Error(`finalizar: ${error.message}`);
    return json({ estado: "actualizado", fecha_datos: fecha, productos: productos.length, usos: total, partes });
  } catch (e) {
    console.error(e);
    return json({ estado: "error", error: String((e as Error).message || e) }, 500);
  }
});
