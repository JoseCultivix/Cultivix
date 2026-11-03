// Comunidades autónomas: nombre del registro de explotaciones y del cuaderno
// digital oficial, con enlace a la información pública de cada una.
// El contenido mínimo del cuaderno es común en toda España (RD 1311/2012
// anexo III, RD 1051/2022 y RD 1054/2022 / Orden APA/204/2023); cada
// comunidad publica su propio modelo con esa estructura.
export const CCAA = [
  { id: "andalucia", nombre: "Andalucía", rea: "REAFA", cue: "CUE digital (Sga-Pec)", web: "https://www.juntadeandalucia.es/organismos/agriculturapescaaguaydesarrollorural/areas/agricultura/cuaderno-explotacion.html" },
  { id: "aragon", nombre: "Aragón", rea: "REA de Aragón", cue: "Cuaderno digital (CUE)", web: "https://www.aragon.es/pac-2026/cuaderno-digital-cue" },
  { id: "asturias", nombre: "Principado de Asturias", rea: "REA de Asturias", cue: "Cuaderno digital (CUE)", web: "https://sga.asturias.es/SgaPec" },
  { id: "baleares", nombre: "Illes Balears", rea: "REA de les Illes Balears", cue: "Quadern digital d'explotació agrícola", web: "https://www.caib.es/sites/quadernagrari/es/cuaderno_digital_de_explotacion_agricola/" },
  { id: "canarias", nombre: "Canarias", rea: "REA de Canarias", cue: "Cuaderno digital (CUE)", web: "https://www.gobiernodecanarias.org/SgaPec" },
  { id: "cantabria", nombre: "Cantabria", rea: "REA de Cantabria", cue: "Cuaderno digital (CUE)", web: "https://sgapac.cantabria.es/SgaPec/" },
  { id: "castilla_leon", nombre: "Castilla y León", rea: "REA de Castilla y León", cue: "Cuecyl", web: "https://agriculturaganaderia.jcyl.es/web/es/cuaderno-digital-explotacion-agricola.html" },
  { id: "castilla_la_mancha", nombre: "Castilla-La Mancha", rea: "REA de Castilla-La Mancha", cue: "SGA_CEX", web: "https://apliagri.castillalamancha.es/cuaderno-digital-y-registro-de-explotaciones-agricolas" },
  { id: "cataluna", nombre: "Cataluña", rea: "REA de Catalunya", cue: "Quadern digital d'explotació", web: "https://qie.agricultura.gencat.cat/api/IUWS/" },
  { id: "valenciana", nombre: "Comunitat Valenciana", rea: "REA de la Comunitat Valenciana", cue: "Cuaderno de explotación (GVA)", web: "https://portalagrari.gva.es/" },
  { id: "extremadura", nombre: "Extremadura", rea: "REA de Extremadura", cue: "Cuaderno digital (CUE)", web: "https://www.fega.gob.es/es/siex/acceso-a-a-rea-y-cue" },
  { id: "galicia", nombre: "Galicia", rea: "REAGA", cue: "XEAGA", web: "https://www.xunta.gal/dog/Publicados/2024/20240508/AnuncioG0426-300424-0005_es.html" },
  { id: "madrid", nombre: "Comunidad de Madrid", rea: "REA de la Comunidad de Madrid", cue: "Cuaderno digital (CUE)", web: "https://www.comunidad.madrid/servicios/medio-rural/sanidad-produccion-vegetal" },
  { id: "murcia", nombre: "Región de Murcia", rea: "REA de la Región de Murcia", cue: "Cuaderno digital (CUE)", web: "https://www.fega.gob.es/es/siex/acceso-a-a-rea-y-cue" },
  { id: "navarra", nombre: "Comunidad Foral de Navarra", rea: "REA de Navarra", cue: "Cuaderno digital (CUE)", web: "https://pac.navarra.es/" },
  { id: "pais_vasco", nombre: "País Vasco", rea: "REA de Euskadi", cue: "Cuaderno Digital de Explotación Agrícola", web: "https://www.euskadi.eus/cuaderno-digital-explotacion-agricola/web01-tramite/es/" },
  { id: "la_rioja", nombre: "La Rioja", rea: "REA de La Rioja", cue: "Cuaderno digital (CUE)", web: "https://www.larioja.org/agricultura/es/gestion-explotaciones/cuaderno-digital-explotacion-agricola-cue" },
  { id: "ceuta", nombre: "Ceuta", rea: "REA de Ceuta", cue: "Cuaderno digital (CUE)", web: "https://www.fega.gob.es/es/siex/acceso-a-a-rea-y-cue" },
  { id: "melilla", nombre: "Melilla", rea: "REA de Melilla", cue: "Cuaderno digital (CUE)", web: "https://www.fega.gob.es/es/siex/acceso-a-a-rea-y-cue" },
];

const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z]/g, "");

// Acepta el id o el nombre guardado en empresas.comunidad_autonoma
export function ccaaDe(valor) {
  const v = norm(valor);
  if (!v) return null;
  return CCAA.find((c) => norm(c.id) === v || norm(c.nombre) === v || norm(c.nombre).includes(v) || v.includes(norm(c.nombre))) || null;
}

// Provincia SIGPAC (código INE) → comunidad
const PROV = {
  andalucia: [4, 11, 14, 18, 21, 23, 29, 41], aragon: [22, 44, 50], asturias: [33], baleares: [7], canarias: [35, 38], cantabria: [39],
  castilla_leon: [5, 9, 24, 34, 37, 40, 42, 47, 49], castilla_la_mancha: [2, 13, 16, 19, 45], cataluna: [8, 17, 25, 43], valenciana: [3, 12, 46],
  extremadura: [6, 10], galicia: [15, 27, 32, 36], madrid: [28], murcia: [30], navarra: [31], pais_vasco: [1, 20, 48], la_rioja: [26], ceuta: [51], melilla: [52],
};
export function ccaaDeProvincia(cod) {
  const n = Number(cod);
  const id = Object.keys(PROV).find((k) => PROV[k].includes(n));
  return id ? CCAA.find((c) => c.id === id) : null;
}

export const METODOS = {
  abonadora: "Abonadora", fertirrigacion: "Fertirrigación", foliar: "Foliar", localizado: "Localizado", enterrado: "Enterrado",
  cuba: "Cuba", pulverizacion: "Pulverización", espolvoreo: "Espolvoreo", otro: "Otro",
};
export const CARNES = { basico: "Básico", cualificado: "Cualificado", fumigador: "Fumigador", piloto: "Piloto" };
