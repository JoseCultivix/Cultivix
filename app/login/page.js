"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase, supabaseConfigurado } from "@/lib/supabase";
import { useApp } from "@/components/AppProvider";
import { Boton, Input, Campo } from "@/components/ui";

export default function Login() {
  const { sesion } = useApp();
  const router = useRouter();
  const [modo, setModo] = useState("entrar"); // entrar | registro | enlace
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nombre, setNombre] = useState("");
  const [cargando, setCargando] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    if (sesion) router.replace("/");
  }, [sesion, router]);

  async function enviar(e) {
    e.preventDefault();
    setCargando(true);
    setMsg(null);
    try {
      if (modo === "entrar") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else if (modo === "registro") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { nombre }, emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        if (!data.session) setMsg({ ok: true, t: "Te hemos enviado un email para confirmar la cuenta. Ábrelo desde este móvil." });
      } else {
        const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } });
        if (error) throw error;
        setMsg({ ok: true, t: "Revisa tu correo: te hemos enviado un enlace para entrar sin contraseña." });
      }
    } catch (err) {
      const t = String(err.message || err);
      setMsg({
        ok: false,
        t: t.includes("Invalid login") ? "Email o contraseña incorrectos" : t.includes("already registered") ? "Ese email ya tiene cuenta. Entra con tu contraseña." : t,
      });
    } finally {
      setCargando(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10">
      <div className="mb-8 text-center">
        <img src="/icon.svg" alt="" className="mx-auto h-20 w-20" />
        <h1 className="mt-3 text-4xl font-black tracking-tight text-olivo-900">Cultivix</h1>
        <p className="mt-1 text-lg text-stone-600">Tu tiempo, para el campo.</p>
      </div>

      {!supabaseConfigurado && (
        <div className="mb-4 rounded-2xl bg-amber-100 p-4 text-sm text-amber-900">
          Falta configurar Supabase: añade <b>NEXT_PUBLIC_SUPABASE_URL</b> y <b>NEXT_PUBLIC_SUPABASE_ANON_KEY</b> en las variables de entorno.
        </div>
      )}

      <div className="mb-4 grid grid-cols-3 gap-1 rounded-2xl bg-stone-200/70 p-1 text-sm font-bold">
        {[
          ["entrar", "Entrar"],
          ["registro", "Crear cuenta"],
          ["enlace", "Sin contraseña"],
        ].map(([k, t]) => (
          <button key={k} type="button" onClick={() => setModo(k)} className={`rounded-xl py-2.5 ${modo === k ? "bg-white text-olivo-800 shadow" : "text-stone-600"}`}>
            {t}
          </button>
        ))}
      </div>

      <form onSubmit={enviar} className="space-y-3">
        {modo === "registro" && (
          <Campo etiqueta="Tu nombre">
            <Input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="José Antonio" autoComplete="given-name" />
          </Campo>
        )}
        <Campo etiqueta="Email">
          <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" inputMode="email" />
        </Campo>
        {modo !== "enlace" && (
          <Campo etiqueta="Contraseña">
            <Input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={modo === "registro" ? "new-password" : "current-password"} />
          </Campo>
        )}
        {msg && <p className={`rounded-xl p-3 text-[15px] ${msg.ok ? "bg-olivo-100 text-olivo-900" : "bg-red-100 text-red-800"}`}>{msg.t}</p>}
        <Boton type="submit" grande className="w-full" disabled={cargando}>
          {cargando ? "Un momento…" : modo === "entrar" ? "Entrar" : modo === "registro" ? "Crear cuenta" : "Enviarme el enlace"}
        </Boton>
      </form>
      <p className="mt-6 text-center text-sm text-stone-500">
        ¿Te ha invitado tu empresa? Entra o crea la cuenta con el mismo email y accederás directamente.
      </p>
    </main>
  );
}
