// Actualiza el catálogo del Registro de Productos Fitosanitarios (MAPA) en la base de datos.
// Fuente: exportación oficial «Productos autorizados» de regfiweb, publicada como base SQLite
// por el proyecto público 005Jan/sulfata-datos (cita la fuente y no modifica los datos).
// Se ejecuta cada semana (pg_cron) y solo carga si la fecha de los datos es nueva.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import initSqlJs from "npm:sql.js@1.11.0";

const BASE = "https://github.com/005Jan/sulfata-datos/releases/latest/download";
const WASM = [
  "https://cdn.jsdelivr.net/npm/sql.js@1.11.0/dist/sql-wasm.wasm",
  "https://unpkg.com/sql.js@1.11.0/dist/sql-wasm.wasm",
];
const LOTE = 4000;

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

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const forzar = url.searchParams.get("forzar") === "1";
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  try {
    // Freno: como mucho una carga cada 6 horas (la función es pública)
    const { data: info } = await db.from("fito_info").select("clave, valor");
    const valor = (k: string) => info?.find((x) => x.clave === k)?.valor;
    const ultima = valor("actualizado_en");
    if (ultima && Date.now() - new Date(ultima).getTime() < 6 * 3600 * 1000) {
      return json({ estado: "reciente", fecha_datos: valor("fecha_datos") });
    }

    const version = await (await fetch(`${BASE}/version.json`)).json();
    if (!forzar && version.fecha_datos && version.fecha_datos <= (valor("fecha_datos") || "")) {
      await db.from("fito_info").upsert({ clave: "comprobado_en", valor: new Date().toISOString() });
      return json({ estado: "sin_cambios", fecha_datos: version.fecha_datos });
    }

    const gz = await (await fetch(`${BASE}/${version.archivo || "sulfata.db.gz"}`)).arrayBuffer();
    if (version.sha256_gz && (await sha256(gz)) !== version.sha256_gz) throw new Error("Huella SHA-256 incorrecta");
    const bytes = new Uint8Array(await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());

    const SQL = await initSqlJs({ wasmBinary: await wasm() });
    const s = new SQL.Database(bytes);
    const filas = (q: string) => {
      const r = s.exec(q)[0];
      if (!r) return [];
      return r.values.map((v: unknown[]) => Object.fromEntries(r.columns.map((c: string, i: number) => [c, v[i]])));
    };
    const fecha = String(filas("select valor from info where clave = 'fecha_datos'")[0]?.valor || version.fecha_datos);

    const productos = filas("select id, registro, nombre, titular, formulado, estado, caducidad, cancelacion, limite_venta from producto");
    const cultivos = filas("select id, codigo, nombre from cultivo");
    const agentes = filas("select id, codigo, nombre, tipo from agente");
    const usos = filas(`select producto_id, cultivo_id, agente_id, dosis_min, dosis_max, unidad, plazo, plazo_dias,
                               aplicaciones, intervalo, caldo, ambito, sistema, metodo from uso`);
    s.close();
    if (productos.length < 1500 || usos.length < 50000) throw new Error(`Datos incompletos: ${productos.length} productos, ${usos.length} usos`);

    const subir = async (tabla: string, arr: Record<string, unknown>[], upsert: boolean) => {
      for (let i = 0; i < arr.length; i += LOTE) {
        const trozo = arr.slice(i, i + LOTE);
        const { error } = upsert ? await db.from(tabla).upsert(trozo) : await db.from(tabla).insert(trozo);
        if (error) throw new Error(`${tabla}: ${error.message}`);
      }
    };
    await subir("fito_productos", productos, true);
    await subir("fito_cultivos", cultivos, true);
    await subir("fito_agentes", agentes, true);
    // Si una carga anterior se cortó a medias, se borra lo que dejó de este mismo lote
    const { error: e1 } = await db.from("fito_usos").delete().eq("lote", fecha);
    if (e1) throw new Error(`limpiar: ${e1.message}`);
    await subir("fito_usos", usos.map((u) => ({ ...u, lote: fecha })), false);

    const { error } = await db.rpc("fito_finalizar_carga", { p_lote: fecha, p_ids: productos.map((p) => p.id) });
    if (error) throw new Error(`finalizar: ${error.message}`);
    return json({ estado: "actualizado", fecha_datos: fecha, productos: productos.length, usos: usos.length });
  } catch (e) {
    console.error(e);
    return json({ estado: "error", error: String((e as Error).message || e) }, 500);
  }
});
