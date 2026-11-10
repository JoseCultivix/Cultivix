// Carga rápida de parcelas desde la declaración de la PAC (PDF de la solicitud única o fotos de sus hojas).
// 1) La IA lee SOLO la tabla de recintos declarados (referencia SIGPAC, superficie, producto).
// 2) Cada referencia se comprueba contra SIGPAC (superficie oficial, uso, geometría).
// Los archivos se borran del almacenamiento al terminar: no se guarda la solicitud.
import { clienteDelUsuario, comprobarLimiteIA, MODELO, pedirConHerramienta, respuestaError, rolEnEmpresa } from "@/lib/servidor";
import { porParcela } from "@/lib/sigpac";

export const maxDuration = 180;

const HERRAMIENTA = {
  name: "recintos_declarados",
  description: "Recintos SIGPAC declarados en la solicitud de ayudas PAC.",
  input_schema: {
    type: "object",
    properties: {
      campana: { type: "integer", description: "Año de la campaña de la solicitud, si aparece" },
      recintos: {
        type: "array",
        description: "Una entrada por línea de declaración (recinto). Si un recinto aparece en varias líneas con distintos productos, una entrada por línea.",
        items: {
          type: "object",
          properties: {
            provincia: { type: "integer" },
            municipio: { type: "integer" },
            agregado: { type: "integer", description: "0 si no aparece" },
            zona: { type: "integer", description: "0 si no aparece" },
            poligono: { type: "integer" },
            parcela: { type: "integer" },
            recinto: { type: "integer" },
            superficie_ha: { type: "number", description: "Superficie declarada en hectáreas (convierte áreas o m² si hace falta)" },
            producto: { type: "string", description: "Producto/cultivo declarado tal como aparece (ej. OLIVAR, PISTACHO, TRIGO DURO)" },
            regadio: { type: "boolean", description: "true si se declara en regadío" },
          },
          required: ["provincia", "municipio", "poligono", "parcela", "recinto"],
        },
      },
      notas: { type: "string", description: "Dudas: números ilegibles, páginas cortadas, etc." },
    },
    required: ["recintos"],
  },
};

const SISTEMA = `Lees solicitudes únicas de ayudas de la PAC de España (de cualquier comunidad autónoma) y extraes SOLO la tabla de la declaración de parcelas/recintos (declaración gráfica / relación de recintos / líneas de declaración).
Reglas:
- Cada línea tiene la referencia SIGPAC: provincia, municipio, agregado, zona, polígono, parcela y recinto. A veces viene junta (ej. "23:050:0:0:14:77:1" o "23-50-0-0-14-77-1"): sepárala.
- Superficie en hectáreas con decimales (si viene en áreas o m², conviértela).
- Copia el producto o cultivo declarado tal cual.
- No incluyas datos personales (nombre, NIF, cuenta bancaria, dirección): no los necesitas.
- No inventes números. Si un número no se lee bien, omite esa línea y dilo en "notas".`;

const clave = (r) => [r.provincia, r.municipio, r.agregado ?? 0, r.zona ?? 0, r.poligono, r.parcela].join("-");

export async function POST(req) {
  const rutasABorrar = [];
  let sb = null;
  try {
    const { supabase, user } = await clienteDelUsuario(req);
    sb = supabase;
    const { empresa_id, rutas } = await req.json();
    const rol = await rolEnEmpresa(supabase, user.id, empresa_id);
    if (!["propietario", "administrador", "encargado"].includes(rol)) return Response.json({ error: "Solo el titular o el encargado carga parcelas" }, { status: 403 });
    if (!Array.isArray(rutas) || !rutas.length) return Response.json({ error: "Falta el documento" }, { status: 400 });
    if (rutas.length > 12) return Response.json({ error: "Como máximo 12 archivos a la vez" }, { status: 400 });
    for (const r of rutas) {
      if (typeof r !== "string" || !r.startsWith(`${empresa_id}/pac_tmp/`)) return Response.json({ error: "Archivo no válido" }, { status: 400 });
      rutasABorrar.push(r);
    }
    await comprobarLimiteIA(supabase);

    // Descargar los archivos (con los permisos del usuario)
    const bloques = [];
    let total = 0;
    for (const r of rutas) {
      const { data, error } = await supabase.storage.from("documentos").download(r);
      if (error) throw new Error("No se pudo leer el archivo subido");
      const buf = Buffer.from(await data.arrayBuffer());
      total += buf.length;
      if (total > 25 * 1024 * 1024) throw new Error("Los archivos pesan demasiado (máx. 25 MB en total)");
      const esPdf = r.endsWith(".pdf");
      bloques.push(
        esPdf
          ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: buf.toString("base64") } }
          : { type: "image", source: { type: "base64", media_type: "image/jpeg", data: buf.toString("base64") } }
      );
    }

    const { datos } = await pedirConHerramienta({
      max_tokens: 16000,
      system: SISTEMA,
      herramienta: HERRAMIENTA,
      messages: [{ role: "user", content: [...bloques, { type: "text", text: "Extrae todos los recintos declarados." }] }],
    });
    const declarados = (datos?.recintos || [])
      .filter((r) => [r.provincia, r.municipio, r.poligono, r.parcela, r.recinto].every((x) => Number.isFinite(Number(x))))
      .map((r) => ({ ...r, agregado: Number(r.agregado) || 0, zona: Number(r.zona) || 0 }));

    // Comprobar cada parcela en SIGPAC (4 a la vez)
    const parcelas = [...new Map(declarados.map((r) => [clave(r), r])).values()];
    const sigpac = {};
    let i = 0;
    async function trabajador() {
      while (i < parcelas.length) {
        const p = parcelas[i++];
        try {
          sigpac[clave(p)] = await porParcela(p);
        } catch {
          sigpac[clave(p)] = null;
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, parcelas.length) }, trabajador));

    const recintos = declarados.map((d) => {
      const lista = sigpac[clave(d)];
      const s = lista?.find((x) => x.recinto === Number(d.recinto)) || null;
      let estado = "ok";
      if (lista === null) estado = "sin_conexion";
      else if (!s) estado = "no_encontrado";
      else if (d.superficie_ha && s.superficie && Math.abs(d.superficie_ha - s.superficie) > Math.max(0.05, s.superficie * 0.1)) estado = "superficie_distinta";
      return { declarado: d, sigpac: s, estado };
    });

    await supabase.from("acciones_ia").insert({
      empresa_id,
      usuario_id: user.id,
      canal: "documento",
      entrada: "declaración PAC",
      propuesta: { recintos: recintos.length, parcelas: parcelas.length, no_encontrados: recintos.filter((r) => r.estado === "no_encontrado").length },
      estado: "propuesta",
      modelo: MODELO,
    });
    return Response.json({ campana: datos?.campana || null, recintos, notas: datos?.notas || null });
  } catch (e) {
    return respuestaError(e);
  } finally {
    // No guardamos la solicitud: contiene datos personales
    if (sb && rutasABorrar.length) await sb.storage.from("documentos").remove(rutasABorrar).catch(() => {});
  }
}
