"use client";
// Reduce las fotos del móvil (5-10 MB) a ~300 KB antes de subirlas: menos datos en el campo.
export async function comprimirImagen(file, maxLado = 1600, calidad = 0.82) {
  if (!file.type.startsWith("image/")) return { blob: file, tipo: file.type };
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const escala = Math.min(1, maxLado / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * escala);
    c.height = Math.round(img.height * escala);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise((res) => c.toBlob(res, "image/jpeg", calidad));
    return { blob, tipo: "image/jpeg" };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function blobABase64(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1]);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
}
