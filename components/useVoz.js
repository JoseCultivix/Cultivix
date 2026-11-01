"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/** Dictado por voz con el reconocimiento del propio móvil (Chrome/Android, Safari iOS). */
export function useVoz({ onFinal } = {}) {
  const [escuchando, setEscuchando] = useState(false);
  const [parcial, setParcial] = useState("");
  const [disponible, setDisponible] = useState(false);
  const rec = useRef(null);
  const cb = useRef(onFinal);
  cb.current = onFinal;

  useEffect(() => {
    const SR = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);
    if (!SR) return;
    setDisponible(true);
    const r = new SR();
    r.lang = "es-ES";
    r.interimResults = true;
    r.continuous = false;
    r.onresult = (e) => {
      let texto = "";
      let final = false;
      for (const res of e.results) {
        texto += res[0].transcript;
        if (res.isFinal) final = true;
      }
      setParcial(texto);
      if (final) {
        setParcial("");
        cb.current?.(texto.trim());
      }
    };
    r.onend = () => setEscuchando(false);
    r.onerror = () => setEscuchando(false);
    rec.current = r;
    return () => r.abort();
  }, []);

  const empezar = useCallback(() => {
    if (!rec.current) return;
    try {
      setParcial("");
      rec.current.start();
      setEscuchando(true);
    } catch {}
  }, []);
  const parar = useCallback(() => rec.current?.stop(), []);

  return { disponible, escuchando, parcial, empezar, parar };
}

/** Lee en voz alta (manos libres en el tractor). */
export function hablar(texto) {
  try {
    if (!window.speechSynthesis || !texto) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(texto);
    u.lang = "es-ES";
    window.speechSynthesis.speak(u);
  } catch {}
}
