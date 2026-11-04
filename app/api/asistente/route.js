// Asistente Cultivix: interpreta lo que dice el agricultor (texto o voz) y
// devuelve una PROPUESTA estructurada. Nunca guarda nada por sí mismo:
// el usuario confirma en la app (DEC-051, UX-005).
import { comprobarLimiteIA, ahoraEspana, clienteDelUsuario, MODELO, pedirConHerramienta, respuestaError, rolEnEmpresa } from "@/lib/servidor";

export const maxDuration = 60;

const HERRAMIENTA = {
  name: "responder",
  description: "Devuelve la interpretación del mensaje del agricultor como propuesta para confirmar, o una respuesta a su consulta.",
  input_schema: {
    type: "object",
    properties: {
      tipo: {
        type: "string",
        enum: ["iniciar_trabajo", "registrar_trabajo", "registrar_observacion", "consulta", "no_entendido"],
        description:
          "iniciar_trabajo: va a empezar ahora ('voy a…'). registrar_trabajo: ya lo hizo ('he…', 'ayer…', 'esta mañana…'), incluidas aplicaciones de productos. registrar_observacion: ha visto algo (plaga, daño, incidencia). consulta: pregunta por sus datos. no_entendido: falta información esencial.",
      },
      mensaje: { type: "string", description: "Respuesta breve en español para el agricultor (1-3 frases, tono cercano). En consultas, la respuesta completa con cifras." },
      parte: {
        type: "object",
        description: "Solo para iniciar_trabajo o registrar_trabajo.",
        properties: {
          labor_id: { type: "string" },
          fecha: { type: "string", description: "YYYY-MM-DD" },
          hora_inicio: { type: "string", description: "HH:MM si se sabe o se deduce (mañana≈08:00, tarde≈16:00)" },
          horas: { type: "number" },
          recinto_ids: { type: "array", items: { type: "string" } },
          maquinaria_ids: { type: "array", items: { type: "string" } },
          apero_ids: { type: "array", items: { type: "string" } },
          trabajador_ids: { type: "array", items: { type: "string" } },
          observaciones: { type: "string" },
        },
      },
      aplicacion: {
        type: "object",
        description: "Si el trabajo es un tratamiento, abonado o herbicida con productos.",
        properties: {
          plaga_o_motivo: { type: "string" },
          productos: {
            type: "array",
            items: {
              type: "object",
              properties: {
                producto_id: { type: "string" },
                dosis_ha: { type: "number" },
                unidad_dosis: { type: "string", description: "kg/ha, l/ha…" },
              },
              required: ["producto_id"],
            },
          },
          productos_nuevos: { type: "array", items: { type: "string" }, description: "Nombres de productos mencionados que NO están en su catálogo." },
        },
      },
      riego: {
        type: "object",
        description: "Solo si el trabajo es un riego: agua aplicada y sistema.",
        properties: {
          m3_ha: { type: "number", description: "m³ por hectárea (1 mm = 10 m³/ha)" },
          volumen_m3: { type: "number", description: "m³ en total si los da así (contador)" },
          sistema: { type: "string", enum: ["goteo", "aspersion", "microaspersion", "gravedad", "pivot", "otro"] },
          fertirrigacion: { type: "boolean" },
        },
      },
      observacion: {
        type: "object",
        properties: {
          recinto_id: { type: "string" },
          tipo: { type: "string", enum: ["plaga", "enfermedad", "daño", "riego", "maquinaria", "otro"] },
          descripcion: { type: "string" },
        },
      },
      dudas: { type: "array", items: { type: "string" }, description: "Datos que has supuesto o no estás seguro (para que el usuario los revise)." },
    },
    required: ["tipo", "mensaje"],
  },
};

const lista = (arr, f) => arr.map(f).join("\n") || "(ninguno)";

export async function POST(req) {
  try {
    const { supabase, user } = await clienteDelUsuario(req);
    const { empresa_id, mensaje, historial = [], recinto_actual_id, canal = "texto" } = await req.json();
    if (!mensaje?.trim()) return Response.json({ error: "Mensaje vacío" }, { status: 400 });
    const rol = await rolEnEmpresa(supabase, user.id, empresa_id);
    await comprobarLimiteIA(supabase);
    const gestor = ["propietario", "administrador", "encargado"].includes(rol);

    // ---- Contexto de la explotación (todo con los permisos del usuario) ----
    const hace1a = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
    const [lab, rec, maq, ape, tra, pro, stock, partes, compras, camp] = await Promise.all([
      supabase.from("labores").select("id,nombre,categoria,palabras_clave,maquinaria_habitual_id,apero_habitual_id").eq("empresa_id", empresa_id).eq("activa", true),
      supabase.from("recintos").select("id,recinto_sigpac,superficie_sigpac_ha,parcela_id,parcelas(nombre,fincas(nombre)),recinto_cultivos(cultivos(nombre))").eq("empresa_id", empresa_id).eq("activo", true),
      supabase.from("maquinaria").select("id,nombre,tipo").eq("empresa_id", empresa_id).eq("activa", true),
      supabase.from("aperos").select("id,nombre").eq("empresa_id", empresa_id).eq("activo", true),
      supabase.from("trabajadores").select("id,nombre,apellidos,usuario_id").eq("empresa_id", empresa_id).eq("activo", true),
      supabase.from("productos").select("id,nombre,tipo,unidad,dosis_habitual_ha").eq("empresa_id", empresa_id).eq("activo", true),
      gestor ? supabase.from("v_stock_productos").select("producto_id,stock,precio_medio").eq("empresa_id", empresa_id) : Promise.resolve({ data: [] }),
      supabase
        .from("partes_trabajo")
        .select("id,fecha,horas_totales,estado,labor_id,partes_trabajo_recintos(recinto_id),aplicaciones(aplicaciones_productos(producto_id,dosis_ha,cantidad_total))")
        .eq("empresa_id", empresa_id)
        .gte("fecha", hace1a)
        .neq("estado", "descartado")
        .order("fecha", { ascending: false })
        .limit(400),
      gestor
        ? supabase.from("albaranes_compra").select("fecha,total,proveedores(nombre),albaranes_compra_lineas(descripcion,cantidad,unidad,importe)").eq("empresa_id", empresa_id).gte("fecha", hace1a).order("fecha", { ascending: false }).limit(100)
        : Promise.resolve({ data: [] }),
      supabase.from("campanas").select("nombre,fecha_inicio,fecha_fin,cultivos(nombre)").eq("empresa_id", empresa_id).eq("activa", true),
    ]);

    const costes = {};
    if (gestor && partes.data?.length) {
      const { data } = await supabase.from("v_partes_coste").select("*").in("parte_trabajo_id", partes.data.slice(0, 200).map((p) => p.id));
      for (const c of data || []) costes[c.parte_trabajo_id] = (+c.coste_mano_obra + +c.coste_maquinaria + +c.coste_productos).toFixed(2);
    }

    const recintos = rec.data || [];
    const nomRec = Object.fromEntries(recintos.map((r) => [r.id, r.parcelas?.nombre + (r.recinto_sigpac ? ` rec.${r.recinto_sigpac}` : "")]));
    const nomLab = Object.fromEntries((lab.data || []).map((l) => [l.id, l.nombre]));
    const nomPro = Object.fromEntries((pro.data || []).map((p) => [p.id, p.nombre]));
    const st = Object.fromEntries((stock.data || []).map((s) => [s.producto_id, s]));
    const yo = (tra.data || []).find((t) => t.usuario_id === user.id);
    const ahora = ahoraEspana();

    const sistema = `Eres el Asistente Cultivix, ayudante de un agricultor español. Hablas claro, breve y cercano, como un buen encargado de campo.
Tu trabajo es convertir lo que dice el agricultor en una PROPUESTA para que él la confirme con un toque. Nunca digas que has guardado algo: di "revisa y confirma".

Reglas:
- Usa EXCLUSIVAMENTE los IDs de las listas. Nunca inventes IDs. Si algo no encaja, déjalo vacío y añádelo a "dudas".
- Las parcelas pueden nombrarse de forma aproximada ("la mesa", "las de pistacho", "todo el olivar"): incluye todos los recintos que encajen.
- Si no menciona parcela y hay "parcela donde está ahora", usa esa.
- Propón la maquinaria y apero habituales de la labor si no dice otros.
- Si no menciona trabajadores, déjalo vacío (se asigna quien registra).
- Fechas relativas respecto a hoy: ${ahora.texto} (hoy = ${ahora.iso}). "Esta mañana" → hoy, hora_inicio 08:00 si no dice otra.
- Riegos: elige la labor de categoría riego y rellena "riego" con el agua (m³/ha, mm o m³ totales) y el sistema si lo dice.
- Tratamientos/abonados: elige la labor de categoría tratamiento/fertilizacion/herbicida que mejor encaje y rellena "aplicacion". Si dice la dosis, úsala; si no, la habitual del producto o deja vacío y anótalo en dudas. Comprar un producto NO es aplicarlo.
- Consultas: responde con datos concretos (horas, costes, fechas, cantidades) calculados de los datos de abajo. Si no hay datos suficientes, dilo. No des recomendaciones de dosis de fitosanitarios más allá de lo registrado: la decisión técnica es del agricultor y su asesor.
- Rol del usuario: ${rol}${gestor ? "" : " (trabajador: no tiene acceso a datos económicos; no los menciones)"}.

=== LABORES (id | nombre | categoría | palabras clave | habituales) ===
${lista(lab.data || [], (l) => `${l.id} | ${l.nombre} | ${l.categoria} | ${(l.palabras_clave || []).join(", ")} | maq:${l.maquinaria_habitual_id || "-"} apero:${l.apero_habitual_id || "-"}`)}

=== PARCELAS/RECINTOS (id | parcela | finca | cultivo | ha) ===
${lista(recintos, (r) => `${r.id} | ${nomRec[r.id]} | ${r.parcelas?.fincas?.nombre || "-"} | ${(r.recinto_cultivos || []).map((c) => c.cultivos?.nombre).join("/") || "-"} | ${r.superficie_sigpac_ha ?? "-"}`)}
${recinto_actual_id ? `Parcela donde está ahora (GPS): ${recinto_actual_id} (${nomRec[recinto_actual_id] || "?"})` : "GPS: sin parcela detectada"}

=== MAQUINARIA ===
${lista(maq.data || [], (m) => `${m.id} | ${m.nombre}`)}
=== APEROS ===
${lista(ape.data || [], (a) => `${a.id} | ${a.nombre}`)}
=== TRABAJADORES ===
${lista(tra.data || [], (t) => `${t.id} | ${t.nombre} ${t.apellidos || ""}${t.id === yo?.id ? " (es el usuario)" : ""}`)}
=== PRODUCTOS (id | nombre | tipo | unidad | dosis habitual/ha${gestor ? " | stock | €/ud" : ""}) ===
${lista(pro.data || [], (p) => `${p.id} | ${p.nombre} | ${p.tipo} | ${p.unidad} | ${p.dosis_habitual_ha ?? "-"}${gestor ? ` | ${st[p.id]?.stock ?? 0} | ${st[p.id]?.precio_medio ?? "-"}` : ""}`)}

=== CAMPAÑAS EN CURSO (una por cultivo) ===
${lista(camp.data || [], (c) => `${c.cultivos?.nombre || "General"}: ${c.nombre} (${c.fecha_inicio} a ${c.fecha_fin})`)}

=== PARTES ÚLTIMOS 12 MESES (fecha | labor | parcelas | horas | estado${gestor ? " | coste €" : ""} | productos) ===
${lista(partes.data || [], (p) => `${p.fecha} | ${nomLab[p.labor_id] || "-"} | ${(p.partes_trabajo_recintos || []).map((x) => nomRec[x.recinto_id]).join(", ")} | ${p.horas_totales ?? "-"} | ${p.estado}${gestor ? ` | ${costes[p.id] ?? "-"}` : ""} | ${([].concat(p.aplicaciones || [])[0]?.aplicaciones_productos || []).map((x) => `${nomPro[x.producto_id]} ${x.dosis_ha ?? ""}/ha (${x.cantidad_total ?? "?"})`).join("; ")}`)}
${gestor ? `\n=== COMPRAS ÚLTIMOS 12 MESES (fecha | proveedor | total € | líneas) ===\n${lista(compras.data || [], (c) => `${c.fecha} | ${c.proveedores?.nombre || "-"} | ${c.total ?? "-"} | ${(c.albaranes_compra_lineas || []).map((l) => `${l.descripcion} ${l.cantidad ?? ""}${l.unidad ?? ""} ${l.importe ?? ""}€`).join("; ")}`)}` : ""}`;

    // La API exige empezar por "user" y alternar turnos: se fusionan los consecutivos
    const mensajes = [];
    for (const m of [
      ...historial.slice(-6).filter((h) => h?.texto).map((h) => ({ role: h.rol === "usuario" ? "user" : "assistant", content: String(h.texto) })),
      { role: "user", content: mensaje },
    ]) {
      if (!mensajes.length && m.role !== "user") continue;
      const ult = mensajes[mensajes.length - 1];
      if (ult && ult.role === m.role) ult.content += "\n" + m.content;
      else mensajes.push(m);
    }

    const { datos, texto } = await pedirConHerramienta({ system: sistema, messages: mensajes, herramienta: HERRAMIENTA, max_tokens: 2000 });
    const out =
      datos && datos.tipo
        ? datos
        : texto
        ? { tipo: "consulta", mensaje: texto }
        : { tipo: "no_entendido", mensaje: "No te he entendido bien. ¿Me lo dices de otra forma?" };

    // ---- Validación: descartar cualquier ID que no exista en sus datos ----
    const ok = (ids, arr) => (ids || []).filter((id) => arr.some((x) => x.id === id));
    if (out.parte) {
      out.parte.labor_id = (lab.data || []).some((l) => l.id === out.parte.labor_id) ? out.parte.labor_id : null;
      out.parte.recinto_ids = ok(out.parte.recinto_ids, recintos);
      out.parte.maquinaria_ids = ok(out.parte.maquinaria_ids, maq.data || []);
      out.parte.apero_ids = ok(out.parte.apero_ids, ape.data || []);
      out.parte.trabajador_ids = ok(out.parte.trabajador_ids, tra.data || []);
    }
    if (out.aplicacion?.productos) out.aplicacion.productos = out.aplicacion.productos.filter((p) => (pro.data || []).some((x) => x.id === p.producto_id));
    if (out.observacion?.recinto_id && !recintos.some((x) => x.id === out.observacion.recinto_id)) out.observacion.recinto_id = null;

    const { data: accion } = await supabase
      .from("acciones_ia")
      .insert({
        empresa_id,
        usuario_id: user.id,
        canal: canal === "voz" ? "voz" : "texto",
        entrada: mensaje,
        propuesta: out,
        estado: out.tipo === "consulta" || out.tipo === "no_entendido" ? "respuesta" : "propuesta",
        modelo: MODELO,
      })
      .select("id")
      .single();

    return Response.json({ ...out, accion_id: accion?.id || null });
  } catch (e) {
    return respuestaError(e);
  }
}
