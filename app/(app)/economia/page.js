"use client";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useApp } from "@/components/AppProvider";
import { Boton, Cargando, Pagina, Seccion, Tarjeta } from "@/components/ui";
import { euros, fechaCorta, num } from "@/lib/formato";

export default function Economia() {
  const { empresaId, campana, recintos, labores, esGestor } = useApp();
  const [datos, setDatos] = useState(null);

  useEffect(() => {
    if (!campana) return;
    (async () => {
      const [p, a] = await Promise.all([
        supabase
          .from("partes_trabajo")
          .select("id, fecha, labor_id, horas_totales, partes_trabajo_recintos(recinto_id, superficie_trabajada_ha)")
          .eq("empresa_id", empresaId)
          .gte("fecha", campana.fecha_inicio)
          .lte("fecha", campana.fecha_fin)
          .in("estado", ["validado", "pendiente"]),
        supabase
          .from("albaranes_compra")
          .select("id, fecha, numero, total, con_factura, estado, proveedores(nombre)")
          .eq("empresa_id", empresaId)
          .gte("fecha", campana.fecha_inicio)
          .lte("fecha", campana.fecha_fin)
          .order("fecha", { ascending: false }),
      ]);
      const ids = (p.data || []).map((x) => x.id);
      const costes = {};
      for (let i = 0; i < ids.length; i += 150) {
        const { data } = await supabase.from("v_partes_coste").select("*").in("parte_trabajo_id", ids.slice(i, i + 150));
        for (const c of data || []) costes[c.parte_trabajo_id] = c;
      }
      setDatos({ partes: p.data || [], albaranes: a.data || [], costes });
    })();
  }, [empresaId, campana]);

  const r = useMemo(() => {
    if (!datos) return null;
    let mo = 0, maq = 0, prod = 0, horas = 0;
    const porParcela = {};
    const porLabor = {};
    for (const p of datos.partes) {
      const c = datos.costes[p.id] || {};
      const total = +c.coste_mano_obra + +c.coste_maquinaria + +c.coste_productos || 0;
      mo += +c.coste_mano_obra || 0;
      maq += +c.coste_maquinaria || 0;
      prod += +c.coste_productos || 0;
      horas += +p.horas_totales || 0;
      porLabor[p.labor_id] = (porLabor[p.labor_id] || 0) + total;
      // Reparto del coste entre recintos según superficie trabajada (DEC-019/022)
      const rs = p.partes_trabajo_recintos || [];
      const sup = rs.reduce((s, x) => s + (+x.superficie_trabajada_ha || 0), 0);
      for (const x of rs) {
        const rec = recintos.find((y) => y.id === x.recinto_id);
        const k = rec?.parcela_nombre || "Otras";
        const parte = sup > 0 ? (+x.superficie_trabajada_ha || 0) / sup : 1 / rs.length;
        porParcela[k] = porParcela[k] || { coste: 0, ha: 0 };
        porParcela[k].coste += total * parte;
      }
    }
    for (const rec of recintos) {
      const k = rec.parcela_nombre;
      if (porParcela[k]) porParcela[k].ha += +rec.superficie_sigpac_ha || 0;
    }
    const compras = datos.albaranes.reduce((s, a) => s + (+a.total || 0), 0);
    const sinFactura = datos.albaranes.filter((a) => !a.con_factura).reduce((s, a) => s + (+a.total || 0), 0);
    return { mo, maq, prod, horas, porParcela, porLabor, compras, sinFactura };
  }, [datos, recintos]);

  if (!esGestor) return <Pagina titulo="Economía">Solo para el titular o encargado.</Pagina>;
  if (!campana) return <Pagina titulo="Economía">No hay campaña activa. Créala en Ajustes.</Pagina>;
  if (!r) return <Cargando />;

  const totalTrabajos = r.mo + r.maq + r.prod;
  return (
    <Pagina titulo="Economía" subtitulo={`${campana.nombre} · ${fechaCorta(campana.fecha_inicio)} – ${fechaCorta(campana.fecha_fin)}`} accion={<Boton href="/escanear">📄 Escanear</Boton>}>
      <div className="grid grid-cols-2 gap-3">
        <Kpi titulo="Coste de trabajos" valor={euros(totalTrabajos)} pie={`${num(r.horas, 1)} horas`} />
        <Kpi titulo="Compras (albaranes)" valor={euros(r.compras)} pie={r.sinFactura ? `${euros(r.sinFactura)} sin factura` : `${datos.albaranes.length} documentos`} />
      </div>
      <Tarjeta className="mt-3">
        <Barra etiqueta="Mano de obra" valor={r.mo} total={totalTrabajos} color="bg-olivo-600" />
        <Barra etiqueta="Maquinaria y aperos" valor={r.maq} total={totalTrabajos} color="bg-tierra-500" />
        <Barra etiqueta="Productos aplicados" valor={r.prod} total={totalTrabajos} color="bg-amber-500" />
        <p className="mt-2 text-xs text-stone-500">Calculado solo con los partes: horas × coste/hora de personas y máquinas, y productos aplicados × precio medio de compra.</p>
      </Tarjeta>

      <Seccion titulo="Coste por parcela">
        <Tarjeta className="!p-0">
          {Object.entries(r.porParcela)
            .sort((a, b) => b[1].coste - a[1].coste)
            .map(([k, v]) => (
              <div key={k} className="flex items-center justify-between border-b border-stone-100 px-4 py-2.5 last:border-0">
                <span className="font-semibold">{k}</span>
                <span className="text-right">
                  <b>{euros(v.coste)}</b>
                  {v.ha > 0 && <span className="block text-xs text-stone-500">{euros(v.coste / v.ha)}/ha</span>}
                </span>
              </div>
            ))}
          {!Object.keys(r.porParcela).length && <p className="p-4 text-stone-500">Sin partes en esta campaña.</p>}
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
        </Tarjeta>
      </Seccion>

      <Seccion titulo="Últimas compras">
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
        </div>
      </Seccion>

      <p className="mt-6 rounded-2xl bg-olivo-50 p-4 text-sm text-olivo-900">
        <b>Próximo paso:</b> ingresos (liquidaciones de almazara, PAC) para calcular la rentabilidad real por parcela y cultivo.
      </p>
    </Pagina>
  );
}

function Kpi({ titulo, valor, pie }) {
  return (
    <Tarjeta>
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
