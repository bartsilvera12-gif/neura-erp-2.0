"use client";

/**
 * Reloj compartido por TODOS los badges de SLA: un solo setInterval de 60 s para toda la
 * pantalla (no uno por tarjeta) y solo se re-renderizan los componentes que lo usan; la
 * tarjeta memoizada no. Sin refetch: el SLA se recalcula en el navegador con el horario
 * laboral que vino con el tablero.
 */
import { useSyncExternalStore } from "react";

let ahora = 0;
const subs = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function suscribir(cb: () => void) {
  subs.add(cb);
  if (!timer) {
    ahora = Date.now();
    timer = setInterval(() => {
      ahora = Date.now();
      subs.forEach((f) => f());
    }, 60_000);
  }
  return () => {
    subs.delete(cb);
    if (!subs.size && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** Milisegundos de "ahora", actualizado cada minuto (0 en el servidor). */
export function useAhora(): number {
  return useSyncExternalStore(suscribir, () => ahora, () => 0);
}
