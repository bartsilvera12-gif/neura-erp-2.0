"use client";

/**
 * Aviso de conexión del usuario (receta 111). Cada 30 s MIENTRAS el sistema se ve (pestaña oculta o
 * celular en segundo plano = no avisa; la base lo da por desconectado a los 90 s). Al cerrar la
 * pestaña o la sesión avisa la salida con fetch keepalive (lleva el token, cosa que sendBeacon no
 * puede). Si falla un aviso no se muestra nada: esto nunca interrumpe el trabajo.
 */
import { useEffect, useRef } from "react";
import { apiFetch } from "@/lib/api/client-fetch";
import { browserClient } from "@/lib/supabase/browser";

const AVISO_MS = 30_000;
const URL_CONEXION = "/api/me/conexion";

function avisarSalida(token: string | null | undefined) {
  if (!token) return Promise.resolve();
  return fetch(URL_CONEXION, {
    method: "POST",
    keepalive: true,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ salir: true }),
  }).then(() => undefined, () => undefined);
}

/** Para "Cerrar sesión": marca la salida antes de que el token deje de servir. */
export async function marcarSalida() {
  const { data } = await browserClient().auth.getSession();
  await avisarSalida(data.session?.access_token);
}

export function useAvisoConexion() {
  const token = useRef<string | null>(null);

  useEffect(() => {
    let t: number | null = null;
    const avisar = () => {
      apiFetch(URL_CONEXION, { method: "POST", body: "{}" }).catch(() => {});
      void browserClient().auth.getSession().then(({ data }) => { token.current = data.session?.access_token ?? null; });
    };
    const arrancar = () => {
      if (t != null) return;
      avisar();
      t = window.setInterval(avisar, AVISO_MS);
    };
    const parar = () => {
      if (t != null) window.clearInterval(t);
      t = null;
    };
    const onVis = () => (document.visibilityState === "visible" ? arrancar() : parar());
    const onHide = (e: PageTransitionEvent) => {
      if (!e.persisted) void avisarSalida(token.current);
    };
    if (document.visibilityState === "visible") arrancar();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", onHide);
    return () => {
      parar();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", onHide);
    };
  }, []);
}
