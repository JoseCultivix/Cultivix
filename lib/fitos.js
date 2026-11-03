// Comprobación de un tratamiento frente al Registro de Productos Fitosanitarios del MAPA:
// ¿está autorizado en este cultivo (y contra esta plaga)? ¿la dosis entra en el rango?
// ¿qué plazo de seguridad tiene? Es una ayuda: la referencia legal es la etiqueta.
import { supabase } from "@/lib/supabase";

const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

// Unidades de dosis del Registro: por hectárea o por concentración en el caldo
const POR_HA = { "kg/ha": 1, "l/ha": 1, "g/ha": 0.001, "cc/ha": 0.001, "ml/ha": 0.001 };
const POR_HL = { "%": 1, "% (ver nota)": 1, "kg/hl": 1, "l/hl": 1, "g/hl": 0.001, "cc/hl": 0.001, "ml/hl": 0.001 };

const cache = new Map();
/** Usos autorizados de un nº de registro en los cultivos dados (códigos del MAPA). */
export async function usosRegistro(registro, codigos) {
  const cods = [...new Set(codigos.filter(Boolean))].sort();
  if (!registro || !cods.length) return [];
  const k = `${registro}|${cods.join(",")}`;
  if (!cache.has(k)) {
    cache.set(
      k,
      supabase.rpc("fito_usos_para", { p_registro: registro, p_codigos: cods }).then(({ data, error }) => {
        if (error) {
          cache.delete(k);
          throw error;
        }
        return data || [];
      }),
    );
  }
  return cache.get(k);
}

const fichaCache = new Map();
export async function fichaRegistro(registro) {
  if (!registro) return null;
  if (!fichaCache.has(registro)) fichaCache.set(registro, supabase.rpc("fito_producto", { p_registro: registro }).then(({ data }) => data?.[0] || null));
  return fichaCache.get(registro);
}

/**
 * Evalúa un producto en un cultivo.
 * usos: filas de fito_usos_para para ese código de cultivo.
 * dosisHa: dosis aplicada en kg o l de producto por hectárea; caldoHa: litros de caldo por hectárea.
 */
export function evaluar({ usos, ficha, dosisHa, caldoHa, plaga, fecha }) {
  const r = { avisos: [], ok: [] };
  const f = ficha || usos[0];
  if (!f) {
    r.estado = "no_encontrado";
    r.avisos.push("Este nº de registro no aparece en el Registro del MAPA. Revísalo en la etiqueta.");
    return r;
  }
  if (f.estado && f.estado !== "Vigente") r.avisos.push(`En el Registro figura como «${f.estado}».`);
  const hoy = fecha || new Date().toISOString().slice(0, 10);
  if (f.cancelacion && f.cancelacion < hoy) r.avisos.push(`Autorización cancelada desde el ${fechaEs(f.cancelacion)}.`);
  else if (f.caducidad && f.caducidad < hoy) r.avisos.push(`La autorización caducó el ${fechaEs(f.caducidad)}.`);
  if (f.limite_venta && f.limite_venta < hoy) r.avisos.push(`Fecha límite de venta: ${fechaEs(f.limite_venta)}.`);

  let aplicables = usos.filter((u) => u.relacion === "igual" || u.relacion === "superior");
  if (!aplicables.length) {
    const parciales = usos.filter((u) => u.relacion === "inferior");
    if (!parciales.length) {
      r.estado = "no_autorizado";
      r.avisos.unshift("No está autorizado en este cultivo.");
      return r;
    }
    r.parcial = [...new Set(parciales.map((u) => u.cultivo_uso))];
    r.avisos.unshift(`Solo autorizado en: ${r.parcial.join(", ")}.`);
    aplicables = parciales;
  }
  r.estado = r.parcial ? "parcial" : "autorizado";
  r.plagas = [...new Set(aplicables.map((u) => u.agente))];

  if (plaga && plaga.trim().length > 2) {
    const palabras = norm(plaga).split(/[^a-z0-9]+/).filter((w) => w.length > 3);
    const contra = aplicables.filter((u) => palabras.some((w) => norm(u.agente).includes(w)));
    if (contra.length) aplicables = contra;
    else r.avisos.push(`No consta autorizado contra «${plaga}». Sí contra: ${r.plagas.slice(0, 4).join("; ")}${r.plagas.length > 4 ? "…" : ""}.`);
  }

  // Plazo de seguridad: el más largo de los usos que aplican (criterio prudente)
  const dias = aplicables.map((u) => u.plazo_dias).filter((x) => x != null);
  r.plazoDias = dias.length ? Math.max(...dias) : null;
  if (!dias.length && aplicables.some((u) => /no procede/i.test(u.plazo || ""))) r.plazoTexto = "No procede";
  const apl = [...new Set(aplicables.map((u) => u.aplicaciones).filter(Boolean))];
  r.aplicaciones = apl.join(" / ");

  // Dosis
  const ha = aplicables.filter((u) => POR_HA[norm(u.unidad)] != null && (u.dosis_min != null || u.dosis_max != null));
  const hl = aplicables.filter((u) => POR_HL[norm(u.unidad)] != null && (u.dosis_min != null || u.dosis_max != null));
  const rango = (arr, tabla) => {
    const mins = arr.map((u) => (u.dosis_min ?? u.dosis_max) * tabla[norm(u.unidad)]);
    const maxs = arr.map((u) => (u.dosis_max ?? u.dosis_min) * tabla[norm(u.unidad)]);
    return [Math.min(...mins), Math.max(...maxs)];
  };
  const d = Number(dosisHa);
  if (ha.length) {
    const [mn, mx] = rango(ha, POR_HA);
    r.dosisTexto = `${redondo(mn)}–${redondo(mx)} por ha`;
    if (d > 0) r.dosis = d > mx * 1.001 ? "alta" : d < mn * 0.999 ? "baja" : "ok";
  } else if (hl.length) {
    const [mn, mx] = rango(hl, POR_HL);
    r.dosisTexto = `${redondo(mn)}–${redondo(mx)} por 100 l de caldo`;
    const c = Number(caldoHa);
    if (d > 0 && c > 0) {
      const conc = d / (c / 100);
      r.concentracion = conc;
      r.dosis = conc > mx * 1.001 ? "alta" : conc < mn * 0.999 ? "baja" : "ok";
    } else if (d > 0) r.dosis = "falta_caldo";
  } else if (aplicables.length) {
    r.dosisTexto = "ver etiqueta";
  }
  if (r.dosis === "alta") r.avisos.push(`Dosis por encima de la autorizada (${r.dosisTexto}).`);
  if (r.dosis === "baja") r.ok.push(`Dosis por debajo de la mínima de etiqueta (${r.dosisTexto}).`);
  return r;
}

export const redondo = (x) => (x == null || !isFinite(x) ? "?" : Number(x.toFixed(x < 1 ? 3 : 2)).toLocaleString("es-ES"));
const fechaEs = (f) => (f ? new Date(f + "T12:00:00").toLocaleDateString("es-ES") : "");
