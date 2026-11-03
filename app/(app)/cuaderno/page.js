"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useApp } from "@/components/AppProvider";
import { Boton, Cargando, Pagina, Vacio } from "@/components/ui";
import SelectorCampana, { campanasSeleccionadas } from "@/components/SelectorCampana";
import { fechaCorta, num } from "@/lib/formato";

const COLS = [
  ["fecha", "Fecha"],
  ["parcela", "Parcela"],
  ["referencia_sigpac", "Ref. SIGPAC"],
  ["cultivo", "Cultivo"],
  ["superficie_trabajada_ha", "Sup. tratada (ha)"],
  ["plaga_o_motivo", "Plaga / motivo"],
  ["producto", "Producto"],
  ["numero_registro", "Nº registro"],
  ["dosis_ha", "Dosis/ha"],
  ["unidad_dosis", "Unidad"],
  ["cantidad_recinto", "Cantidad"],
  ["maquinaria", "Equipo"],
  ["aplicador", "Aplicador"],
];

export default function Cuaderno() {
  const { empresaId, campanas, empresa } = useApp();
  const [sel, setSel] = useState("activas");
  const [filas, setFilas] = useState(null);
  const elegidas = useMemo(() => campanasSeleccionadas(campanas, sel), [campanas, sel]);
  const ids = elegidas.map((c) => c.id).join(",");
  const campana = { nombre: elegidas.map((c) => c.nombre).join(" + ") };

  useEffect(() => {
    if (!ids) return setFilas([]);
    setFilas(null);
    supabase
      .from("v_cuaderno_campo")
      .select("*")
      .eq("empresa_id", empresaId)
      .in("campana_id", ids.split(","))
      .order("fecha")
      .then(({ data }) => setFilas(data || []));
  }, [empresaId, ids]);

  function csv() {
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const txt = [COLS.map((c) => esc(c[1])).join(";"), ...filas.map((f) => COLS.map(([k]) => esc(typeof f[k] === "number" ? String(f[k]).replace(".", ",") : f[k])).join(";"))].join("\r\n");
    const url = URL.createObjectURL(new Blob(["﻿" + txt], { type: "text/csv;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `cuaderno-campo-${campana?.nombre || ""}.csv` });
    a.click();
    URL.revokeObjectURL(url);
  }

  const pendientes = (filas || []).filter((f) => f.estado === "pendiente").length;
  const sinRegistro = [...new Set((filas || []).filter((f) => !f.numero_registro).map((f) => f.producto))];

  return (
    <Pagina
      titulo="Cuaderno de campo"
      subtitulo={`${empresa?.nombre} · ${campana?.nombre || ""}`}
      volver="/mas"
      accion={
        filas?.length > 0 && (
          <div className="flex gap-2">
            <Boton variante="secundario" onClick={csv}>
              CSV
            </Boton>
            <Boton onClick={() => window.print()}>PDF</Boton>
          </div>
        )
      }
    >
      <div className="no-print mb-4 grid grid-cols-2 gap-2">
        <Link href="/cuaderno/oficial" className="rounded-2xl bg-olivo-700 p-3 text-white shadow-sm">
          <span className="text-2xl">🏛️</span>
          <span className="block font-extrabold leading-tight">Cuaderno oficial</span>
          <span className="block text-xs opacity-90">PDF y Excel por comunidad · SIEX</span>
        </Link>
        <Link href="/fertilizacion" className="rounded-2xl bg-white p-3 shadow-sm">
          <span className="text-2xl">🌾</span>
          <span className="block font-extrabold leading-tight text-olivo-900">Fertilización</span>
          <span className="block text-xs text-stone-500">Aplicado vs. máximo por parcela</span>
        </Link>
      </div>
      <SelectorCampana valor={sel} onCambio={setSel} />
      <p className="no-print mb-4 text-[15px] text-stone-600">Se rellena solo con los tratamientos y abonados que registras. No tienes que escribir nada aquí.</p>
      {(pendientes > 0 || sinRegistro.length > 0) && (
        <div className="no-print mb-4 space-y-1 rounded-2xl bg-amber-100 p-3 text-sm text-amber-900">
          {pendientes > 0 && <p>⚠️ {pendientes} línea(s) de partes aún sin validar.</p>}
          {sinRegistro.length > 0 && <p>⚠️ Falta el nº de registro de: {sinRegistro.join(", ")} (Más → Productos).</p>}
        </div>
      )}
      {filas === null ? (
        <Cargando />
      ) : filas.length === 0 ? (
        <Vacio icono="📒" titulo="Cuaderno vacío" texto="Cuando registres un tratamiento o abonado con productos, aparecerá aquí automáticamente.">
          <Boton href="/trabajo">Registrar tratamiento</Boton>
        </Vacio>
      ) : (
        <div className="-mx-4 overflow-x-auto px-4">
          <table className="w-full min-w-[900px] border-collapse rounded-2xl bg-white text-sm shadow-sm">
            <thead>
              <tr className="bg-olivo-800 text-left text-white">
                {COLS.map(([k, t]) => (
                  <th key={k} className="px-2 py-2 font-semibold">
                    {t}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filas.map((f, i) => (
                <tr key={i} className={`border-b border-stone-100 ${f.estado === "pendiente" ? "bg-amber-50" : ""}`}>
                  {COLS.map(([k]) => (
                    <td key={k} className="px-2 py-1.5">
                      {k === "fecha" ? fechaCorta(f[k]) : typeof f[k] === "number" ? num(f[k], 3) : k === "referencia_sigpac" && String(f[k]).includes("?") ? "—" : f[k] ?? "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Pagina>
  );
}
