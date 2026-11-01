export const euros = (n) =>
  n == null || isNaN(n) ? "—" : Number(n).toLocaleString("es-ES", { style: "currency", currency: "EUR" });

export const num = (n, dec = 2) =>
  n == null || isNaN(n) ? "—" : Number(n).toLocaleString("es-ES", { maximumFractionDigits: dec });

export const ha = (n) => (n == null ? "—" : `${num(n, 2)} ha`);

export const fechaCorta = (f) =>
  f ? new Date(f.length === 10 ? f + "T12:00:00" : f).toLocaleDateString("es-ES", { day: "numeric", month: "short" }) : "—";

export const fechaLarga = (f) => {
  const t = f
    ? new Date(f.length === 10 ? f + "T12:00:00" : f).toLocaleDateString("es-ES", {
        weekday: "long",
        day: "numeric",
        month: "long",
      })
    : "—";
  return t.charAt(0).toUpperCase() + t.slice(1);
};

export const hora = (f) => (f ? new Date(f).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) : "—");

export const hoyISO = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

export function saludo() {
  const h = new Date().getHours();
  return h < 13 ? "Buenos días" : h < 21 ? "Buenas tardes" : "Buenas noches";
}

export function duracion(desde, hasta = new Date()) {
  const ms = new Date(hasta) - new Date(desde);
  const m = Math.max(0, Math.round(ms / 60000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** Nombre legible de un recinto: "La Mesa P1" o "La Mesa P1 · rec. 2" */
export function nombreRecinto(r, total = 1) {
  if (!r) return "—";
  const p = r.parcela_nombre || r.parcelas?.nombre || "Recinto";
  return total > 1 && r.recinto_sigpac ? `${p} · rec. ${r.recinto_sigpac}` : p;
}

export const USOS_SIGPAC = {
  OV: "Olivar", FS: "Frutos secos", FY: "Frutales", VI: "Viñedo", TA: "Tierra arable", TH: "Huerta",
  CI: "Cítricos", PS: "Pastizal", PR: "Pasto arbustivo", PA: "Pasto arbolado", FO: "Forestal",
  IM: "Improductivo", CA: "Viales", ED: "Edificaciones", AG: "Agua", ZU: "Zona urbana",
  OF: "Olivar-frutal", OC: "Olivar-cítricos", FL: "Frutos secos y olivar", FV: "Frutal-viñedo",
};

export const CULTIVO_POR_USO = { OV: "Olivar", VI: "Viñedo", CI: "Cítricos", FY: "Frutales", TA: "Cereal", TH: "Hortícolas", FS: "Almendro" };
