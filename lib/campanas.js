"use client";
import { supabase } from "./supabase";

/**
 * Asigna (o quita) el cultivo de un recinto en su campaña actual.
 * Cada cultivo tiene su propia campaña; si no existe, se crea con fechas por defecto
 * (olivar 1 oct – 30 sep; resto, año natural), editables en Ajustes.
 */
export async function asignarCultivo({ empresaId, recintoId, cultivoId, superficie = null, variedad = null, campanasActivas = [] }) {
  const ids = campanasActivas.map((c) => c.id);
  if (ids.length) {
    const { error } = await supabase.from("recinto_cultivos").delete().eq("recinto_id", recintoId).in("campana_id", ids);
    if (error) throw error;
  }
  if (!cultivoId) return;
  const { data: campanaId, error: e1 } = await supabase.rpc("asegurar_campana", { p_empresa: empresaId, p_cultivo: cultivoId });
  if (e1) throw e1;
  await supabase.from("recinto_cultivos").delete().eq("recinto_id", recintoId).eq("campana_id", campanaId);
  const { error: e2 } = await supabase
    .from("recinto_cultivos")
    .insert({ empresa_id: empresaId, recinto_id: recintoId, cultivo_id: cultivoId, campana_id: campanaId, superficie_ha: superficie, variedad });
  if (e2) throw e2;
}
