// Consulta al Servicio de Consultas SIGPAC del FEGA (sigpac-hubcloud.es).
// Evita que el agricultor teclee superficies, usos o linderos (DEC-031).
//   ?pr=23&mu=50&po=12&pa=345[&ag=0&zo=0]  → todos los recintos de la parcela
//   ?lat=37.9&lon=-3.7                     → recinto en ese punto (GPS)
import { clienteDelUsuario, respuestaError } from "@/lib/servidor";
import { BASE, n, normalizar, pedir, porParcela } from "@/lib/sigpac";

export async function GET(req) {
  try {
    await clienteDelUsuario(req); // solo usuarios registrados
    const q = new URL(req.url).searchParams;
    let recintos = [];
    if (q.get("lat") && q.get("lon")) {
      const lat = Number(q.get("lat")), lon = Number(q.get("lon"));
      // 1) referencia del recinto en el punto  2) datos completos de toda su parcela
      let ref = null;
      try {
        const j = await pedir(`${BASE}/recinfobypoint/4326/${lon}/${lat}.json`);
        const it = normalizar(j)[0];
        if (it) ref = it;
      } catch {}
      if (!ref) {
        const j = await pedir(`${BASE}/refrecinbycoord/4326/${lon}/${lat}.json`);
        const p = Array.isArray(j) ? j[0] : j;
        if (p) ref = { provincia: n(p.provincia), municipio: n(p.municipio), agregado: n(p.agregado) ?? 0, zona: n(p.zona) ?? 0, poligono: n(p.poligono), parcela: n(p.parcela), recinto: n(p.recinto) };
      }
      if (!ref?.parcela) return Response.json({ recintos: [], aviso: "No hay recinto SIGPAC en este punto" });
      recintos = await porParcela(ref);
      return Response.json({ recintos, recinto_en_punto: ref.recinto });
    }
    const ref = { provincia: n(q.get("pr")), municipio: n(q.get("mu")), agregado: n(q.get("ag")) ?? 0, zona: n(q.get("zo")) ?? 0, poligono: n(q.get("po")), parcela: n(q.get("pa")) };
    if ([ref.provincia, ref.municipio, ref.poligono, ref.parcela].some((x) => x == null || isNaN(x))) return Response.json({ error: "Indica provincia, municipio, polígono y parcela" }, { status: 400 });
    recintos = await porParcela(ref);
    if (!recintos.length) return Response.json({ recintos: [], aviso: "SIGPAC no devuelve recintos para esa referencia" });
    return Response.json({ recintos });
  } catch (e) {
    return respuestaError(e);
  }
}

