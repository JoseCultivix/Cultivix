"use client";
import { useMemo, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { Campo, Input, Select, Tarjeta, claseInput } from "@/components/ui";
import { CATEGORIAS, categoria, esAlmacen } from "@/lib/compras";
import { nombreRecinto } from "@/lib/formato";

const UNIDADES = ["kg", "l", "ud", "t", "g", "ml"].map((u) => ({ value: u, label: u }));
const n = (x) => (x === "" || x == null ? null : Number(String(x).replace(",", ".")));

/** ¿Los porcentajes, si se han puesto, suman 100? */
export function imputacionValida(imps) {
  const con = (imps || []).filter((i) => n(i.porcentaje) > 0);
  if (!con.length) return true;
  return con.length === imps.length && Math.abs(con.reduce((s, i) => s + n(i.porcentaje), 0) - 100) < 0.6;
}

/**
 * Una línea de compra. Los campos dependen del tipo de gasto:
 * - De almacén (fitosanitarios, abonos, semillas…): producto, lote, cantidad. Su coste llega a la parcela al aplicarlo.
 * - Gastos directos (gasoil, reparaciones, materiales, servicios…): concepto, importe y a qué se imputa.
 */
export default function CompraLinea({ l, onCambio, onQuitar, productos = [] }) {
  const cat = categoria(l.categoria);
  const almacen = esAlmacen(l.categoria);
  const set = (k, v) => {
    const x = { [k]: v };
    if ((k === "cantidad" || k === "precio_unitario") && n(k === "cantidad" ? v : l.cantidad) != null && n(k === "precio_unitario" ? v : l.precio_unitario) != null)
      x.importe = String(Math.round(n(k === "cantidad" ? v : l.cantidad) * n(k === "precio_unitario" ? v : l.precio_unitario) * 100) / 100);
    onCambio(x);
  };
  // Productos del mismo tipo primero
  const opciones = useMemo(
    () => [...productos].sort((a, b) => (b.tipo === l.categoria) - (a.tipo === l.categoria) || a.nombre.localeCompare(b.nombre)),
    [productos, l.categoria]
  );
  const esFito = l.categoria === "fitosanitario" || l.categoria === "herbicida";

  return (
    <Tarjeta className={`!p-3 ${l.ignorar ? "opacity-50" : ""}`}>
      <div className="mb-2 flex items-start justify-between gap-2">
        <p className="text-sm text-stone-500">{l.descripcion_original || (l.id ? "" : "Línea nueva")}</p>
        {onQuitar && (
          <button type="button" className="shrink-0 text-sm font-bold text-red-700" onClick={onQuitar}>
            {l.ignorar ? "Incluir" : "🗑️ Quitar"}
          </button>
        )}
      </div>
      <Campo etiqueta="Tipo de gasto">
        <select className={claseInput} value={l.categoria || "otro"} onChange={(e) => onCambio({ categoria: e.target.value, ...(esAlmacen(e.target.value) ? {} : { producto_id: null }) })}>
          <optgroup label="Van al almacén">
            {CATEGORIAS.filter((c) => c.almacen).map((c) => (
              <option key={c.v} value={c.v}>
                {c.icono} {c.t}
              </option>
            ))}
          </optgroup>
          <optgroup label="Gastos directos">
            {CATEGORIAS.filter((c) => !c.almacen).map((c) => (
              <option key={c.v} value={c.v}>
                {c.icono} {c.t}
              </option>
            ))}
          </optgroup>
        </select>
      </Campo>

      {almacen ? (
        <div className="mt-2 space-y-2">
          <select className={claseInput} value={l.producto_id || ""} onChange={(e) => onCambio({ producto_id: e.target.value || null })}>
            <option value="">➕ Producto nuevo{l.producto_nombre ? `: ${l.producto_nombre}` : ""}</option>
            {opciones.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </select>
          {!l.producto_id && <Input value={l.producto_nombre || ""} placeholder="Nombre comercial del producto" onChange={(e) => onCambio({ producto_nombre: e.target.value })} />}
          <div className="grid grid-cols-3 gap-2">
            <Campo etiqueta="Cantidad">
              <Input inputMode="decimal" value={l.cantidad ?? ""} onChange={(e) => set("cantidad", e.target.value)} />
            </Campo>
            <Campo etiqueta="Unidad">
              <Select vacio={null} opciones={UNIDADES} value={l.unidad || "kg"} onChange={(e) => onCambio({ unidad: e.target.value })} />
            </Campo>
            <Campo etiqueta="Importe €">
              <Input inputMode="decimal" value={l.importe ?? ""} onChange={(e) => onCambio({ importe: e.target.value })} />
            </Campo>
          </div>
          <Campo etiqueta={esFito ? "Lote (lo pide el cuaderno de campo)" : "Lote (opcional)"}>
            <Input value={l.lote || ""} placeholder="Viene impreso en el envase o en el albarán" onChange={(e) => onCambio({ lote: e.target.value })} />
          </Campo>
          <p className="text-xs text-stone-500">📦 Va al almacén. Su coste se imputa a cada parcela cuando lo apliques en un parte.</p>
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          <Campo etiqueta="Concepto">
            <Input value={l.descripcion || ""} placeholder={cat.v === "gasoil" ? "Gasoil B" : cat.v === "reparacion" ? "Cambio de embrague" : "Descripción"} onChange={(e) => onCambio({ descripcion: e.target.value })} />
          </Campo>
          <div className="grid grid-cols-3 gap-2">
            <Campo etiqueta="Cantidad">
              <Input inputMode="decimal" value={l.cantidad ?? ""} placeholder="—" onChange={(e) => set("cantidad", e.target.value)} />
            </Campo>
            <Campo etiqueta="Unidad">
              <Select vacio="—" opciones={UNIDADES} value={l.unidad || ""} onChange={(e) => onCambio({ unidad: e.target.value })} />
            </Campo>
            <Campo etiqueta="Importe €">
              <Input inputMode="decimal" value={l.importe ?? ""} onChange={(e) => onCambio({ importe: e.target.value })} />
            </Campo>
          </div>
          <Imputacion valor={l.imputaciones || []} onCambio={(v) => onCambio({ imputaciones: v })} destino={cat.destino} />
        </div>
      )}
    </Tarjeta>
  );
}

const TIPOS_DESTINO = [
  ["parcela", "🌳 Parcelas"],
  ["finca", "🏡 Finca"],
  ["maquinaria", "🚜 Máquina"],
  ["apero", "🔧 Apero"],
  ["general", "🏢 General"],
];

/** A qué se imputa un gasto: una o varias parcelas, fincas, máquinas, aperos o gasto general (con % opcional). */
export function Imputacion({ valor, onCambio, destino }) {
  const { recintos, maquinaria, aperos } = useApp();
  const [abierto, setAbierto] = useState(null);
  const [manual, setManual] = useState(valor.some((i) => n(i.porcentaje) > 0));
  const fincas = useMemo(() => {
    const m = new Map();
    for (const r of recintos) {
      const id = r.parcelas?.finca_id;
      if (id && !m.has(id)) m.set(id, { id, nombre: r.finca_nombre || "Finca" });
    }
    return [...m.values()];
  }, [recintos]);
  const parcelas = useMemo(() => {
    const m = new Map();
    for (const r of recintos) {
      const p = m.get(r.parcela_id) || { id: r.parcela_id, nombre: r.parcela_nombre, recintos: [] };
      p.recintos.push(r);
      m.set(r.parcela_id, p);
    }
    return [...m.values()];
  }, [recintos]);

  const tiene = (tipo, id) => valor.some((i) => i.tipo === tipo && (tipo === "general" || i.id === id));
  const poner = (lista) => {
    // Al pasar a manual (o con varios destinos) se proponen porcentajes iguales
    if (manual && lista.length) {
      const base = Math.floor((100 / lista.length) * 100) / 100;
      lista = lista.map((x, k) => ({ ...x, porcentaje: k === lista.length - 1 ? Math.round((100 - base * (lista.length - 1)) * 100) / 100 : base }));
    }
    onCambio(lista);
  };
  const alternar = (tipo, id) => poner(tiene(tipo, id) ? valor.filter((i) => !(i.tipo === tipo && i.id === id)) : [...valor, { tipo, id, porcentaje: "" }]);
  const alternarParcela = (p) => {
    const todos = p.recintos.every((r) => tiene("recinto", r.id));
    const sin = valor.filter((i) => !(i.tipo === "recinto" && p.recintos.some((r) => r.id === i.id)));
    poner(todos ? sin : [...sin, ...p.recintos.map((r) => ({ tipo: "recinto", id: r.id, porcentaje: "" }))]);
  };
  const etiqueta = (i) => {
    if (i.tipo === "general") return "🏢 Gasto general";
    if (i.tipo === "finca") return `🏡 ${fincas.find((f) => f.id === i.id)?.nombre || "Finca"}`;
    if (i.tipo === "maquinaria") return `🚜 ${maquinaria.find((m) => m.id === i.id)?.nombre || "Máquina"}`;
    if (i.tipo === "apero") return `🔧 ${aperos.find((m) => m.id === i.id)?.nombre || "Apero"}`;
    const r = recintos.find((x) => x.id === i.id);
    return `🌳 ${r ? nombreRecinto(r, r.n_en_parcela) : "Recinto"}`;
  };
  const suma = valor.reduce((s, i) => s + (n(i.porcentaje) || 0), 0);
  const tipos = new Set(valor.map((i) => (i.tipo === "recinto" || i.tipo === "finca" ? "tierra" : i.tipo === "general" ? "general" : "equipo")));

  const lista =
    abierto === "parcela"
      ? parcelas.map((p) => ({ k: p.id, t: p.nombre + (p.recintos.length > 1 ? ` (${p.recintos.length} recintos)` : ""), on: p.recintos.every((r) => tiene("recinto", r.id)), clic: () => alternarParcela(p) }))
      : abierto === "finca"
      ? fincas.map((f) => ({ k: f.id, t: f.nombre, on: tiene("finca", f.id), clic: () => alternar("finca", f.id) }))
      : abierto === "maquinaria"
      ? maquinaria.map((m) => ({ k: m.id, t: m.nombre, on: tiene("maquinaria", m.id), clic: () => alternar("maquinaria", m.id) }))
      : abierto === "apero"
      ? aperos.map((m) => ({ k: m.id, t: m.nombre, on: tiene("apero", m.id), clic: () => alternar("apero", m.id) }))
      : [];

  return (
    <div className="rounded-xl bg-stone-50 p-2.5">
      <p className="mb-1.5 text-sm font-bold text-stone-700">¿A qué se imputa este gasto?</p>
      <div className="flex flex-wrap gap-1.5">
        {TIPOS_DESTINO.map(([k, t]) => {
          const sugerido = (destino === "equipo" && (k === "maquinaria" || k === "apero")) || (destino === "tierra" && (k === "parcela" || k === "finca")) || (destino === "general" && k === "general");
          return (
            <button
              key={k}
              type="button"
              onClick={() => (k === "general" ? alternar("general", null) : setAbierto(abierto === k ? null : k))}
              className={`rounded-full px-3 py-1.5 text-sm font-bold ${
                abierto === k || (k === "general" && tiene("general")) ? "bg-olivo-700 text-white" : sugerido ? "border-2 border-olivo-300 bg-white text-olivo-800" : "bg-white text-stone-700"
              }`}
            >
              {t}
            </button>
          );
        })}
      </div>
      {abierto && (
        <div className="mt-2 max-h-52 space-y-1 overflow-y-auto rounded-lg bg-white p-1.5">
          {lista.map((x) => (
            <label key={x.k} className="flex items-center gap-2 rounded px-2 py-1.5 text-[15px] active:bg-stone-50">
              <input type="checkbox" className="h-5 w-5 accent-olivo-700" checked={x.on} onChange={x.clic} />
              {x.t}
            </label>
          ))}
          {!lista.length && <p className="p-2 text-sm text-stone-500">No hay ninguno dado de alta.</p>}
        </div>
      )}
      {valor.length > 0 && (
        <div className="mt-2 space-y-1">
          {valor.map((i, k) => (
            <div key={i.tipo + (i.id || "")} className="flex items-center gap-2 rounded-lg bg-white px-2 py-1 text-sm">
              <span className="flex-1">{etiqueta(i)}</span>
              {manual && (
                <span className="flex items-center gap-1">
                  <input
                    inputMode="decimal"
                    className="h-8 w-16 rounded-lg border border-stone-300 px-2 text-right"
                    value={i.porcentaje ?? ""}
                    onChange={(e) => onCambio(valor.map((x, j) => (j === k ? { ...x, porcentaje: e.target.value } : x)))}
                  />
                  %
                </span>
              )}
              <button type="button" aria-label="Quitar" className="font-bold text-stone-500" onClick={() => onCambio(valor.filter((_, j) => j !== k))}>
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
      {valor.length > 1 && (
        <label className="mt-2 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-5 w-5 accent-olivo-700"
            checked={manual}
            onChange={(e) => {
              setManual(e.target.checked);
              if (!e.target.checked) onCambio(valor.map((x) => ({ ...x, porcentaje: "" })));
              else {
                const base = Math.floor((100 / valor.length) * 100) / 100;
                onCambio(valor.map((x, k) => ({ ...x, porcentaje: k === valor.length - 1 ? Math.round((100 - base * (valor.length - 1)) * 100) / 100 : base })));
              }
            }}
          />
          Repartir con porcentajes a mano
        </label>
      )}
      <p className="mt-1.5 text-xs text-stone-500">
        {!valor.length
          ? "Si no eliges nada, cuenta como gasto general."
          : manual
          ? Math.abs(suma - 100) < 0.6
            ? "✓ Suma 100 %."
            : `⚠️ Los porcentajes suman ${Math.round(suma * 100) / 100} %: deben sumar 100.`
          : tipos.size > 1
          ? "Se reparte a partes iguales entre parcelas, máquinas y gasto general; entre parcelas, por hectáreas."
          : tipos.has("tierra")
          ? "Se reparte entre las parcelas por hectáreas."
          : tipos.has("equipo")
          ? "Si hay varios equipos, a partes iguales. Después se reparte entre parcelas según las horas que trabajen."
          : "Se muestra aparte, como gasto general de la empresa."}
      </p>
    </div>
  );
}
