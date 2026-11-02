// Lectura de albaranes/facturas/tickets con IA (OCR + interpretación).
// Devuelve una propuesta; el usuario la revisa antes de guardar (FLUJO-021/022/027).
import { claude, clienteDelUsuario, entradaHerramienta, MODELO, respuestaError, rolEnEmpresa } from "@/lib/servidor";

export const maxDuration = 60;

const HERRAMIENTA = {
  name: "documento_compra",
  description: "Datos extraídos del documento de compra agrícola.",
  input_schema: {
    type: "object",
    properties: {
      tipo_documento: { type: "string", enum: ["albaran", "factura", "ticket", "otro"] },
      proveedor_nombre: { type: "string" },
      proveedor_nif: { type: "string" },
      numero: { type: "string" },
      fecha: { type: "string", description: "YYYY-MM-DD" },
      base_imponible: { type: "number" },
      iva: { type: "number", description: "Importe total de IVA en euros" },
      total: { type: "number" },
      lineas: {
        type: "array",
        items: {
          type: "object",
          properties: {
            descripcion: { type: "string", description: "Texto de la línea tal cual" },
            producto_id: { type: "string", description: "ID de un producto existente del catálogo si es el mismo producto; si no, vacío" },
            producto_nombre: { type: "string", description: "Nombre comercial limpio del producto (sin formato de envase)" },
            tipo: { type: "string", enum: ["fitosanitario", "fertilizante", "herbicida", "bioestimulante", "semilla", "gasoil", "otro"] },
            cantidad: { type: "number", description: "Cantidad TOTAL en la unidad indicada (ej. 2 sacos de 25 kg = 50 kg)" },
            unidad: { type: "string", enum: ["kg", "l", "ud", "t", "g", "ml"] },
            precio_unitario: { type: "number", description: "Precio por unidad (kg, l…) sin IVA" },
            importe: { type: "number", description: "Importe de la línea sin IVA" },
          },
          required: ["descripcion"],
        },
      },
      notas: { type: "string", description: "Cualquier cosa dudosa o ilegible" },
    },
    required: ["tipo_documento", "lineas"],
  },
};

const HERRAMIENTA_COSECHA = {
  name: "ticket_cosecha",
  description: "Datos de un ticket o albarán de entrega de cosecha (almazara, cooperativa, comprador).",
  input_schema: {
    type: "object",
    properties: {
      destino_nombre: { type: "string", description: "Empresa que recibe la cosecha (almazara, cooperativa…)" },
      fecha: { type: "string", description: "YYYY-MM-DD" },
      numero_ticket: { type: "string" },
      cultivo: { type: "string", description: "aceituna/olivar, pistacho, almendra…" },
      calidad: { type: "string", description: "Vuelo, Suelo, Extra, Primera… tal como aparezca" },
      kilos_brutos: { type: "number" },
      kilos_netos: { type: "number", description: "Kilos netos liquidables" },
      rendimiento_pct: { type: "number", description: "Rendimiento graso % (aceituna)" },
      humedad_pct: { type: "number" },
      impurezas_pct: { type: "number", description: "Tierra/hojas/impurezas %" },
      acidez: { type: "number" },
      notas: { type: "string" },
    },
    required: ["kilos_netos"],
  },
};

export async function POST(req) {
  try {
    const { supabase, user } = await clienteDelUsuario(req);
    const { empresa_id, base64, media_type, tipo } = await req.json();
    const rol = await rolEnEmpresa(supabase, user.id, empresa_id);
    if (!base64) return Response.json({ error: "Falta la imagen" }, { status: 400 });

    if (tipo === "cosecha") {
      const r = await claude().messages.create({
        model: MODELO,
        max_tokens: 1500,
        system: "Lees tickets de entrega de cosecha de agricultores españoles (básculas de almazaras, cooperativas, compradores). Extrae los datos con precisión. Si un dato no aparece, déjalo vacío. No inventes cifras.",
        tools: [HERRAMIENTA_COSECHA],
        tool_choice: { type: "tool", name: "ticket_cosecha" },
        messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: media_type || "image/jpeg", data: base64 } }, { type: "text", text: "Extrae los datos de este ticket." }] }],
      });
      const out = entradaHerramienta(r) || {};
      await supabase.from("acciones_ia").insert({ empresa_id, usuario_id: user.id, canal: "documento", entrada: "ticket cosecha", propuesta: out, estado: "propuesta", modelo: MODELO });
      return Response.json(out);
    }

    if (!["propietario", "administrador", "encargado"].includes(rol)) return Response.json({ error: "Solo el titular o encargado registra compras" }, { status: 403 });

    const { data: productos } = await supabase.from("productos").select("id,nombre,tipo,unidad").eq("empresa_id", empresa_id);
    const { data: proveedores } = await supabase.from("proveedores").select("nombre,nif").eq("empresa_id", empresa_id);

    const bloque =
      media_type === "application/pdf"
        ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } }
        : { type: "image", source: { type: "base64", media_type: media_type || "image/jpeg", data: base64 } };

    const r = await claude().messages.create({
      model: MODELO,
      max_tokens: 3000,
      system: `Lees documentos de compra de agricultores españoles (albaranes de cooperativas, almacenes de fitosanitarios, gasolineras…).
Extrae los datos con precisión. Reglas:
- Convierte envases a cantidad total en kg o l (ej. "4 x 5 L" = 20 l; "2 sacos 25 kg" = 50 kg).
- Si el producto coincide claramente con uno del catálogo, pon su producto_id. No inventes IDs.
- Gasóleo agrícola: tipo "gasoil", unidad "l".
- Si un dato no se lee, déjalo vacío y explícalo en "notas". No adivines importes.
Catálogo de productos del agricultor (id | nombre | tipo | unidad):
${(productos || []).map((p) => `${p.id} | ${p.nombre} | ${p.tipo} | ${p.unidad}`).join("\n") || "(vacío)"}
Proveedores conocidos: ${(proveedores || []).map((p) => p.nombre).join(", ") || "(ninguno)"}`,
      tools: [HERRAMIENTA],
      tool_choice: { type: "tool", name: "documento_compra" },
      messages: [{ role: "user", content: [bloque, { type: "text", text: "Extrae los datos de este documento." }] }],
    });

    const out = entradaHerramienta(r) || { tipo_documento: "otro", lineas: [] };
    out.lineas = (out.lineas || []).map((l) => ({
      ...l,
      producto_id: (productos || []).some((p) => p.id === l.producto_id) ? l.producto_id : null,
    }));

    await supabase.from("acciones_ia").insert({ empresa_id, usuario_id: user.id, canal: "documento", entrada: "escaneo documento", propuesta: out, estado: "propuesta", modelo: MODELO });
    return Response.json(out);
  } catch (e) {
    return respuestaError(e);
  }
}
