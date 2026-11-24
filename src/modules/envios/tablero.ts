"use client";

/**
 * Tablero de Envíos (receta 170), lado del navegador: polling cada ~6 s mientras la pestaña está a
 * la vista (molde usePresupuestosPorCobrar). Arranca del cache al instante.
 */
import { useCallback, useEffect, useState } from "react";
import { apiFetchSWR, guardadoAlInstante } from "@/lib/api/cache-cliente";
import { URL_ENVIOS_TABLERO, type EnviosTablero } from "@/modules/envios/tipos";

export function useEnviosTablero(activo = true, cadaMs = 6000) {
  const [datos, setDatos] = useState<EnviosTablero | null>(() => guardadoAlInstante<EnviosTablero>(URL_ENVIOS_TABLERO) ?? null);
  const [error, setError] = useState<string | null>(null);

  const pedir = useCallback(async (signal?: AbortSignal) => {
    try {
      await apiFetchSWR<EnviosTablero>(URL_ENVIOS_TABLERO, (d) => { setDatos(d); setError(null); }, { fresco: true, signal });
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    if (!activo) return;
    const ctrl = new AbortController();
    const hit = guardadoAlInstante<EnviosTablero>(URL_ENVIOS_TABLERO);
    if (hit) setDatos(hit);
    let enCurso = false;
    const tic = () => {
      if (enCurso || document.visibilityState !== "visible") return;
      enCurso = true;
      void pedir(ctrl.signal).finally(() => { enCurso = false; });
    };
    void pedir(ctrl.signal);
    const id = setInterval(tic, cadaMs);
    document.addEventListener("visibilitychange", tic);
    return () => { ctrl.abort(); clearInterval(id); document.removeEventListener("visibilitychange", tic); };
  }, [activo, cadaMs, pedir]);

  return { tablero: datos, error, recargar: () => pedir() };
}
