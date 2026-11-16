import { supabase } from "@/lib/supabase";

/** Borra una fila y comprueba que de verdad se ha borrado (si los permisos no lo dejan, Supabase no da error: devuelve 0 filas). */
export async function eliminarRegistro(tabla, id) {
  const { data, error } = await supabase.from(tabla).delete().eq("id", id).select("id");
  if (error) throw error;
  if (!data?.length) throw new Error("No tienes permiso para eliminar este registro.");
}

/** Lanza un error «en uso» si alguna de las consultas devuelve filas. */
export async function comprobarSinUso(consultas, mensaje) {
  for (const [tabla, columna, id] of consultas) {
    const { count } = await supabase.from(tabla).select("id", { count: "exact", head: true }).eq(columna, id);
    if (count) {
      const e = new Error(mensaje);
      e.enUso = mensaje;
      throw e;
    }
  }
}
