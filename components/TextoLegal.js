import Link from "next/link";

export function PaginaLegal({ titulo, actualizado, children }) {
  return (
    <main className="mx-auto max-w-2xl px-5 py-8 text-[15px] leading-relaxed text-stone-800">
      <Link href="/" className="text-sm font-semibold text-olivo-700">
        ← Volver a Cultivix
      </Link>
      <h1 className="mt-3 text-3xl font-black text-olivo-900">{titulo}</h1>
      <p className="mt-1 text-sm text-stone-500">Última actualización: {actualizado}</p>
      <div className="mt-6 space-y-4 [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-extrabold [&_h2]:text-olivo-900 [&_li]:ml-5 [&_li]:list-disc [&_table]:w-full [&_td]:border-b [&_td]:border-stone-200 [&_td]:py-2 [&_td]:pr-3 [&_td]:align-top [&_th]:border-b-2 [&_th]:py-2 [&_th]:pr-3 [&_th]:text-left">
        {children}
      </div>
    </main>
  );
}
