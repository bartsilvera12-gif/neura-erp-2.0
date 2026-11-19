"use client";

/**
 * Presupuestos por cobrar (receta 167), lado del navegador: la bandeja de Caja › Nueva venta.
 * Polling cada ~6 s mientras la pestaña está a la vista. El cajero toca un presupuesto y la caja
 * lo carga por ?presupuesto=<id> (el camino de siempre). El vendedor recibe lista vacía del server.
 */
import { useCallback, useEffect, useState } from "react";
import { apiFetchSWR, guardadoAlInstante } from "@/lib/api/cache-cliente";
import { URL_PRESUPUESTOS_POR_COBRAR, type PresupuestosPorCobrar } from "@/modules/presupuestos/tipos";

export function usePresupuestosPorCobrar(activo = true, cadaMs = 6000) {
  const [datos, setDatos] = useState<PresupuestosPorCobrar | null>(() => guardadoAlInstante<PresupuestosPorCobrar>(URL_PRESUPUESTOS_POR_COBRAR) ?? null);

  const pedir = useCallback(async (signal?: AbortSignal) => {
    try { await apiFetchSWR<PresupuestosPorCobrar>(URL_PRESUPUESTOS_POR_COBRAR, (d) => setDatos(d), { fresco: true, signal }); }
    catch { /* reintenta en la próxima vuelta */ }
  }, []);

  useEffect(() => {
    if (!activo) return;
    const ctrl = new AbortController();
    const hit = guardadoAlInstante<PresupuestosPorCobrar>(URL_PRESUPUESTOS_POR_COBRAR);
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

  return { presupuestos: datos?.presupuestos ?? [], recargar: () => pedir() };
}
