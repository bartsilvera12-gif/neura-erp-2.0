"use client";

/**
 * Realtime de la bandeja: tópicos PRIVADOS por broadcast (los avisa la base con
 * realtime.send desde los triggers). Payload mínimo; la pantalla pide lo que le falta.
 *   chat:<empresa>            → "conversacion"  (UNO por pestaña, lo usa la lista)
 *   chat:conv:<conversacion>  → "mensaje" / "estado" (UNO, el del chat abierto)
 *
 * Respaldo: si el canal NO está SUBSCRIBED, un sondeo cada 30 s — y nunca con la pestaña
 * oculta. Al volver a estar suscripto o al volver a la pestaña, se pone al día una vez.
 */
import { useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { browserClient } from "@/lib/supabase/browser";

type Manejadores = Record<string, (payload: Record<string, unknown>) => void>;

/** Se suscribe a un tópico privado. Devuelve true mientras está SUBSCRIBED. */
export function useBroadcast(topic: string | null, manejadores: Manejadores): boolean {
  const [suscripto, setSuscripto] = useState(false);
  const ref = useRef(manejadores);
  ref.current = manejadores;
  const eventos = Object.keys(manejadores).sort().join(",");

  useEffect(() => {
    setSuscripto(false);
    if (!topic) return;
    let vivo = true;
    let canal: RealtimeChannel | null = null;
    const sb = browserClient();
    (async () => {
      const { data } = await sb.auth.getSession();
      if (!vivo) return;
      const token = data.session?.access_token;
      if (token) await sb.realtime.setAuth(token);
      if (!vivo) return;
      canal = sb.channel(topic, { config: { private: true } });
      for (const ev of eventos.split(",").filter(Boolean)) {
        canal.on("broadcast", { event: ev }, (msg) => ref.current[ev]?.((msg.payload ?? {}) as Record<string, unknown>));
      }
      canal.subscribe((status) => {
        if (vivo) setSuscripto(status === "SUBSCRIBED");
      });
    })();
    return () => {
      vivo = false;
      if (canal) void sb.removeChannel(canal);
    };
  }, [topic, eventos]);

  return suscripto;
}

/**
 * Red de seguridad: corre `ponerseAlDia` cada `ms` SOLO si no hay Realtime y la pestaña se
 * ve; además una vez al recuperar Realtime y al volver a la pestaña.
 */
export function useRespaldo(activo: boolean, suscripto: boolean, ponerseAlDia: () => void, ms = 30_000) {
  const fn = useRef(ponerseAlDia);
  fn.current = ponerseAlDia;
  const antes = useRef(suscripto);

  useEffect(() => {
    if (!activo) return;
    // Se recuperó la conexión: puede haberse perdido algún aviso en el medio.
    if (suscripto && !antes.current) fn.current();
    antes.current = suscripto;
    if (suscripto) return;
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") fn.current();
    }, ms);
    return () => window.clearInterval(t);
  }, [activo, suscripto, ms]);

  useEffect(() => {
    if (!activo) return;
    let oculta = document.visibilityState !== "visible";
    const onVis = () => {
      const ahoraOculta = document.visibilityState !== "visible";
      if (oculta && !ahoraOculta) fn.current();
      oculta = ahoraOculta;
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [activo]);
}
