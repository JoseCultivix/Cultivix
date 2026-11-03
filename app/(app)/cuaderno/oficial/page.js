"use client";
import { useEffect, useMemo, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { Boton, Cargando, Campo, Pagina, Select, Tarjeta } from "@/components/ui";
import { CCAA, ccaaDe, ccaaDeProvincia } from "@/lib/ccaa";
import { cargarCuadernoOficial, descargarExcel } from "@/lib/cuadernoOficial";
import { fechaCorta, num } from "@/lib/formato";

const n2 = (x) => (x == null || x === "" ? "" : num(x, 2));

export default function CuadernoOficial() {
  const { empresaId, empresa, recintos, campanas, notificar } = useApp();
  const anioActual = new Date().getFullYear();
  const periodos = useMemo(
    () => [
      ...[anioActual, anioActual - 1].map((a) => ({ id: `a${a}`, nombre: `Año ${a}`, desde: `${a}-01-01`, hasta: `${a}-12-31` })),
      ...campanas.map((c) => ({ id: c.id, nombre: `Campaña ${c.nombre}`, desde: c.fecha_inicio, hasta: c.fecha_fin })),
    ],
    [campanas, anioActual],
  );
  const [periodoId, setPeriodoId] = useState(`a${anioActual}`);
  const periodo = periodos.find((p) => p.id === periodoId) || periodos[0];
  const [ccaaId, setCcaaId] = useState("");
  const [d, setD] = useState(null);
  const [error, setError] = useState(null);
  const [excel, setExcel] = useState(false);

  useEffect(() => {
    if (ccaaId) return;
    const c = ccaaDe(empresa?.comunidad_autonoma) || ccaaDeProvincia(recintos.find((r) => r.provincia_sigpac)?.provincia_sigpac);
    if (c) setCcaaId(c.id);
  }, [empresa?.comunidad_autonoma, recintos]); // eslint-disable-line
  const ccaa = CCAA.find((c) => c.id === ccaaId);

  useEffect(() => {
    setD(null);
    setError(null);
    cargarCuadernoOficial({ empresaId, desde: periodo.desde, hasta: periodo.hasta })
      .then(setD)
      .catch((e) => setError(e.message));
  }, [empresaId, periodo.desde, periodo.hasta]);

  async function bajarExcel() {
    setExcel(true);
    try {
      await descargarExcel(d, { ccaa, periodo: periodo.nombre });
    } catch (e) {
      notificar("No se pudo generar el Excel: " + e.message, "error");
    }
    setExcel(false);
  }

  return (
    <Pagina titulo="Cuaderno oficial" subtitulo="Modelo de cuaderno de explotación para inspecciones y para tu técnico" volver="/cuaderno">
      <div className="no-print">
        <Tarjeta className="grid grid-cols-2 gap-3">
          <Campo etiqueta="Comunidad autónoma">
            <Select vacio="Elige…" opciones={CCAA.map((c) => ({ value: c.id, label: c.nombre }))} value={ccaaId} onChange={(e) => setCcaaId(e.target.value)} />
          </Campo>
          <Campo etiqueta="Periodo">
            <Select vacio={null} opciones={periodos.map((p) => ({ value: p.id, label: p.nombre }))} value={periodoId} onChange={(e) => setPeriodoId(e.target.value)} />
          </Campo>
          <div className="col-span-2 flex flex-wrap gap-2">
            <Boton disabled={!d || !ccaa} onClick={() => window.print()}>
              🖨️ PDF / imprimir
            </Boton>
            <Boton variante="secundario" disabled={!d || !ccaa || excel} onClick={bajarExcel}>
              {excel ? "Generando…" : "📊 Excel"}
            </Boton>
          </div>
          {ccaa && (
            <p className="col-span-2 text-xs text-stone-500">
              Estructura del modelo oficial (RD 1311/2012, RD 1051/2022 y Orden APA/204/2023), con los datos y el registro de {ccaa.nombre} ({ccaa.rea}).{" "}
              <a href={ccaa.web} target="_blank" rel="noopener noreferrer" className="font-semibold underline">
                Información oficial de {ccaa.nombre}
              </a>
            </p>
          )}
        </Tarjeta>

        {d?.avisos?.length > 0 && (
          <div className="mt-3 rounded-2xl bg-amber-100 p-3 text-sm text-amber-900">
            <p className="mb-1 font-bold">Antes de presentarlo, completa:</p>
            <ul className="space-y-1">
              {d.avisos.map((a, i) => (
                <li key={i}>
                  • {a.texto}{" "}
                  <a href={a.enlace} className="font-bold underline">
                    Ir
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
        {d && d.avisos.length === 0 && <p className="mt-3 rounded-2xl bg-olivo-100 p-3 text-sm font-semibold text-olivo-900">✓ No falta ningún dato obligatorio de los que Cultivix puede comprobar.</p>}

        <SiexInfo ccaa={ccaa} empresa={d?.empresa} />
      </div>

      {error && <p className="mt-4 text-red-700">{error}</p>}
      {!d && !error && <Cargando />}
      {d && ccaa && <Documento d={d} ccaa={ccaa} periodo={periodo} />}
      <style>{`@media print { @page { size: A4 landscape; margin: 10mm; } .print-full > header { display: none; } .doc-oficial { font-size: 9px; } .doc-oficial table { page-break-inside: auto; } .doc-oficial tr { page-break-inside: avoid; } .doc-oficial h2 { page-break-after: avoid; } }`}</style>
    </Pagina>
  );
}

function SiexInfo({ ccaa }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <Tarjeta className="mt-3 !p-3">
      <button type="button" className="flex w-full items-center justify-between text-left" onClick={() => setAbierto(!abierto)}>
        <span>
          <b className="text-olivo-900">Conexión con el SIEX</b>
          <span className="block text-sm text-stone-500">Envío automático al cuaderno digital oficial · en preparación</span>
        </span>
        <span className="text-xl">{abierto ? "−" : "+"}</span>
      </button>
      {abierto && (
        <div className="mt-2 space-y-2 text-sm text-stone-700">
          <p>
            Desde el 1 de enero de 2027 los tratamientos fitosanitarios se deben anotar en formato digital. Puedes hacerlo en el cuaderno gratuito de tu comunidad o en uno comercial conectado al SIEX a través del registro autonómico ({ccaa?.rea || "REA"}).
          </p>
          <p>
            Para que Cultivix envíe los datos directamente, Cultivix tiene que darse de alta como <b>empresa desarrolladora de cuaderno comercial</b> en cada comunidad y firmar los envíos con un certificado de empresa. Lo haremos cuando la empresa esté constituida.
          </p>
          <p>
            <b>Mientras tanto:</b> descarga el Excel o el PDF y pásaselo a tu técnico o entidad gestora, o úsalo para copiar los datos en el cuaderno de tu comunidad. Cultivix ya guarda todos los datos con la estructura que pide el SIEX, así que cuando se active la conexión no tendrás que volver a meter nada.
          </p>
          {ccaa && (
            <a href={ccaa.web} target="_blank" rel="noopener noreferrer" className="inline-block font-bold text-olivo-700 underline">
              Cuaderno oficial de {ccaa.nombre}: {ccaa.cue}
            </a>
          )}
        </div>
      )}
    </Tarjeta>
  );
}

function Tabla({ cols, filas, vacio = "Sin registros en este periodo." }) {
  if (!filas.length) return <p className="mb-2 italic text-stone-500">{vacio}</p>;
  return (
    <div className="-mx-4 overflow-x-auto px-4 print:mx-0 print:overflow-visible print:px-0">
      <table className="mb-2 w-full min-w-[820px] border-collapse bg-white text-[12px] print:min-w-0 print:text-[9px]">
        <thead>
          <tr className="bg-olivo-800 text-left text-white print:bg-stone-200 print:text-black">
            {cols.map(([, t]) => (
              <th key={t} className="border border-stone-300 px-1.5 py-1 font-semibold">
                {t}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filas.map((f, i) => (
            <tr key={i}>
              {cols.map(([k, t, fmt]) => (
                <td key={t} className="border border-stone-200 px-1.5 py-1 align-top">
                  {fmt ? fmt(f) : f[k] ?? ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Documento({ d, ccaa, periodo }) {
  const e = d.empresa;
  const H = ({ children }) => <h2 className="mb-1 mt-5 text-base font-extrabold text-olivo-900 print:mt-3 print:text-[11px]">{children}</h2>;
  return (
    <div className="doc-oficial mt-5">
      <div className="mb-3 border-b-2 border-olivo-800 pb-2">
        <p className="text-xs font-bold uppercase text-stone-500">
          {ccaa.nombre} · {ccaa.rea}
        </p>
        <h1 className="text-xl font-black text-olivo-900 print:text-[14px]">Cuaderno de explotación agrícola · {periodo.nombre}</h1>
        <p className="text-xs text-stone-500">
          Del {fechaCorta(periodo.desde)} {periodo.desde.slice(0, 4)} al {fechaCorta(periodo.hasta)} {periodo.hasta.slice(0, 4)} · Generado con Cultivix el {new Date().toLocaleDateString("es-ES")}
        </p>
      </div>

      <H>1. Información general</H>
      <div className="grid grid-cols-2 gap-x-6 text-[13px] print:text-[9px] sm:grid-cols-3">
        <p>
          <b>Titular:</b> {e.nombre}
        </p>
        <p>
          <b>NIF:</b> {e.nif || "—"}
        </p>
        <p>
          <b>Código REA / SIEX:</b> {e.codigo_rea || "—"}
        </p>
        <p className="col-span-2">
          <b>Dirección:</b> {[e.direccion, e.codigo_postal, e.municipio, e.provincia].filter(Boolean).join(", ") || "—"}
        </p>
        <p>
          <b>Teléfono:</b> {e.telefono || "—"}
        </p>
      </div>
      <p className="mt-2 text-[13px] font-bold print:text-[9px]">1.2 Personas que intervienen en los tratamientos</p>
      <Tabla cols={[["orden", "Nº"], ["nombre", "Nombre y apellidos"], ["nif", "NIF"], ["ropo", "Nº ROPO"], ["carne", "Carné"]]} filas={d.personas} vacio="Sin aplicadores registrados." />
      <p className="text-[13px] font-bold print:text-[9px]">1.3 Equipos de aplicación</p>
      <Tabla cols={[["orden", "Nº"], ["nombre", "Equipo"], ["roma", "Nº ROMA"], ["inspeccion", "Última inspección", (f) => (f.inspeccion ? new Date(f.inspeccion + "T12:00").toLocaleDateString("es-ES") : "")]]} filas={d.equipos} vacio="Sin equipos registrados." />
      <p className="text-[13px] font-bold print:text-[9px]">1.4 Asesor</p>
      <Tabla cols={[["nombre", "Nombre"], ["nif", "NIF"], ["numero_ropo", "Nº ROPO"], ["ambito", "Ámbito"], ["entidad", "Entidad"]]} filas={d.asesores} vacio="Sin asesor." />

      <H>2. Identificación de las parcelas</H>
      <Tabla
        cols={[
          ["orden", "Nº"], ["parcela", "Nombre"], ["provincia", "Prov."], ["municipio", "Mun."], ["agregado", "Agr."], ["zona", "Zona"], ["poligono", "Pol."], ["parcela_sigpac", "Parc."], ["recinto", "Rec."], ["uso", "Uso"],
          ["superficie_sigpac", "Sup. SIGPAC (ha)", (f) => n2(f.superficie_sigpac)], ["superficie_cultivada", "Sup. cultivada (ha)", (f) => n2(f.superficie_cultivada)], ["cultivo", "Cultivo"], ["variedad", "Variedad"], ["regadio", "Secano / regadío"], ["zona_vulnerable", "Z. vulnerable"],
        ]}
        filas={d.parcelas}
      />

      <H>3. Registro de tratamientos fitosanitarios</H>
      <Tabla
        cols={[
          ["fecha", "Fecha", (f) => new Date(f.fecha + "T12:00").toLocaleDateString("es-ES")], ["parcelas_orden", "Parcelas (nº)"], ["cultivo", "Cultivo"], ["superficie", "Sup. tratada (ha)", (f) => n2(f.superficie)], ["plaga_o_motivo", "Problema fitosanitario"],
          ["aplicador_orden", "Aplicador (nº)"], ["equipo_orden", "Equipo (nº)"], ["producto", "Producto"], ["numero_registro", "Nº registro"], ["dosis_ha", "Dosis", (f) => `${n2(f.dosis_ha)} ${f.unidad_dosis || ""}`], ["eficacia", "Eficacia"], ["justificacion", "Observaciones", (f) => [f.metodo, f.justificacion, f.asesor].filter(Boolean).join(" · ")],
        ]}
        filas={d.tratamientos}
      />

      <H>4. Fertilización</H>
      {d.planes.length > 0 && (
        <>
          <p className="text-[13px] font-bold print:text-[9px]">4.1 Plan de abonado</p>
          <Tabla
            cols={[
              ["c", "Campaña", (f) => f.campanas?.nombre], ["a", "Ámbito", (f) => (f.recintos ? f.recintos.parcelas?.nombre : "Todo el cultivo")], ["rendimiento_esperado_kg_ha", "Rend. esperado (kg/ha)"], ["cultivo_precedente", "Cultivo precedente"],
              ["n_kg_ha", "N (kg/ha)"], ["p2o5_kg_ha", "P₂O₅ (kg/ha)"], ["k2o_kg_ha", "K₂O (kg/ha)"], ["fecha_elaboracion", "Fecha", (f) => new Date(f.fecha_elaboracion + "T12:00").toLocaleDateString("es-ES")], ["s", "Asesor", (f) => f.asesores?.nombre || ""],
            ]}
            filas={d.planes}
          />
        </>
      )}
      <p className="text-[13px] font-bold print:text-[9px]">4.2 Aportes de nutrientes</p>
      <Tabla
        cols={[
          ["fecha", "Fecha", (f) => new Date(f.fecha + "T12:00").toLocaleDateString("es-ES")], ["parcelas_orden", "Parcelas (nº)"], ["cultivo", "Cultivo"], ["superficie", "Sup. (ha)", (f) => n2(f.superficie)], ["producto", "Producto / abono"],
          ["riqueza", "Riqueza N-P-K"], ["dosis_ha", "Dosis", (f) => `${n2(f.dosis_ha)} ${f.unidad_dosis || ""}`], ["n_ha", "N kg/ha", (f) => n2(f.n_ha)], ["p_ha", "P₂O₅ kg/ha", (f) => n2(f.p_ha)], ["k_ha", "K₂O kg/ha", (f) => n2(f.k_ha)], ["metodo", "Método"],
        ]}
        filas={d.fertilizacion}
      />

      <H>5. Cosecha comercializada</H>
      <Tabla
        cols={[
          ["fecha", "Fecha", (f) => new Date(f.fecha + "T12:00").toLocaleDateString("es-ES")], ["parcelas_orden", "Parcelas (nº)"], ["cultivo", "Producto"], ["calidad", "Calidad"], ["kilos_netos", "Cantidad (kg)", (f) => num(f.kilos_netos, 0)],
          ["numero_ticket", "Nº albarán / ticket"], ["destino", "Cliente"], ["destino_nif", "NIF cliente"],
        ]}
        filas={d.cosecha}
      />

      <div className="mt-8 grid grid-cols-2 gap-8 text-[13px] print:text-[9px]">
        <div className="border-t border-stone-400 pt-1">Firma del titular</div>
        <div className="border-t border-stone-400 pt-1">Firma del asesor (si procede) · Nº ROPO</div>
      </div>
    </div>
  );
}
