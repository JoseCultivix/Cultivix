"use client";
import { useApp } from "./AppProvider";

/** Fichas para elegir campaña. valor: id de campaña o "activas" (todas las campañas en curso). */
export default function SelectorCampana({ valor, onCambio, permitirActivas = true }) {
  const { campanas } = useApp();
  const ops = [
    ...(permitirActivas ? [{ id: "activas", nombre: "Campañas en curso" }] : []),
    ...campanas.map((c) => ({ id: c.id, nombre: c.nombre, activa: c.activa })),
  ];
  return (
    <div className="no-print -mx-4 mb-4 flex gap-2 overflow-x-auto px-4">
      {ops.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onCambio(c.id)}
          className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold ${valor === c.id ? "bg-olivo-700 text-white" : "bg-white text-stone-700"}`}
        >
          {c.nombre}
          {c.activa && valor !== c.id ? " ●" : ""}
        </button>
      ))}
    </div>
  );
}

/** Devuelve la lista de campañas que corresponden a la selección. */
export function campanasSeleccionadas(campanas, valor) {
  return valor === "activas" ? campanas.filter((c) => c.activa) : campanas.filter((c) => c.id === valor);
}
