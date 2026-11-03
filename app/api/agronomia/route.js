// AgronomIA: consultas técnicas (plagas, enfermedades, abonado, riego, poda…)
// con el contexto de la explotación del usuario. Es orientativa: no sustituye
// al asesor inscrito en el ROPO ni a la etiqueta del producto.
import Anthropic from "@anthropic-ai/sdk";
import { ahoraEspana, claude, clienteDelUsuario, comprobarLimiteIA, ErrorHttp, MODELO, respuestaError, rolEnEmpresa } from "@/lib/servidor";

export const maxDuration = 90;

const lista = (arr, f) => (arr || []).map(f).join("\n") || "(sin datos)";
const BUSQUEDA = { type: "web_search_20250305", name: "web_search", max_uses: 3, user_location: { type: "approximate", country: "ES", timezone: "Europe/Madrid" } };

export async function POST(req) {
  try {
    const { supabase, user } = await clienteDelUsuario(req);
    const { empresa_id, pregunta, historial = [], recinto_id = null, imagen = null } = await req.json();
    if (!pregunta?.trim() && !imagen) throw new ErrorHttp(400, "Escribe tu consulta");
    if (String(pregunta || "").length > 4000) throw new ErrorHttp(400, "La consulta es demasiado larga");
    if (imagen && (!/^image\/(jpeg|png|webp)$/.test(imagen.media_type || "") || String(imagen.data || "").length > 7_000_000)) throw new ErrorHttp(400, "Foto no válida o demasiado grande");
    const rol = await rolEnEmpresa(supabase, user.id, empresa_id);
    await comprobarLimiteIA(supabase);

    const hace = new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10);
    const [emp, rc, trat, fert, obs] = await Promise.all([
      supabase.from("empresas").select("comunidad_autonoma, provincia, municipio").eq("id", empresa_id).single(),
      supabase
        .from("recinto_cultivos")
        .select("recinto_id, superficie_ha, variedad, anio_plantacion, regadio, cultivos(nombre), campanas!inner(nombre, activa), recintos(superficie_sigpac_ha, uso_sigpac, pendiente_media, zona_vulnerable, provincia_sigpac, parcelas(nombre))")
        .eq("empresa_id", empresa_id)
        .eq("activo", true)
        .eq("campanas.activa", true),
      supabase.from("v_cuaderno_campo").select("fecha, parcela, recinto_id, cultivo, tipo_aplicacion, plaga_o_motivo, producto, materia_activa, dosis_ha, unidad_dosis").eq("empresa_id", empresa_id).gte("fecha", hace).order("fecha", { ascending: false }).limit(60),
      supabase.from("v_fertilizacion_recintos").select("parcela, recinto_id, cultivo, campana, n_aplicado_kg_ha, p2o5_aplicado_kg_ha, k2o_aplicado_kg_ha, n_max_kg_ha, p2o5_max_kg_ha, k2o_max_kg_ha, zona_vulnerable").eq("empresa_id", empresa_id).limit(80),
      supabase.from("observaciones_agronomicas").select("fecha, tipo, descripcion, recinto_id").eq("empresa_id", empresa_id).gte("fecha", hace).order("fecha", { ascending: false }).limit(20),
    ]);

    const recs = rc.data || [];
    const nombreRec = Object.fromEntries(recs.map((r) => [r.recinto_id, r.recintos?.parcelas?.nombre]));
    const foco = recinto_id ? recs.find((r) => r.recinto_id === recinto_id) : null;
    const ahora = ahoraEspana();
    const e = emp.data || {};

    const sistema = `Eres AgronomIA, el asesor agronómico de Cultivix para pequeños y medianos agricultores de España. Hablas como un ingeniero agrónomo de campo con mucha experiencia: claro, práctico, cercano y sin rodeos. Respondes en español.

Hoy es ${ahora.texto}. Explotación en ${[e.municipio, e.provincia, e.comunidad_autonoma].filter(Boolean).join(", ") || "España (zona sin indicar)"}.

Cómo responder:
- Empieza por la respuesta directa en 1-2 frases. Después, si hace falta, pasos concretos con viñetas cortas. Unas 250 palabras como máximo salvo que pida más detalle.
- Usa los datos de su explotación de abajo (cultivos, superficies, tratamientos y abonados ya hechos, balance de nutrientes) para personalizar. Si te falta un dato clave (variedad, edad, riego, análisis de suelo…), dilo y explica cómo cambiaría la respuesta.
- Fitosanitarios: prioriza la gestión integrada (umbrales, seguimiento, medidas culturales y biológicas). Si mencionas productos, habla de materias activas autorizadas en España para ese cultivo y plaga, y recuerda comprobar siempre la autorización vigente en el Registro de Productos Fitosanitarios del MAPA, la dosis y el plazo de seguridad de la etiqueta. Nunca recomiendes dosis por encima de la etiqueta, mezclas no autorizadas ni usos fuera de registro.
- Fertilización: razona con el balance de N, P₂O₅ y K₂O (necesidades del cultivo según rendimiento esperado, aportes ya hechos, suelo, agua de riego) y el RD 1051/2022. Si das cifras de necesidades, di que son orientativas y que el plan de abonado debe validarlo su asesor cuando sea obligatorio. En zonas vulnerables recuerda el límite de 170 kg N/ha de origen orgánico y que su comunidad puede tener límites más estrictos.
- Fotos: describe lo que ves, da las causas más probables con su grado de seguridad y cómo confirmarlo en campo (síntomas a buscar, trampas, análisis). No afirmes un diagnóstico seguro con una sola foto.
- Si la consulta tiene consecuencias legales o de seguridad (tratamientos en explotaciones con asesoramiento GIP obligatorio, plazos de seguridad, zonas vulnerables), recuerda en una frase que la decisión final es del agricultor con su asesor inscrito en el ROPO.
- Si buscas en internet, prioriza fuentes oficiales (MAPA, consejerías, RAIF, estaciones de avisos, IFAPA, ITACyL, IVIA, universidades). No inventes datos ni normas: si no estás seguro, dilo.
- Es una conversación: ten en cuenta lo hablado antes y responde a la nueva pregunta sin repetir lo que ya dijiste.
- Si el usuario te cuenta un trabajo que ha hecho para apuntarlo (labores, tratamientos, abonados), dile en una frase que para registrarlo use el botón «Hablar con Cultivix» de Inicio, y si aporta algo técnico, coméntalo.
- No uses tablas. Puedes usar **negrita** y viñetas con "- ".
- Rol del usuario: ${rol}.

=== CULTIVOS DE LA EXPLOTACIÓN (campañas en curso) ===
${lista(recs, (r) => `${r.recintos?.parcelas?.nombre || "?"} (id ${r.recinto_id}): ${r.cultivos?.nombre || "?"}${r.variedad ? " " + r.variedad : ""}, ${r.superficie_ha ?? r.recintos?.superficie_sigpac_ha ?? "?"} ha, ${r.regadio ? "regadío" : "secano"}${r.anio_plantacion ? `, plantado en ${r.anio_plantacion}` : ""}${r.recintos?.pendiente_media != null ? `, pendiente ${r.recintos.pendiente_media}%` : ""}${r.recintos?.zona_vulnerable ? ", ZONA VULNERABLE" : ""}`)}
${foco ? `\nLa consulta es sobre la parcela: ${foco.recintos?.parcelas?.nombre} (${foco.cultivos?.nombre}).` : ""}

=== TRATAMIENTOS Y ABONADOS ÚLTIMOS 6 MESES ===
${lista(trat.data, (t) => `${t.fecha} | ${t.parcela} | ${t.cultivo || "-"} | ${t.tipo_aplicacion} | ${t.plaga_o_motivo || "-"} | ${t.producto}${t.materia_activa ? ` (${t.materia_activa})` : ""} ${t.dosis_ha ?? "?"} ${t.unidad_dosis || ""}`)}

=== BALANCE DE NUTRIENTES POR RECINTO (kg/ha aplicado / máximo del plan) ===
${lista(fert.data, (f) => `${f.parcela} ${f.cultivo} ${f.campana}: N ${f.n_aplicado_kg_ha}/${f.n_max_kg_ha ?? "sin plan"}, P2O5 ${f.p2o5_aplicado_kg_ha}/${f.p2o5_max_kg_ha ?? "-"}, K2O ${f.k2o_aplicado_kg_ha}/${f.k2o_max_kg_ha ?? "-"}${f.zona_vulnerable ? " (zona vulnerable)" : ""}`)}

=== OBSERVACIONES DE CAMPO RECIENTES ===
${lista(obs.data, (o) => `${o.fecha} | ${nombreRec[o.recinto_id] || "-"} | ${o.tipo || "-"} | ${o.descripcion}`)}`;

    // Historial: alterna turnos y empieza por el usuario
    const mensajes = [];
    for (const m of historial.slice(-8).filter((h) => h?.texto)) {
      const role = m.rol === "usuario" ? "user" : "assistant";
      if (!mensajes.length && role !== "user") continue;
      const ult = mensajes[mensajes.length - 1];
      if (ult && ult.role === role) ult.content += "\n" + String(m.texto);
      else mensajes.push({ role, content: String(m.texto) });
    }
    if (mensajes.length && mensajes[mensajes.length - 1].role === "user") mensajes.pop();
    const contenido = [];
    if (imagen) contenido.push({ type: "image", source: { type: "base64", media_type: imagen.media_type, data: imagen.data } });
    contenido.push({ type: "text", text: pregunta?.trim() || "¿Qué ves en esta foto? ¿Qué puede ser y qué debería hacer?" });
    mensajes.push({ role: "user", content: contenido });

    const pedir = (conBusqueda) =>
      claude().messages.create({
        model: MODELO,
        max_tokens: 1800,
        system: sistema,
        ...(conBusqueda ? { tools: [BUSQUEDA] } : {}),
        messages: mensajes,
      });
    let r;
    try {
      r = await pedir(process.env.AGRONOMIA_BUSQUEDA !== "0");
    } catch (err) {
      // Si la búsqueda web no está disponible en la cuenta, se responde sin ella
      if (err instanceof Anthropic.APIError && err.status === 400) r = await pedir(false);
      else throw err;
    }

    const respuesta = r.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    const fuentes = [];
    for (const b of r.content) {
      for (const c of b.citations || []) if (c.url && !fuentes.some((f) => f.url === c.url)) fuentes.push({ url: c.url, titulo: c.title || c.url });
    }
    if (!respuesta) throw new ErrorHttp(502, "AgronomIA no ha podido responder. Prueba a reformular la pregunta.");

    const { data: fila } = await supabase
      .from("consultas_agronomia")
      .insert({ empresa_id, recinto_id: foco ? recinto_id : null, pregunta: pregunta?.trim() || "(foto)", respuesta, con_foto: !!imagen })
      .select("id")
      .single();

    return Response.json({ id: fila?.id || null, respuesta, fuentes: fuentes.slice(0, 6) });
  } catch (e) {
    return respuestaError(e);
  }
}
