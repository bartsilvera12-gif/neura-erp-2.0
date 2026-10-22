"use client";

/**
 * Tablero de mesas en tiempo casi real: pide /api/mesas/tablero cada `cadaMs` (stale-while-
 * revalidate: al volver a la pantalla pinta lo último al instante) mientras la pestaña está a la
 * vista, y enseguida al volver a ella. `onNuevos` recibe los pedidos que pasaron a `estadoAviso`
 * ("nuevo" en la caja, "aceptado" en la cocina) desde la última consulta; la primera carga no avisa.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetchSWR, guardadoAlInstante } from "@/lib/api/cache-cliente";
import { URL_TABLERO, type PedidoMesa, type TableroMesas } from "@/modules/mesas/tipos";

export function useTablero(cadaMs = 4000, onNuevos?: (p: PedidoMesa[]) => void, estadoAviso: PedidoMesa["estado"] = "nuevo") {
  const [datos, setDatos] = useState<TableroMesas | null>(() => guardadoAlInstante<TableroMesas>(URL_TABLERO) ?? null);
  const [error, setError] = useState<string | null>(null);
  const vistos = useRef<Set<string> | null>(null);
  const aviso = useRef(onNuevos);
  aviso.current = onNuevos;
  // Diferencia entre el reloj del servidor y el del equipo (para "hace X min").
  const [desfase, setDesfase] = useState(0);

  const recibir = useCallback((d: TableroMesas, viejo: boolean) => {
    setDatos(d);
    setError(null);
    if (!viejo) setDesfase(Date.parse(d.ahora) - Date.now());
    const nuevos = d.pedidos.filter((p) => p.estado === estadoAviso);
    if (vistos.current === null) {
      vistos.current = new Set(nuevos.map((p) => p.id));
      return;
    }
    const llegados = nuevos.filter((p) => !vistos.current!.has(p.id));
    for (const p of nuevos) vistos.current.add(p.id);
    if (llegados.length && !viejo) aviso.current?.(llegados);
  }, [estadoAviso]);

  const pedir = useCallback(async (signal?: AbortSignal) => {
    try {
      await apiFetchSWR<TableroMesas>(URL_TABLERO, recibir, { fresco: true, signal });
    } catch (e) {
      if (!signal?.aborted) setError((e as Error).message);
    }
  }, [recibir]);

  useEffect(() => {
    const ctrl = new AbortController();
    const hit = guardadoAlInstante<TableroMesas>(URL_TABLERO);
    if (hit) recibir(hit, true);
    void pedir(ctrl.signal);
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void pedir(ctrl.signal);
    }, cadaMs);
    const alVolver = () => { if (document.visibilityState === "visible") void pedir(ctrl.signal); };
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      ctrl.abort();
      clearInterval(id);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, [cadaMs, pedir, recibir]);

  return { datos, error, recargar: () => pedir(), ahora: () => Date.now() + desfase };
}
