// Utilidades SOLO para rutas /api (servidor). Nunca importar desde componentes cliente.
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";

export class ErrorHttp extends Error {
  constructor(status, mensaje) {
    super(mensaje);
    this.status = status;
  }
}

/** Cliente Supabase que actúa COMO el usuario (respeta RLS). */
export async function clienteDelUsuario(req) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token || token === "undefined") throw new ErrorHttp(401, "Sesión no válida. Vuelve a entrar.");
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) throw new ErrorHttp(401, "Sesión caducada. Vuelve a entrar.");
  return { supabase, user: data.user };
}

export async function rolEnEmpresa(supabase, userId, empresaId) {
  const { data } = await supabase.from("empresa_usuarios").select("rol").eq("empresa_id", empresaId).eq("usuario_id", userId).eq("activo", true).maybeSingle();
  if (!data) throw new ErrorHttp(403, "No tienes acceso a esta empresa");
  return data.rol;
}

export function claude() {
  if (!process.env.ANTHROPIC_API_KEY) throw new ErrorHttp(503, "Falta configurar ANTHROPIC_API_KEY en el servidor.");
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, ...(process.env.ANTHROPIC_BASE_URL ? { baseURL: process.env.ANTHROPIC_BASE_URL } : {}) });
}

export const MODELO = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";

export function respuestaError(e) {
  console.error(e);
  if (e instanceof Anthropic.APIError) {
    const msg =
      e.status === 401 || e.status === 403
        ? "La clave de la IA (ANTHROPIC_API_KEY) no es válida. Revísala en Vercel."
        : e.status === 429 || e.status === 529 || e.status >= 500
        ? "La IA está saturada, prueba en unos segundos."
        : "La IA no ha podido procesar la petición.";
    return Response.json({ error: msg }, { status: 503 });
  }
  const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 500;
  const msg = e instanceof ErrorHttp ? e.message : status === 529 || status === 429 ? "La IA está saturada, prueba en unos segundos." : "Error interno: " + (e.message || "desconocido");
  return Response.json({ error: msg }, { status });
}

/**
 * Pide a Claude una respuesta estructurada con una herramienta.
 * Algunos modelos no admiten forzar la herramienta (tool_choice "tool"/"any"), así que se
 * deja en "auto", se le pide en las instrucciones y, si contesta solo con texto, se le
 * insiste una vez. Devuelve { datos, texto }: datos = entrada de la herramienta o null.
 */
export async function pedirConHerramienta({ system, messages, herramienta, max_tokens = 2000, valido = () => true }) {
  const cliente = claude();
  const sistema = `${system}\n\nIMPORTANTE: responde SIEMPRE llamando a la herramienta «${herramienta.name}». No escribas nada fuera de ella.`;
  const base = { model: MODELO, max_tokens, system: sistema, tools: [herramienta], tool_choice: { type: "auto" } };
  let r = await cliente.messages.create({ ...base, messages });
  let datos = entradaHerramienta(r, herramienta.input_schema);
  let texto = textoDe(r);
  if (!datos) {
    r = await cliente.messages.create({
      ...base,
      messages: [...messages, { role: "assistant", content: texto || "…" }, { role: "user", content: `Dame esa misma respuesta usando la herramienta «${herramienta.name}».` }],
    });
    datos = entradaHerramienta(r, herramienta.input_schema);
    texto = textoDe(r) || texto;
  }
  if (datos && !valido(datos)) {
    const r2 = await cliente.messages.create({
      ...base,
      messages: [...messages, { role: "assistant", content: r.content }, { role: "user", content: [
        ...r.content.filter((b) => b.type === "tool_use").map((b) => ({ type: "tool_result", tool_use_id: b.id, is_error: true, content: "Faltan campos o están mal formados: los objetos (parte, aplicacion, riego…) deben ir como objetos JSON, no como texto. Vuelve a llamar a la herramienta completa." })),
      ] }],
    });
    const d2 = entradaHerramienta(r2, herramienta.input_schema);
    if (d2 && valido(d2)) datos = d2;
  }
  if (!datos && texto) {
    const m = texto.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        datos = reparar(JSON.parse(m[0]), herramienta.input_schema);
      } catch {}
    }
  }
  return { datos, texto };
}

export function textoDe(mensaje) {
  return (mensaje.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

/** Devuelve el primer bloque tool_use de una respuesta de Claude. */
export function entradaHerramienta(mensaje, esquema) {
  const v = mensaje.content.find((b) => b.type === "tool_use")?.input || null;
  return v && esquema ? reparar(v, esquema) : v;
}

/** A veces el modelo devuelve un objeto anidado como texto (JSON o etiquetas
 *  <parameter name="x">…</parameter>). Lo convertimos al tipo que pide el esquema. */
function desdeTexto(t) {
  const s = String(t).trim();
  try { return JSON.parse(s); } catch {}
  const re = /<parameter name="([^"]+)">([\s\S]*?)(?=<\/parameter>|<parameter name=|$)/g;
  const o = {}; let x, hay = false;
  while ((x = re.exec(s))) { hay = true; const val = x[2].trim(); try { o[x[1]] = JSON.parse(val); } catch { o[x[1]] = val; } }
  if (hay) return o;
  const m = s.match(/[\[{][\s\S]*[\]}]/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return undefined;
}
export function reparar(valor, esquema) {
  if (!esquema || valor == null) return valor;
  const tipo = Array.isArray(esquema.type) ? esquema.type.find((t) => t !== "null") : esquema.type;
  if (tipo === "object") {
    let v = typeof valor === "string" ? desdeTexto(valor) : valor;
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    const props = esquema.properties || {};
    const out = { ...v };
    for (const k of Object.keys(out)) {
      if (!props[k]) continue;
      const hijo = out[k];
      // Campos del nivel superior que el modelo metió dentro de un objeto hijo: subirlos
      if (hijo && typeof hijo === "string" && props[k].type === "object") {
        const crudo = desdeTexto(hijo);
        if (crudo && typeof crudo === "object" && !Array.isArray(crudo)) {
          const propsHijo = props[k].properties || {};
          for (const kk of Object.keys(crudo)) if (!propsHijo[kk] && props[kk] && out[kk] == null) { out[kk] = crudo[kk]; delete crudo[kk]; }
          out[k] = crudo;
        }
      }
    }
    for (const k of Object.keys(out)) if (props[k]) out[k] = reparar(out[k], props[k]);
    return out;
  }
  if (tipo === "array") {
    let v = typeof valor === "string" ? desdeTexto(valor) ?? (valor.trim() ? valor.split(/\s*,\s*/) : []) : valor;
    if (v != null && !Array.isArray(v)) v = [v];
    return Array.isArray(v) ? v.map((e) => reparar(e, esquema.items)) : [];
  }
  if (tipo === "number" || tipo === "integer") {
    if (typeof valor === "number") return valor;
    const n = parseFloat(String(valor).replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  if (tipo === "boolean") return typeof valor === "boolean" ? valor : String(valor).toLowerCase() === "true";
  if (tipo === "string") return typeof valor === "string" ? valor : valor == null ? null : typeof valor === "object" ? JSON.stringify(valor) : String(valor);
  return valor;
}

/** Fecha/hora local de España para dar contexto temporal a la IA. */
export function ahoraEspana() {
  const d = new Date();
  const f = new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", weekday: "long", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d);
  const iso = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Madrid" }).format(d); // YYYY-MM-DD
  return { texto: f, iso };
}

/** Límite diario de usos de IA por usuario (protege de abusos y de facturas inesperadas). */
export const LIMITE_IA_DIARIO = Number(process.env.LIMITE_IA_DIARIO || 150);
export async function comprobarLimiteIA(supabase) {
  const { data } = await supabase.rpc("ia_usos_hoy");
  if ((data || 0) >= LIMITE_IA_DIARIO) throw new ErrorHttp(429, "Has llegado al límite diario del asistente. Mañana vuelve a estar disponible.");
}
