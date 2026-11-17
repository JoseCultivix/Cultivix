"use client";
import VerDocumento from "@/components/VerDocumento";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useApp } from "@/components/AppProvider";
import SelectorCampana, { campanasSeleccionadas } from "@/components/SelectorCampana";
import { Boton, Cargando, Hoja, Pagina, Seccion, Tarjeta } from "@/components/ui";
import FormCompra from "@/components/FormCompra";
import { categoria, desdeFilas, repartirLinea } from "@/lib/compras";
import { euros, fechaCorta, num } from "@/lib/formato";

export default function Economia() {
  const { empresaId, campanas, recintos, labores, esGestor, maquinaria, aperos, notificar, recargar } = useApp();
  const [sel, setSel] = useState("activas");
  const [albaran, setAlbaran] = useState(null);
  const [recarga, setRecarga] = useState(0);
  const [datos, setDatos] = useState(null);
  const elegidas = useMemo(() => campanasSeleccionadas(campanas, sel), [campanas, sel]);
  const ids = elegidas.map((c) => c.id);

  useEffect(() => {
    if (!ids.length) {
      setDatos({ lineas: [], albaranes: [], costes: {}, entregas: [], reparto: [], gastos: [], equipos: {} });
      return;
    }
    setDatos(null);
    (async () => {
      const desde = elegidas.reduce((m, c) => (c.fecha_inicio < m ? c.fecha_inicio : m), "9999");
      const hasta = elegidas.reduce((m, c) => (c.fecha_fin > m ? c.fecha_fin : m), "0000");
      const [l, a, e, rep, g, mo] = await Promise.all([
        // Cada recinto de cada parte, con su campaña de cultivo
        supabase
          .from("partes_trabajo_recintos")
          .select("parte_trabajo_id, recinto_id, superficie_trabajada_ha, campana_id, partes_trabajo!inner(id, fecha, labor_id, horas_totales, estado, empresa_id)")
          .in("campana_id", ids)
          .in("partes_trabajo.estado", ["validado", "pendiente"]),
        supabase
          .from("albaranes_compra")
          .select("id, empresa_id, fecha, numero, total, con_factura, estado, documento_id, proveedor_id, tipo_documento, proveedores(nombre)")
          .eq("empresa_id", empresaId)
          .gte("fecha", desde)
          .lte("fecha", hasta)
          .order("fecha", { ascending: false }),
        supabase.from("entregas_cosecha").select("id, kilos_netos, importe, precio, campana_id, cultivos(nombre)").in("campana_id", ids),
        supabase.from("v_entregas_recintos").select("recinto_id, parcela_id, kilos, importe").in("campana_id", ids),
        // Gastos directos de compras (lo de almacén no: su coste llega al aplicarlo)
        supabase
          .from("albaranes_compra_lineas")
          .select("id, categoria, importe, descripcion, albaranes_compra!inner(fecha, empresa_id), compras_imputaciones(*)")
          .eq("albaranes_compra.empresa_id", empresaId)
          .gte("albaranes_compra.fecha", desde)
          .lte("albaranes_compra.fecha", hasta)
          .not("categoria", "in", "(fitosanitario,herbicida,fertilizante,bioestimulante,semilla)"),
        // Mano de obra propia en reparaciones y mantenimientos (horas × coste/hora del trabajador)
        supabase
          .from("mantenimientos")
          .select("maquinaria_id, apero_id, horas_mano_obra, trabajadores(coste_hora)")
          .eq("empresa_id", empresaId)
          .eq("donde", "propios")
          .not("horas_mano_obra", "is", null)
          .gte("fecha", desde)
          .lte("fecha", hasta),
      ]);
      const partesIds = [...new Set((l.data || []).map((x) => x.parte_trabajo_id))];
      // Superficie total de cada parte (todas sus parcelas, de cualquier cultivo) para repartir su coste
      const supTotal = {};
      const costes = {};
      const equipos = {};
      for (let i = 0; i < partesIds.length; i += 150) {
        const lote = partesIds.slice(i, i + 150);
        const [c, todos, mq, ap] = await Promise.all([
          supabase.from("v_partes_coste").select("*").in("parte_trabajo_id", lote),
          supabase.from("partes_trabajo_recintos").select("parte_trabajo_id, superficie_trabajada_ha").in("parte_trabajo_id", lote),
          supabase.from("partes_trabajo_maquinaria").select("parte_trabajo_id, maquinaria_id, horas").in("parte_trabajo_id", lote),
          supabase.from("partes_trabajo_aperos").select("parte_trabajo_id, apero_id, horas").in("parte_trabajo_id", lote),
        ]);
        for (const x of mq.data || []) (equipos[x.parte_trabajo_id] = equipos[x.parte_trabajo_id] || []).push({ k: "maquinas", id: x.maquinaria_id, horas: x.horas });
        for (const x of ap.data || []) (equipos[x.parte_trabajo_id] = equipos[x.parte_trabajo_id] || []).push({ k: "aperos", id: x.apero_id, horas: x.horas });
        for (const x of c.data || []) costes[x.parte_trabajo_id] = x;
        for (const x of todos.data || []) supTotal[x.parte_trabajo_id] = (supTotal[x.parte_trabajo_id] || { ha: 0, n: 0 });
        for (const x of todos.data || []) {
          supTotal[x.parte_trabajo_id].ha += +x.superficie_trabajada_ha || 0;
          supTotal[x.parte_trabajo_id].n += 1;
        }
      }
      setDatos({ lineas: l.data || [], albaranes: a.data || [], costes, supTotal, entregas: e.data || [], reparto: rep.data || [], gastos: g.data || [], equipos, manoObraTaller: mo.data || [] });
    })();
  }, [empresaId, ids.join(","), recarga]); // eslint-disable-line

  const r = useMemo(() => {
    if (!datos) return null;
    let mo = 0, maq = 0, prod = 0;
    const horasPorParte = {};
    const porParcela = {};
    const porLabor = {};
    const nombre = (recId) => recintos.find((y) => y.id === recId)?.parcela_nombre || "Otras";
    const horasEquipoRecinto = { maquinas: {}, aperos: {} }; // equipo → recinto → horas
    for (const x of datos.lineas) {
      const p = x.partes_trabajo;
      const c = datos.costes[x.parte_trabajo_id] || {};
      const st = datos.supTotal?.[x.parte_trabajo_id] || { ha: 0, n: 1 };
      // Fracción del parte que corresponde a este recinto (por superficie)
      const f = st.ha > 0 ? (+x.superficie_trabajada_ha || 0) / st.ha : 1 / st.n;
      const cmo = (+c.coste_mano_obra || 0) * f, cmaq = (+c.coste_maquinaria || 0) * f, cpro = (+c.coste_productos || 0) * f;
      mo += cmo;
      maq += cmaq;
      prod += cpro;
      horasPorParte[p.id] = +p.horas_totales || 0;
      porLabor[p.labor_id] = (porLabor[p.labor_id] || 0) + cmo + cmaq + cpro;
      const k = nombre(x.recinto_id);
      porParcela[k] = porParcela[k] || { coste: 0, ingreso: 0, kilos: 0, ha: 0 };
      porParcela[k].coste += cmo + cmaq + cpro;
      for (const q of datos.equipos?.[x.parte_trabajo_id] || []) {
        const h = (+q.horas || +p.horas_totales || 0) * f;
        const m = (horasEquipoRecinto[q.k][q.id] = horasEquipoRecinto[q.k][q.id] || {});
        m[x.recinto_id] = (m[x.recinto_id] || 0) + h;
      }
    }
    // Gastos directos de compras: a recintos (por ha), a equipos (luego por horas) o generales
    let directos = 0, equiposRepartido = 0, general = 0;
    const gastoEquipo = { maquinas: {}, aperos: {} };
    const porCategoria = {};
    const sumarParcela = (recId, e) => {
      const k = nombre(recId);
      porParcela[k] = porParcela[k] || { coste: 0, ingreso: 0, kilos: 0, ha: 0 };
      porParcela[k].coste += e;
    };
    for (const g of datos.gastos || []) {
      const imp = +g.importe || 0;
      porCategoria[g.categoria] = (porCategoria[g.categoria] || 0) + imp;
      const rp = repartirLinea(imp, desdeFilas(g.compras_imputaciones), recintos);
      for (const [rid, e] of Object.entries(rp.recintos)) {
        directos += e;
        sumarParcela(rid, e);
      }
      for (const k of ["maquinas", "aperos"]) for (const [id, e] of Object.entries(rp[k])) gastoEquipo[k][id] = (gastoEquipo[k][id] || 0) + e;
      general += rp.general;
    }
    for (const m of datos.manoObraTaller || []) {
      const e = (+m.horas_mano_obra || 0) * (+m.trabajadores?.coste_hora || 0);
      if (!e) continue;
      const k = m.maquinaria_id ? "maquinas" : "aperos";
      const id = m.maquinaria_id || m.apero_id;
      gastoEquipo[k][id] = (gastoEquipo[k][id] || 0) + e;
    }
    const equiposTabla = [];
    for (const k of ["maquinas", "aperos"]) {
      for (const [id, e] of Object.entries(gastoEquipo[k])) {
        const hr = horasEquipoRecinto[k][id] || {};
        const H = Object.values(hr).reduce((a, b) => a + b, 0);
        if (H > 0) for (const [rid, h] of Object.entries(hr)) sumarParcela(rid, (e * h) / H);
        if (H > 0) equiposRepartido += e;
        const lista = k === "maquinas" ? maquinaria : aperos;
        equiposTabla.push({ id, nombre: lista.find((x) => x.id === id)?.nombre || (k === "maquinas" ? "Máquina" : "Apero"), gasto: e, horas: H, repartido: H > 0 });
      }
    }
    for (const x of datos.reparto) {
      const k = nombre(x.recinto_id);
      porParcela[k] = porParcela[k] || { coste: 0, ingreso: 0, kilos: 0, ha: 0 };
      porParcela[k].ingreso += +x.importe || 0;
      porParcela[k].kilos += +x.kilos || 0;
    }
    for (const rec of recintos) {
      if (porParcela[rec.parcela_nombre]) porParcela[rec.parcela_nombre].ha += +rec.superficie_sigpac_ha || 0;
    }
    const ingresos = datos.entregas.reduce((s, e) => s + (+e.importe || 0), 0);
    const kilos = datos.entregas.reduce((s, e) => s + (+e.kilos_netos || 0), 0);
    const kilosSinPrecio = datos.entregas.filter((e) => e.precio == null).reduce((s, e) => s + (+e.kilos_netos || 0), 0);
    const compras = datos.albaranes.reduce((s, a) => s + (+a.total || 0), 0);
    const sinFactura = datos.albaranes.filter((a) => !a.con_factura).reduce((s, a) => s + (+a.total || 0), 0);
    const horas = Object.values(horasPorParte).reduce((s, h) => s + h, 0);
    return { mo, maq, prod, horas, porParcela, porLabor, compras, sinFactura, ingresos, kilos, kilosSinPrecio, directos, equiposRepartido, equiposTabla, general, porCategoria };
  }, [datos, recintos, maquinaria, aperos]);

  if (!esGestor) return <Pagina titulo="Economía">Solo para el titular o encargado.</Pagina>;

  const totalCostes = r ? r.mo + r.maq + r.prod + r.directos + r.equiposRepartido : 0;
  const beneficio = r ? r.ingresos - totalCostes : 0;
  return (
    <Pagina titulo="Economía" subtitulo={elegidas.map((c) => c.nombre).join(" · ") || "Sin campañas"} accion={<Boton href="/escanear">📄 Escanear</Boton>}>
      <Boton variante="secundario" className="mb-3 w-full" onClick={() => setAlbaran({ nuevo: true })}>
        ➕ Apuntar un gasto o compra a mano
      </Boton>
      <SelectorCampana valor={sel} onCambio={setSel} />
      {!r ? (
        <Cargando />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Kpi titulo="Ingresos de cosecha" valor={euros(r.ingresos)} pie={`${num(r.kilos / 1000, 1)} t entregadas${r.kilosSinPrecio ? ` · ${num(r.kilosSinPrecio / 1000, 1)} t sin precio` : ""}`} />
            <Kpi titulo="Costes imputados" valor={euros(totalCostes)} pie={`${num(r.horas, 1)} horas de trabajo`} />
            <Kpi
              titulo="Beneficio (ingresos − costes)"
              valor={<span className={beneficio < 0 ? "text-red-700" : ""}>{euros(beneficio)}</span>}
              pie={`${r.kilosSinPrecio ? "Provisional: faltan liquidaciones. " : ""}Sin gastos generales (${euros(r.general)}) ni PAC.`}
              ancho
            />
          </div>

          <Tarjeta className="mt-3">
            <Barra etiqueta="Mano de obra" valor={r.mo} total={totalCostes} color="bg-olivo-600" />
            <Barra etiqueta="Maquinaria y aperos" valor={r.maq} total={totalCostes} color="bg-tierra-500" />
            <Barra etiqueta="Productos aplicados" valor={r.prod} total={totalCostes} color="bg-amber-500" />
            <Barra etiqueta="Gastos directos a parcelas" valor={r.directos} total={totalCostes} color="bg-sky-500" />
            <Barra etiqueta="Gasoil, repuestos y reparaciones" valor={r.equiposRepartido} total={totalCostes} color="bg-stone-500" />
            <p className="mt-2 text-xs text-stone-500">
              Partes: horas × coste/hora de personas y máquinas, y productos aplicados × precio medio de compra. Compras: lo imputado a parcelas o fincas se reparte por hectáreas; lo imputado a máquinas y aperos, entre las parcelas según las horas que han trabajado en cada una.
            </p>
          </Tarjeta>

          <Seccion titulo="Por parcela">
            <Tarjeta className="!p-0">
              <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 border-b border-stone-100 px-4 py-2 text-xs font-bold uppercase text-stone-500">
                <span>Parcela</span>
                <span className="text-right">Ingresos</span>
                <span className="text-right">Costes</span>
                <span className="text-right">Margen/ha</span>
              </div>
              {Object.entries(r.porParcela)
                .sort((a, b) => b[1].ingreso - b[1].coste - (a[1].ingreso - a[1].coste))
                .map(([k, v]) => (
                  <div key={k} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-3 border-b border-stone-100 px-4 py-2.5 text-[15px] last:border-0">
                    <span className="font-semibold">
                      {k}
                      {v.kilos > 0 && <span className="block text-xs font-normal text-stone-500">{num(v.kilos / Math.max(v.ha, 0.0001), 0)} kg/ha</span>}
                    </span>
                    <span className="text-right">{euros(v.ingreso)}</span>
                    <span className="text-right">{euros(v.coste)}</span>
                    <b className={`text-right ${v.ingreso - v.coste < 0 ? "text-red-700" : "text-olivo-800"}`}>{v.ha > 0 ? euros((v.ingreso - v.coste) / v.ha) : "—"}</b>
                  </div>
                ))}
              {!Object.keys(r.porParcela).length && <p className="p-4 text-stone-500">Sin datos en esta campaña.</p>}
            </Tarjeta>
          </Seccion>

          {r.equiposTabla.length > 0 && (
            <Seccion titulo="Gasto real de máquinas y aperos">
              <Tarjeta className="!p-0">
                <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 border-b border-stone-100 px-4 py-2 text-xs font-bold uppercase text-stone-500">
                  <span>Equipo</span>
                  <span className="text-right">Gasto</span>
                  <span className="text-right">Horas</span>
                  <span className="text-right">€/hora</span>
                </div>
                {r.equiposTabla
                  .sort((a, b) => b.gasto - a.gasto)
                  .map((x) => (
                    <div key={x.id} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-3 border-b border-stone-100 px-4 py-2.5 text-[15px] last:border-0">
                      <span className="font-semibold">
                        {x.nombre}
                        {!x.repartido && <span className="block text-xs font-normal text-amber-700">Sin horas en partes: no se ha repartido a parcelas</span>}
                      </span>
                      <span className="text-right">{euros(x.gasto)}</span>
                      <span className="text-right">{num(x.horas, 1)}</span>
                      <b className="text-right">{x.horas > 0 ? euros(x.gasto / x.horas) : "—"}</b>
                    </div>
                  ))}
              </Tarjeta>
              <p className="mt-2 text-xs text-stone-500">Gasoil, repuestos, reparaciones y horas de mantenimiento con medios propios de cada equipo. Se suman al coste/hora que tengas puesto en la ficha de la máquina: deja en ese coste/hora solo la amortización y el seguro.</p>
            </Seccion>
          )}

          {Object.keys(r.porCategoria).length > 0 && (
            <Seccion titulo={`Gastos directos por tipo · gastos generales ${euros(r.general)}`}>
              <Tarjeta className="!p-0">
                {Object.entries(r.porCategoria)
                  .sort((a, b) => b[1] - a[1])
                  .map(([k, v]) => (
                    <div key={k} className="flex justify-between border-b border-stone-100 px-4 py-2.5 last:border-0">
                      <span>
                        {categoria(k).icono} {categoria(k).t}
                      </span>
                      <b>{euros(v)}</b>
                    </div>
                  ))}
              </Tarjeta>
              <p className="mt-2 text-xs text-stone-500">Los gastos generales (seguros, gestoría, lo que no imputes a nada…) se muestran aparte y no se cargan a las parcelas.</p>
            </Seccion>
          )}

          <Seccion titulo="Coste por labor">
            <Tarjeta className="!p-0">
              {Object.entries(r.porLabor)
                .sort((a, b) => b[1] - a[1])
                .map(([k, v]) => (
                  <div key={k} className="flex justify-between border-b border-stone-100 px-4 py-2.5 last:border-0">
                    <span>{labores.find((l) => l.id === k)?.nombre || "Sin labor"}</span>
                    <b>{euros(v)}</b>
                  </div>
                ))}
              {!Object.keys(r.porLabor).length && <p className="p-4 text-stone-500">Sin partes en esta campaña.</p>}
            </Tarjeta>
          </Seccion>

          <Seccion titulo={`Compras y gastos · ${euros(r.compras)}${r.sinFactura ? ` · ${euros(r.sinFactura)} sin factura` : ""}`}>
            <div className="space-y-2">
              {datos.albaranes.slice(0, 15).map((a) => (
                <div key={a.id} className="flex justify-between rounded-2xl bg-white px-4 py-3 shadow-sm">
                  <button type="button" className="flex-1 text-left" onClick={() => setAlbaran(a)}>
                    <b>{a.proveedores?.nombre || "Proveedor"}</b>
                    <span className="block text-sm text-stone-500">
                      {{ albaran: "Albarán", factura: "Factura", ticket: "Ticket" }[a.tipo_documento] || "Albarán"} {a.numero || "s/n"} · {fechaCorta(a.fecha)} {a.con_factura ? "" : "· sin factura"}
                    </span>
                    <span className="text-sm font-bold text-olivo-700">✏️ Ver y corregir</span>
                  </button>
                  <span className="flex flex-col items-end gap-1">
                    <b>{euros(a.total)}</b>
                    {a.documento_id && <VerDocumento documentoId={a.documento_id} texto="👁️ Ver" className="!min-h-9 !px-3 text-sm" />}
                  </span>
                </div>
              ))}
              {!datos.albaranes.length && <p className="text-stone-500">Sin compras en estas fechas.</p>}
            </div>
          </Seccion>

          <Hoja abierta={!!albaran} onCerrar={() => setAlbaran(null)} titulo={albaran?.nuevo ? "Nuevo gasto o compra" : "Compra"}>
            {albaran && (
              <FormCompra
                compraId={albaran.nuevo ? null : albaran.id}
                onHecho={(m) => {
                  setAlbaran(null);
                  setRecarga((x) => x + 1);
                  recargar?.();
                  notificar(m);
                }}
              />
            )}
          </Hoja>

          <p className="mt-6 rounded-2xl bg-olivo-50 p-4 text-sm text-olivo-900">
            <b>Próximo paso:</b> añadir las ayudas PAC repartidas por recinto para completar la rentabilidad real.
          </p>
        </>
      )}
    </Pagina>
  );
}

function Kpi({ titulo, valor, pie, ancho }) {
  return (
    <Tarjeta className={ancho ? "col-span-2" : ""}>
      <p className="text-sm font-semibold text-stone-500">{titulo}</p>
      <p className="mt-1 text-2xl font-black text-olivo-900">{valor}</p>
      <p className="text-xs text-stone-500">{pie}</p>
    </Tarjeta>
  );
}

function Barra({ etiqueta, valor, total, color }) {
  const pct = total > 0 ? (valor / total) * 100 : 0;
  return (
    <div className="mb-2">
      <div className="flex justify-between text-[15px]">
        <span>{etiqueta}</span>
        <b>{euros(valor)}</b>
      </div>
      <div className="mt-1 h-2.5 rounded-full bg-stone-100">
        <div className={`h-2.5 rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
