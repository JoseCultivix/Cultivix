// Tipos de compra/gasto y reparto de costes de las compras.

// almacen: va al stock y su coste llega a la parcela al aplicarlo en un parte (no se imputa al comprar).
// destino: a qué se imputa por defecto un gasto directo.
export const CATEGORIAS = [
  { v: "fitosanitario", t: "Fitosanitario", icono: "🧴", almacen: true },
  { v: "herbicida", t: "Herbicida", icono: "🌿", almacen: true },
  { v: "fertilizante", t: "Fertilizante / abono", icono: "🌾", almacen: true },
  { v: "bioestimulante", t: "Bioestimulante / corrector", icono: "🧪", almacen: true },
  { v: "semilla", t: "Semillas y plantones", icono: "🌱", almacen: true },
  { v: "gasoil", t: "Gasoil y combustible", icono: "⛽", destino: "equipo" },
  { v: "repuesto", t: "Repuestos y lubricantes", icono: "🔩", destino: "equipo" },
  { v: "reparacion", t: "Reparación / taller", icono: "🔧", destino: "equipo" },
  { v: "material", t: "Materiales (riego, postes, mallas…)", icono: "📦", destino: "tierra" },
  { v: "servicio", t: "Servicios de terceros (maquila, poda, análisis…)", icono: "🤝", destino: "tierra" },
  { v: "energia", t: "Luz y agua", icono: "💡", destino: "tierra" },
  { v: "seguro", t: "Seguros", icono: "🛡️", destino: "general" },
  { v: "otro", t: "Otros gastos", icono: "🧾", destino: "general" },
];
export const categoria = (v) => CATEGORIAS.find((c) => c.v === v) || CATEGORIAS[CATEGORIAS.length - 1];
export const esAlmacen = (v) => !!categoria(v).almacen;
export const TIPOS_DOCUMENTO = [
  { value: "albaran", label: "Albarán" },
  { value: "factura", label: "Factura" },
  { value: "ticket", label: "Ticket" },
];

/**
 * Reparte el importe de una línea entre recintos, máquinas, aperos y gasto general.
 * imputaciones: [{ tipo: "recinto"|"finca"|"maquinaria"|"apero"|"general", id, porcentaje }]
 * recintos: los de la app (con superficie_sigpac_ha y parcelas.finca_id).
 * Reglas: con porcentajes, cada destino recibe su %; sin ellos, a partes iguales entre «tierra», «equipos» y
 * «general»; dentro de la tierra (recintos y fincas) por hectáreas; entre equipos a partes iguales.
 */
export function repartirLinea(importe, imputaciones, recintos) {
  const out = { recintos: {}, maquinas: {}, aperos: {}, general: 0 };
  const total = Number(importe) || 0;
  if (!total) return out;
  const imps = imputaciones || [];
  if (!imps.length) {
    out.general = total;
    return out;
  }
  const ha = (r) => Number(r.superficie_sigpac_ha) || 0;
  const recintosDe = (i) => (i.tipo === "recinto" ? recintos.filter((r) => r.id === i.id) : recintos.filter((r) => (r.parcelas?.finca_id || r.finca_id) === i.id));
  const aTierra = (lista, euros) => {
    const rs = [...new Map(lista.flatMap(recintosDe).map((r) => [r.id, r])).values()];
    if (!rs.length) return (out.general += euros);
    const suma = rs.reduce((s, r) => s + ha(r), 0);
    for (const r of rs) out.recintos[r.id] = (out.recintos[r.id] || 0) + (suma > 0 ? (euros * ha(r)) / suma : euros / rs.length);
  };
  const aEquipo = (i, euros) => {
    const k = i.tipo === "apero" ? "aperos" : "maquinas";
    out[k][i.id] = (out[k][i.id] || 0) + euros;
  };
  const conPct = imps.some((i) => Number(i.porcentaje) > 0);
  if (conPct) {
    let asignado = 0;
    for (const i of imps) {
      const e = (total * (Number(i.porcentaje) || 0)) / 100;
      asignado += e;
      if (i.tipo === "recinto" || i.tipo === "finca") aTierra([i], e);
      else if (i.tipo === "general") out.general += e;
      else aEquipo(i, e);
    }
    if (Math.abs(total - asignado) > 0.005) out.general += total - asignado; // lo que no suma 100 % queda como general
    return out;
  }
  const tierra = imps.filter((i) => i.tipo === "recinto" || i.tipo === "finca");
  const equipos = imps.filter((i) => i.tipo === "maquinaria" || i.tipo === "apero");
  const general = imps.some((i) => i.tipo === "general");
  const grupos = (tierra.length ? 1 : 0) + (equipos.length ? 1 : 0) + (general ? 1 : 0);
  const parte = total / grupos;
  if (tierra.length) aTierra(tierra, parte);
  for (const i of equipos) aEquipo(i, parte / equipos.length);
  if (general) out.general += parte;
  return out;
}

/** Imputaciones guardadas (filas de compras_imputaciones) → formato del editor. */
export function desdeFilas(filas) {
  return (filas || []).map((f) => ({
    tipo: f.recinto_id ? "recinto" : f.finca_id ? "finca" : f.maquinaria_id ? "maquinaria" : f.apero_id ? "apero" : "general",
    id: f.recinto_id || f.finca_id || f.maquinaria_id || f.apero_id || null,
    porcentaje: f.porcentaje ?? "",
  }));
}
