"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { evaluar, fichaRegistro, usosRegistro } from "@/lib/fitos";

/**
 * Comprueba un producto fitosanitario contra el Registro del MAPA para los cultivos
 * de los recintos elegidos. Muestra autorización, dosis y plazo de seguridad.
 */
export default function ComprobacionFito({ producto, recintos, cultivos, dosisHa, caldoHa, plaga, fecha, online = true }) {
  const [res, setRes] = useState(null);
  const grupos = {};
  for (const r of recintos) {
    const c = cultivos.find((x) => x.id === r.cultivo_id);
    if (!c) continue;
    const k = c.codigo_mapa || `sin:${c.id}`;
    grupos[k] = grupos[k] || { codigo: c.codigo_mapa, cultivo: c.nombre };
  }
  const codigos = Object.values(grupos).map((g) => g.codigo).filter(Boolean);
  const clave = `${producto?.numero_registro}|${codigos.join(",")}`;

  useEffect(() => {
    let vivo = true;
    if (!producto?.numero_registro || !online) return setRes(null);
    Promise.all([fichaRegistro(producto.numero_registro), codigos.length ? usosRegistro(producto.numero_registro, codigos) : []])
      .then(([ficha, usos]) => vivo && setRes({ ficha, usos }))
      .catch(() => vivo && setRes({ error: true }));
    return () => {
      vivo = false;
    };
  }, [clave, online]); // eslint-disable-line

  if (!producto || !["fitosanitario", "herbicida"].includes(producto.tipo)) return null;
  if (!producto.numero_registro)
    return (
      <p className="mt-1 rounded-lg bg-amber-50 px-2 py-1 text-xs text-amber-900">
        Sin nº de registro: no se puede comprobar en el Registro del MAPA.{" "}
        <Link href="/productos" className="font-bold underline">
          Añadirlo
        </Link>
      </p>
    );
  if (!online) return <p className="mt-1 text-xs text-stone-500">Sin cobertura: se comprobará en el Registro cuando haya conexión.</p>;
  if (!res) return <p className="mt-1 text-xs text-stone-500">Comprobando en el Registro del MAPA…</p>;
  if (res.error) return <p className="mt-1 text-xs text-stone-500">No se ha podido consultar el Registro ahora.</p>;
  if (!res.ficha)
    return <p className="mt-1 rounded-lg bg-red-50 px-2 py-1 text-xs font-semibold text-red-800">⚠️ El nº {producto.numero_registro} no aparece en el Registro del MAPA. Revisa la etiqueta.</p>;

  const filas = Object.values(grupos);
  if (!filas.length) return <p className="mt-1 text-xs text-stone-500">Elige la parcela para comprobar si está autorizado en su cultivo.</p>;

  return (
    <div className="mt-1 space-y-1">
      {filas.map((g) => {
        if (!g.codigo)
          return (
            <p key={g.cultivo} className="rounded-lg bg-stone-100 px-2 py-1 text-xs text-stone-600">
              {g.cultivo}: este cultivo no está enlazado con el Registro.
            </p>
          );
        const e = evaluar({ usos: res.usos.filter((u) => u.codigo_cultivo === g.codigo), ficha: res.ficha, dosisHa, caldoHa, plaga, fecha });
        const mal = e.estado === "no_autorizado" || e.dosis === "alta" || e.avisos.some((a) => /cancelada|caduc/i.test(a));
        return (
          <div key={g.codigo} className={`rounded-lg px-2 py-1.5 text-xs ${mal ? "bg-red-50 text-red-900" : e.avisos.length ? "bg-amber-50 text-amber-900" : "bg-olivo-50 text-olivo-900"}`}>
            <p className="font-bold">
              {mal ? "⚠️" : e.avisos.length ? "⚠️" : "✓"} {g.cultivo}:{" "}
              {e.estado === "no_autorizado" ? "no autorizado" : e.estado === "parcial" ? "autorizado solo en parte" : "autorizado"}
              {e.plazoDias != null && e.estado !== "no_autorizado" ? ` · plazo de seguridad ${e.plazoDias} días` : e.plazoTexto ? ` · plazo: ${e.plazoTexto}` : ""}
            </p>
            {e.estado !== "no_autorizado" && (
              <p>
                {e.dosisTexto ? `Dosis de etiqueta: ${e.dosisTexto}` : ""}
                {e.dosis === "ok" ? " ✓" : ""}
                {e.dosis === "falta_caldo" ? " · indica el caldo (l/ha) para comprobarla" : ""}
                {e.aplicaciones ? ` · ${e.aplicaciones} aplicaciones` : ""}
              </p>
            )}
            {e.avisos.map((a, i) => (
              <p key={i}>{a}</p>
            ))}
            {e.ok.map((a, i) => (
              <p key={`n${i}`}>{a}</p>
            ))}
          </div>
        );
      })}
      <p className="text-[11px] text-stone-500">Registro del MAPA · revisa siempre la etiqueta del producto.</p>
    </div>
  );
}
