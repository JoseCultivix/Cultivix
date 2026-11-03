// Prepara el cuaderno de explotación con la estructura del modelo oficial
// (información general, parcelas, tratamientos fitosanitarios, fertilización
// y cosecha comercializada) a partir de los datos de Cultivix.
import { supabase } from "@/lib/supabase";
import { METODOS, CARNES } from "@/lib/ccaa";

const nombreT = (t) => `${t.nombre}${t.apellidos ? " " + t.apellidos : ""}`;
const refOk = (r) => r && !String(r).includes("?");

export async function cargarCuadernoOficial({ empresaId, desde, hasta }) {
  const [emp, trab, maq, ase, rc, trat, cos, planes, bal] = await Promise.all([
    supabase.from("empresas").select("*").eq("id", empresaId).single(),
    supabase.from("trabajadores").select("*").eq("empresa_id", empresaId),
    supabase.from("maquinaria").select("*").eq("empresa_id", empresaId),
    supabase.from("asesores").select("*").eq("empresa_id", empresaId).eq("activo", true),
    supabase
      .from("recinto_cultivos")
      .select("*, cultivos(nombre), campanas(nombre, fecha_inicio, fecha_fin), recintos(*, parcelas(nombre))")
      .eq("empresa_id", empresaId)
      .eq("activo", true),
    supabase.from("v_cuaderno_campo").select("*").eq("empresa_id", empresaId).gte("fecha", desde).lte("fecha", hasta).order("fecha"),
    supabase.from("v_cuaderno_cosecha").select("*").eq("empresa_id", empresaId).gte("fecha", desde).lte("fecha", hasta).order("fecha"),
    supabase.from("planes_abonado").select("*, campanas(nombre, fecha_inicio, fecha_fin), recintos(referencia_sigpac, parcelas(nombre)), asesores(nombre, numero_ropo)").eq("empresa_id", empresaId),
    supabase.from("v_fertilizacion_recintos").select("*").eq("empresa_id", empresaId),
  ]);
  for (const r of [emp, trab, maq, ase, rc, trat, cos, planes, bal]) if (r.error) throw r.error;

  const solapa = (c) => c && c.fecha_inicio <= hasta && c.fecha_fin >= desde;

  // 2. Parcelas: recintos con cultivo en una campaña que toca el periodo
  const vistos = new Map();
  for (const x of (rc.data || []).filter((x) => solapa(x.campanas) && x.recintos?.activo !== false)) {
    const r = x.recintos;
    const prev = vistos.get(r.id);
    const cultivo = x.cultivos?.nombre;
    if (prev) {
      if (cultivo && !prev.cultivo.includes(cultivo)) prev.cultivo += `, ${cultivo}`;
      continue;
    }
    vistos.set(r.id, {
      recinto_id: r.id,
      parcela: r.parcelas?.nombre,
      provincia: r.provincia_sigpac,
      municipio: r.municipio_sigpac,
      agregado: r.agregado_sigpac,
      zona: r.zona_sigpac,
      poligono: r.poligono_sigpac,
      parcela_sigpac: r.parcela_sigpac,
      recinto: r.recinto_sigpac,
      referencia: refOk(r.referencia_sigpac) ? r.referencia_sigpac : "",
      uso: r.uso_sigpac || "",
      superficie_sigpac: r.superficie_sigpac_ha,
      superficie_cultivada: x.superficie_ha ?? r.superficie_sigpac_ha,
      cultivo: cultivo || "",
      variedad: x.variedad || "",
      regadio: x.regadio ? "Regadío" : "Secano",
      zona_vulnerable: r.zona_vulnerable ? "Sí" : "No",
    });
  }
  // Recintos que aparecen en tratamientos aunque no tengan cultivo asignado
  for (const t of trat.data || [])
    if (!vistos.has(t.recinto_id))
      vistos.set(t.recinto_id, { recinto_id: t.recinto_id, parcela: t.parcela, referencia: refOk(t.referencia_sigpac) ? t.referencia_sigpac : "", superficie_sigpac: t.superficie_sigpac_ha, superficie_cultivada: t.superficie_sigpac_ha, cultivo: t.cultivo || "", variedad: "", regadio: "", zona_vulnerable: "", uso: "" });
  const parcelas = [...vistos.values()].sort((a, b) => (a.parcela || "").localeCompare(b.parcela || "") || String(a.referencia).localeCompare(String(b.referencia)));
  parcelas.forEach((p, i) => (p.orden = i + 1));
  const ordenDe = new Map(parcelas.map((p) => [p.recinto_id, p.orden]));

  // 1. Personas y equipos que intervienen
  const filas = trat.data || [];
  const nombresAplic = new Set(filas.flatMap((f) => String(f.aplicador || "").split(", ").filter(Boolean)));
  const nombresEq = new Set(filas.flatMap((f) => String(f.maquinaria || "").split(", ").filter(Boolean)));
  const personas = (trab.data || [])
    .filter((t) => nombresAplic.has(nombreT(t)) || (t.numero_ropo && t.activo))
    .map((t, i) => ({ orden: i + 1, nombre: nombreT(t), nif: t.dni || "", ropo: t.numero_ropo || "", carne: CARNES[t.tipo_carne] || "" }));
  const equipos = (maq.data || [])
    .filter((m) => nombresEq.has(m.nombre) || (m.numero_roma && m.activa))
    .map((m, i) => ({ orden: i + 1, nombre: [m.nombre, m.marca, m.modelo].filter(Boolean).join(" "), roma: m.numero_roma || "", inspeccion: m.fecha_ultima_inspeccion || "" }));
  const ordenPersona = new Map(personas.map((p) => [p.nombre, p.orden]));
  const ordenEquipo = new Map((maq.data || []).map((m) => [m.nombre, equipos.find((e) => e.nombre.startsWith(m.nombre))?.orden]));

  // Agrupa por parte + producto (un tratamiento puede abarcar varios recintos)
  function agrupar(lista) {
    const g = new Map();
    for (const f of lista) {
      const k = `${f.parte_trabajo_id}|${f.producto_id}`;
      const a = g.get(k) || { ...f, recintos: [], superficie: 0, cantidad: 0, cultivos: new Set() };
      a.recintos.push(ordenDe.get(f.recinto_id));
      a.superficie += Number(f.superficie_trabajada_ha ?? f.superficie_sigpac_ha ?? 0);
      a.cantidad += Number(f.cantidad_recinto || 0);
      if (f.cultivo) a.cultivos.add(f.cultivo);
      g.set(k, a);
    }
    return [...g.values()].map((a) => ({
      ...a,
      parcelas_orden: a.recintos.filter(Boolean).sort((x, y) => x - y).join(", "),
      cultivo: [...a.cultivos].join(", "),
      aplicador_orden: String(a.aplicador || "").split(", ").map((n) => ordenPersona.get(n)).filter(Boolean).join(", "),
      equipo_orden: String(a.maquinaria || "").split(", ").map((n) => ordenEquipo.get(n)).filter(Boolean).join(", "),
      metodo: METODOS[a.metodo_aplicacion] || "",
    }));
  }
  const esFert = (f) => f.tipo_aplicacion === "fertilizacion" || f.tipo_producto === "fertilizante";
  const tratamientos = agrupar(filas.filter((f) => !esFert(f)));
  const fertilizacion = agrupar(filas.filter(esFert)).map((f) => {
    const dosis = Number(f.dosis_ha ?? (f.superficie ? f.cantidad / f.superficie : 0));
    const kg = f.unidad_producto === "t" ? dosis * 1000 : dosis;
    return {
      ...f,
      riqueza: f.riqueza_n != null || f.riqueza_p2o5 != null || f.riqueza_k2o != null ? `${f.riqueza_n ?? 0}-${f.riqueza_p2o5 ?? 0}-${f.riqueza_k2o ?? 0}` : "",
      n_ha: f.riqueza_n != null ? (kg * f.riqueza_n) / 100 : null,
      p_ha: f.riqueza_p2o5 != null ? (kg * f.riqueza_p2o5) / 100 : null,
      k_ha: f.riqueza_k2o != null ? (kg * f.riqueza_k2o) / 100 : null,
    };
  });

  const cosecha = [];
  const gc = new Map();
  for (const c of cos.data || []) {
    const a = gc.get(c.entrega_id) || { ...c, parcelas: new Set() };
    const o = parcelas.find((p) => p.referencia && p.referencia === c.referencia_sigpac)?.orden;
    if (o) a.parcelas.add(o);
    gc.set(c.entrega_id, a);
  }
  for (const a of gc.values()) cosecha.push({ ...a, parcelas_orden: [...a.parcelas].sort((x, y) => x - y).join(", ") });

  const planesPeriodo = (planes.data || []).filter((p) => solapa(p.campanas));
  const balance = (bal.data || []).filter((b) => planesPeriodo.some((p) => p.campana_id === b.campana_id) || fertilizacion.some((f) => f.campana_id === b.campana_id));

  // Comprobaciones de lo que falta para una inspección
  const avisos = [];
  const e = emp.data;
  if (!e.nif) avisos.push({ texto: "Falta el NIF del titular", enlace: "/ajustes" });
  if (!e.comunidad_autonoma) avisos.push({ texto: "Indica tu comunidad autónoma", enlace: "/ajustes" });
  if (!e.codigo_rea) avisos.push({ texto: "Falta el código REA / SIEX de la explotación", enlace: "/ajustes" });
  const sinReg = [...new Set(tratamientos.filter((t) => !t.numero_registro).map((t) => t.producto))];
  if (sinReg.length) avisos.push({ texto: `Falta el nº de registro de: ${sinReg.join(", ")}`, enlace: "/productos" });
  const sinRiq = [...new Set(fertilizacion.filter((t) => !t.riqueza).map((t) => t.producto))];
  if (sinRiq.length) avisos.push({ texto: `Falta la riqueza N-P-K de: ${sinRiq.join(", ")}`, enlace: "/productos" });
  const sinRopo = personas.filter((p) => !p.ropo).map((p) => p.nombre);
  if (tratamientos.length && sinRopo.length) avisos.push({ texto: `Falta el nº ROPO de: ${sinRopo.join(", ")}`, enlace: "/ajustes" });
  const sinRoma = equipos.filter((x) => !x.roma).map((x) => x.nombre);
  if (tratamientos.length && sinRoma.length) avisos.push({ texto: `Falta el nº ROMA de: ${sinRoma.join(", ")}`, enlace: "/maquinaria" });
  if (tratamientos.some((t) => !t.plaga_o_motivo)) avisos.push({ texto: "Hay tratamientos sin plaga o motivo", enlace: "/partes" });
  if (fertilizacion.length && !planesPeriodo.length) avisos.push({ texto: "No hay plan de abonado para este periodo", enlace: "/fertilizacion" });
  if (filas.some((f) => f.estado === "pendiente")) avisos.push({ texto: "Hay partes sin validar (salen en el cuaderno, conviene revisarlos)", enlace: "/partes" });

  return { empresa: e, personas, equipos, asesores: ase.data || [], parcelas, tratamientos, fertilizacion, cosecha, planes: planesPeriodo, balance, avisos };
}

// ---------------------------------------------------------------------
// Excel con una hoja por apartado del modelo oficial
// ---------------------------------------------------------------------
export async function descargarExcel(d, { ccaa, periodo }) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Cultivix";
  wb.created = new Date();
  const verde = { type: "pattern", pattern: "solid", fgColor: { argb: "FF374624" } };

  function hoja(nombre, titulo, cols, filas) {
    const ws = wb.addWorksheet(nombre, { pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } });
    ws.addRow([titulo]).font = { bold: true, size: 13 };
    ws.addRow([`${d.empresa.nombre} · NIF ${d.empresa.nif || "—"} · REA ${d.empresa.codigo_rea || "—"} · ${ccaa?.nombre || ""} · ${periodo}`]).font = { size: 10, color: { argb: "FF555555" } };
    ws.addRow([]);
    const h = ws.addRow(cols.map((c) => c[1]));
    h.eachCell((c) => {
      c.fill = verde;
      c.font = { bold: true, color: { argb: "FFFFFFFF" } };
      c.alignment = { wrapText: true, vertical: "middle" };
    });
    for (const f of filas) ws.addRow(cols.map(([k, , fmt]) => (fmt ? fmt(f) : f[k] ?? "")));
    cols.forEach((c, i) => (ws.getColumn(i + 1).width = c[3] || 14));
    ws.views = [{ state: "frozen", ySplit: 4 }];
    return ws;
  }
  const fecha = (f) => (f.fecha ? new Date(f.fecha + "T12:00:00") : "");
  const r2 = (x) => (x == null || x === "" ? "" : Math.round(Number(x) * 100) / 100);

  const info = wb.addWorksheet("1 Información general");
  info.addRow(["CUADERNO DE EXPLOTACIÓN AGRÍCOLA"]).font = { bold: true, size: 14 };
  info.addRow([`${ccaa?.nombre || ""} · ${ccaa?.rea || "REA"} · ${periodo}`]);
  info.addRow([]);
  for (const [k, v] of [
    ["Titular", d.empresa.nombre],
    ["NIF", d.empresa.nif],
    ["Dirección", [d.empresa.direccion, d.empresa.codigo_postal, d.empresa.municipio, d.empresa.provincia].filter(Boolean).join(", ")],
    ["Teléfono", d.empresa.telefono],
    ["Código REA / SIEX", d.empresa.codigo_rea],
  ])
    info.addRow([k, v || ""]).getCell(1).font = { bold: true };
  info.addRow([]);
  info.addRow(["1.2 Personas que intervienen en los tratamientos"]).font = { bold: true };
  info.addRow(["Nº orden", "Nombre", "NIF", "Nº ROPO", "Tipo de carné"]).font = { bold: true };
  for (const p of d.personas) info.addRow([p.orden, p.nombre, p.nif, p.ropo, p.carne]);
  info.addRow([]);
  info.addRow(["1.3 Equipos de aplicación"]).font = { bold: true };
  info.addRow(["Nº orden", "Equipo", "Nº ROMA", "Última inspección"]).font = { bold: true };
  for (const e of d.equipos) info.addRow([e.orden, e.nombre, e.roma, e.inspeccion ? new Date(e.inspeccion + "T12:00:00") : ""]);
  info.addRow([]);
  info.addRow(["1.4 Asesores"]).font = { bold: true };
  info.addRow(["Nombre", "NIF", "Nº ROPO", "Ámbito", "Entidad"]).font = { bold: true };
  for (const a of d.asesores) info.addRow([a.nombre, a.nif || "", a.numero_ropo || "", a.ambito, a.entidad || ""]);
  [10, 34, 14, 16, 18].forEach((w, i) => (info.getColumn(i + 1).width = w));

  hoja("2 Parcelas", "2. IDENTIFICACIÓN DE LAS PARCELAS", [
    ["orden", "Nº orden", null, 8], ["parcela", "Nombre", null, 18], ["provincia", "Prov.", null, 6], ["municipio", "Mun.", null, 6], ["agregado", "Agr.", null, 5], ["zona", "Zona", null, 5],
    ["poligono", "Polígono", null, 8], ["parcela_sigpac", "Parcela", null, 8], ["recinto", "Recinto", null, 8], ["uso", "Uso SIGPAC", null, 9],
    ["superficie_sigpac", "Sup. SIGPAC (ha)", (f) => r2(f.superficie_sigpac), 11], ["superficie_cultivada", "Sup. cultivada (ha)", (f) => r2(f.superficie_cultivada), 11],
    ["cultivo", "Cultivo", null, 14], ["variedad", "Variedad", null, 12], ["regadio", "Secano/Regadío", null, 11], ["zona_vulnerable", "Zona vulnerable", null, 10],
  ], d.parcelas);

  hoja("3 Tratamientos", "3. REGISTRO DE TRATAMIENTOS FITOSANITARIOS", [
    ["fecha", "Fecha", fecha, 11], ["parcelas_orden", "Parcelas (nº orden)", null, 12], ["cultivo", "Cultivo", null, 14], ["superficie", "Sup. tratada (ha)", (f) => r2(f.superficie), 10],
    ["plaga_o_motivo", "Problema fitosanitario", null, 20], ["aplicador_orden", "Aplicador (nº orden)", null, 10], ["equipo_orden", "Equipo (nº orden)", null, 10],
    ["producto", "Producto (nombre comercial)", null, 24], ["numero_registro", "Nº registro", null, 12], ["materia_activa", "Materia activa", null, 18],
    ["dosis_ha", "Dosis", (f) => r2(f.dosis_ha), 8], ["unidad_dosis", "Unidad", null, 8], ["cantidad", "Cantidad total", (f) => r2(f.cantidad), 10],
    ["metodo", "Método", null, 12], ["eficacia", "Eficacia", null, 9], ["justificacion", "Justificación / asesor", (f) => [f.justificacion, f.asesor].filter(Boolean).join(" · "), 22],
  ], d.tratamientos);

  hoja("4 Fertilización", "4. REGISTRO DE FERTILIZACIÓN (RD 1051/2022)", [
    ["fecha", "Fecha", fecha, 11], ["parcelas_orden", "Parcelas (nº orden)", null, 12], ["cultivo", "Cultivo", null, 14], ["superficie", "Sup. (ha)", (f) => r2(f.superficie), 9],
    ["producto", "Producto / tipo de abono", null, 24], ["riqueza", "Riqueza N-P2O5-K2O (%)", null, 12], ["n_organico", "Orgánico", (f) => (f.n_organico ? "Sí" : "No"), 8],
    ["dosis_ha", "Dosis", (f) => r2(f.dosis_ha), 8], ["unidad_dosis", "Unidad", null, 8], ["cantidad", "Cantidad total", (f) => r2(f.cantidad), 10],
    ["n_ha", "N (kg/ha)", (f) => r2(f.n_ha), 9], ["p_ha", "P2O5 (kg/ha)", (f) => r2(f.p_ha), 9], ["k_ha", "K2O (kg/ha)", (f) => r2(f.k_ha), 9],
    ["metodo", "Método de aplicación", null, 14], ["equipo_orden", "Equipo (nº orden)", null, 10],
  ], d.fertilizacion);

  hoja("4b Plan de abonado", "4.1 PLAN DE ABONADO (datos al inicio de campaña)", [
    ["campana", "Campaña", (f) => f.campanas?.nombre, 16], ["ambito", "Ámbito", (f) => (f.recintos ? `${f.recintos.parcelas?.nombre} ${refOk(f.recintos.referencia_sigpac) ? f.recintos.referencia_sigpac : ""}` : "Todo el cultivo"), 22],
    ["rendimiento_esperado_kg_ha", "Rendimiento esperado (kg/ha)", null, 12], ["cultivo_precedente", "Cultivo precedente", null, 14],
    ["n_kg_ha", "Necesidad N (kg/ha)", null, 10], ["p2o5_kg_ha", "Necesidad P2O5 (kg/ha)", null, 10], ["k2o_kg_ha", "Necesidad K2O (kg/ha)", null, 10],
    ["fecha_elaboracion", "Fecha del plan", (f) => (f.fecha_elaboracion ? new Date(f.fecha_elaboracion + "T12:00:00") : ""), 11], ["asesor", "Asesor", (f) => f.asesores?.nombre || "", 18],
  ], d.planes);

  hoja("4c Balance", "BALANCE DE NUTRIENTES POR RECINTO (kg/ha)", [
    ["campana", "Campaña", null, 16], ["parcela", "Parcela", null, 18], ["cultivo", "Cultivo", null, 12],
    ["n_aplicado_kg_ha", "N aplicado", (f) => r2(f.n_aplicado_kg_ha), 9], ["n_max_kg_ha", "N máximo", (f) => r2(f.n_max_kg_ha), 9],
    ["p2o5_aplicado_kg_ha", "P2O5 aplicado", (f) => r2(f.p2o5_aplicado_kg_ha), 9], ["p2o5_max_kg_ha", "P2O5 máximo", (f) => r2(f.p2o5_max_kg_ha), 9],
    ["k2o_aplicado_kg_ha", "K2O aplicado", (f) => r2(f.k2o_aplicado_kg_ha), 9], ["k2o_max_kg_ha", "K2O máximo", (f) => r2(f.k2o_max_kg_ha), 9],
    ["n_organico_kg_ha", "N orgánico", (f) => r2(f.n_organico_kg_ha), 9], ["zona_vulnerable", "Zona vulnerable", (f) => (f.zona_vulnerable ? "Sí" : "No"), 9],
  ], d.balance);

  hoja("5 Cosecha", "5. COSECHA COMERCIALIZADA", [
    ["fecha", "Fecha", fecha, 11], ["parcelas_orden", "Parcelas (nº orden)", null, 12], ["cultivo", "Producto", null, 14], ["calidad", "Calidad", null, 12],
    ["kilos_netos", "Cantidad (kg)", (f) => r2(f.kilos_netos), 12], ["numero_ticket", "Nº albarán / ticket", null, 14], ["destino", "Cliente / destino", null, 22], ["destino_nif", "NIF cliente", null, 12],
  ], d.cosecha);

  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: `cuaderno-explotacion-${(ccaa?.id || "es").replace(/_/g, "-")}-${periodo.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w]+/g, "-")}.xlsx` });
  a.click();
  URL.revokeObjectURL(url);
}
