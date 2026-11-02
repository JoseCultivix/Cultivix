"use client";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useApp } from "@/components/AppProvider";
import SelectorCampana, { campanasSeleccionadas } from "@/components/SelectorCampana";
import { Boton, Cargando, Pagina, Seccion, Tarjeta } from "@/components/ui";
import { euros, fechaCorta, num } from "@/lib/formato";

export default function Economia() {
  const { empresaId, campanas, recintos, labores, esGestor } = useApp();
  const [sel, setSel] = useState("activas");
  const [datos, setDatos] = useState(null);
  const elegidas = useMemo(() => campanasSeleccionadas(campanas, sel), [campanas, sel]);
  const ids = elegidas.map((c) => c.id);

  useEffect(() => {
    if (!ids.length) {
      setDatos({ lineas: [], albaranes: [], costes: {}, entregas: [], reparto: [] });
      return;
    }
    setDatos(null);
    (async () => {
      const desde = elegidas.reduce((m, c) => (c.fecha_inicio < m ? c.fecha_inicio : m), "9999");
      const hasta = elegidas.reduce((m, c) => (c.fecha_fin > m ? c.fecha_fin : m), "0000");
      const [l, a, e, rep] = await Promise.all([
        // Cada recinto de cada parte, con su campaña de cultivo
        supabase
          .from("partes_trabajo_recintos")
          .select("parte_trabajo_id, recinto_id, superficie_trabajada_ha, campana_id, partes_trabajo!inner(id, fecha, labor_id, horas_totales, estado, empresa_id)")
          .in("campana_id", ids)
          .in("partes_trabajo.estado", ["validado", "pendiente"]),
        supabase
          .from("albaranes_compra")
          .select("id, fecha, numero, total, con_factura, estado, proveedores(nombre)")
          .eq("empresa_id", empresaId)
          .gte("fecha", desde)
          .lte("fecha", hasta)
          .order("fecha", { ascending: false }),
        supabase.from("entregas_cosecha").select("id, kilos_netos, importe, precio, campana_id, cultivos(nombre)").in("campana_id", ids),
        supabase.from("v_entregas_recintos").select("recinto_id, parcela_id, kilos, importe").in("campana_id", ids),
      ]);
      const partesIds = [...new Set((l.data || []).map((x) => x.parte_trabajo_id))];
      // Superficie total de cada parte (todas sus parcelas, de cualquier cultivo) para repartir su coste
      const supTotal = {};
      const costes = {};
      for (let i = 0; i < partesIds.length; i += 150) {
        const lote = partesIds.slice(i, i + 150);
        const [c, todos] = await Promise.all([
          supabase.from("v_partes_coste").select("*").in("parte_trabajo_id", lote),
          supabase.from("partes_trabajo_recintos").select("parte_trabajo_id, superficie_trabajada_ha").in("parte_trabajo_id", lote),
        ]);
        for (const x of c.data || []) costes[x.parte_trabajo_id] = x;
        for (const x of todos.data || []) supTotal[x.parte_trabajo_id] = (supTotal[x.parte_trabajo_id] || { ha: 0, n: 0 });
        for (const x of todos.data || []) {
          supTotal[x.parte_trabajo_id].ha += +x.superficie_trabajada_ha || 0;
          supTotal[x.parte_trabajo_id].n += 1;
        }
      }
      setDatos({ lineas: l.data || [], albaranes: a.data || [], costes, supTotal, entregas: e.data || [], reparto: rep.data || [] });
    })();
  }, [empresaId, ids.join(",")]); // eslint-disable-line

  const r = useMemo(() => {
    if (!datos) return null;
    let mo = 0, maq = 0, prod = 0;
    const horasPorParte = {};
    const porParcela = {};
    const porLabor = {};
    const nombre = (recId) => recintos.find((y) => y.id === recId)?.parcela_nombre || "Otras";
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
    return { mo, maq, prod, horas, porParcela, porLabor, compras, sinFactura, ingresos, kilos, kilosSinPrecio };
  }, [datos, recintos]);

  if (!esGestor) return <Pagina titulo="Economía">Solo para el titular o encargado.</Pagina>;

  const totalCostes = r ? r.mo + r.maq + r.prod : 0;
  const beneficio = r ? r.ingresos - totalCostes : 0;
  return (
    <Pagina titulo="Economía" subtitulo={elegidas.map((c) => c.nombre).join(" · ") || "Sin campañas"} accion={<Boton href="/escanear">📄 Escanear</Boton>}>
      <SelectorCampana valor={sel} onCambio={setSel} />
      {!r ? (
        <Cargando />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Kpi titulo="Ingresos de cosecha" valor={euros(r.ingresos)} pie={`${num(r.kilos / 1000, 1)} t entregadas${r.kilosSinPrecio ? ` · ${num(r.kilosSinPrecio / 1000, 1)} t sin precio` : ""}`} />
            <Kpi titulo="Coste de trabajos" valor={euros(totalCostes)} pie={`${num(r.horas, 1)} horas`} />
            <Kpi
              titulo="Beneficio (ingresos − costes)"
              valor={<span className={beneficio < 0 ? "text-red-700" : ""}>{euros(beneficio)}</span>}
              pie={r.kilosSinPrecio ? "Provisional: faltan liquidaciones" : "Sin incluir compras no aplicadas ni PAC"}
              ancho
            />
          </div>

          <Tarjeta className="mt-3">
            <Barra etiqueta="Mano de obra" valor={r.mo} total={totalCostes} color="bg-olivo-600" />
            <Barra etiqueta="Maquinaria y aperos" valor={r.maq} total={totalCostes} color="bg-tierra-500" />
            <Barra etiqueta="Productos aplicados" valor={r.prod} total={totalCostes} color="bg-amber-500" />
            <p className="mt-2 text-xs text-stone-500">
              Calculado con los partes: horas × coste/hora de personas y máquinas, y productos aplicados × precio medio de compra. Un parte con parcelas de varios cultivos se reparte por superficie.
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

          <Seccion titulo={`Compras (albaranes) · ${euros(r.compras)}${r.sinFactura ? ` · ${euros(r.sinFactura)} sin factura` : ""}`}>
            <div className="space-y-2">
              {datos.albaranes.slice(0, 15).map((a) => (
                <div key={a.id} className="flex justify-between rounded-2xl bg-white px-4 py-3 shadow-sm">
                  <span>
                    <b>{a.proveedores?.nombre || "Proveedor"}</b>
                    <span className="block text-sm text-stone-500">
                      {fechaCorta(a.fecha)} · {a.numero || "s/n"} {a.con_factura ? "" : "· sin factura"}
                    </span>
                  </span>
                  <b>{euros(a.total)}</b>
                </div>
              ))}
              {!datos.albaranes.length && <p className="text-stone-500">Sin compras en estas fechas.</p>}
            </div>
          </Seccion>

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
