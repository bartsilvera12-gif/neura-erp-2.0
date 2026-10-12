"use client";

/**
 * Presencia del asesor (latido). La bandeja y el Monitoreo laten cada 30 s MIENTRAS la
 * pestaña se ve (oculta = no late; la base lo da "fuera de línea" a los 90 s). Cada latido
 * manda el estado elegido (Disponible / Ocupado / En pausa), que se recuerda en el
 * navegador y se comparte entre pestañas: si una pestaña se cierra y deja "desconectado",
 * la que sigue abierta lo repone en el próximo latido.
 * Al cerrar la pestaña se avisa "desconectado" con fetch keepalive (lleva el token, cosa
 * que sendBeacon no puede).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { browserClient } from "@/lib/supabase/browser";
import { latir } from "@/modules/conversaciones/api-supervision";
import { LATIDO_MS, esEstadoAgente, type EstadoAgente } from "@/modules/conversaciones/supervision";

const CLAVE = "zentra:chat:estado";
type Elegible = Exclude<EstadoAgente, "desconectado">;

function leerGuardado(): Elegible | null {
  try {
    const v = localStorage.getItem(CLAVE);
    return esEstadoAgente(v) && v !== "desconectado" ? v : null;
  } catch {
    return null;
  }
}
function guardar(v: Elegible) {
  try {
    localStorage.setItem(CLAVE, v);
  } catch {
    /* sin storage */
  }
}

export function usePresencia(activo = true) {
  const [estado, setEstado] = useState<EstadoAgente | null>(null);
  const [error, setError] = useState<string | null>(null);
  const elegido = useRef<Elegible | null>(null);
  const token = useRef<string | null>(null);

  const latido = useCallback(async () => {
    try {
      const pedido = elegido.current ?? leerGuardado();
      let r = await latir(pedido);
      // Venía de una pestaña cerrada (o de otro equipo): vuelve a estar disponible.
      if (!pedido && r.estado === "desconectado") r = await latir("disponible");
      if (r.estado !== "desconectado") {
        elegido.current = r.estado;
        guardar(r.estado);
      }
      setEstado(r.estado);
      setError(null);
      const { data } = await browserClient().auth.getSession();
      token.current = data.session?.access_token ?? null;
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  // Latido cada 30 s solo con la pestaña visible.
  useEffect(() => {
    if (!activo) return;
    let t: number | null = null;
    const arrancar = () => {
      if (t != null) return;
      void latido();
      t = window.setInterval(() => void latido(), LATIDO_MS);
    };
    const parar = () => {
      if (t != null) window.clearInterval(t);
      t = null;
    };
    const onVis = () => (document.visibilityState === "visible" ? arrancar() : parar());
    if (document.visibilityState === "visible") arrancar();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      parar();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [activo, latido]);

  // Otra pestaña cambió el estado → se refleja acá sin red.
  useEffect(() => {
    if (!activo) return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== CLAVE || !esEstadoAgente(e.newValue) || e.newValue === "desconectado") return;
      elegido.current = e.newValue;
      setEstado(e.newValue);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [activo]);

  // Cierre de la pestaña → "desconectado".
  useEffect(() => {
    if (!activo) return;
    const onHide = (e: PageTransitionEvent) => {
      if (e.persisted || !token.current) return;
      try {
        void fetch("/api/conversaciones/presencia", {
          method: "POST",
          keepalive: true,
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token.current}` },
          body: JSON.stringify({ estado: "desconectado" }),
        });
      } catch {
        /* la base lo da fuera de línea a los 90 s igual */
      }
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [activo]);

  const cambiar = useCallback(async (nuevo: Elegible) => {
    const antes = estado;
    elegido.current = nuevo;
    guardar(nuevo);
    setEstado(nuevo);
    try {
      const r = await latir(nuevo);
      setEstado(r.estado);
      setError(null);
    } catch (e) {
      setEstado(antes);
      setError((e as Error).message);
    }
  }, [estado]);

  return { estado, error, cambiar };
}
