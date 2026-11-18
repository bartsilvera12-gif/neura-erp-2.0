"use client";

/**
 * Tablero de mesas en tiempo casi real: pide /api/mesas/tablero cada `cadaMs` (stale-while-
 * revalidate: al volver a la pantalla pinta lo último al instante) mientras la pestaña está a la
 * vista, y enseguida al volver a ella. `onNuevos` recibe los pedidos que pasaron a `estadoAviso`
 * ("nuevo" en la caja, "aceptado" en la cocina) desde la última consulta; la primera carga no avisa.
 *
 * `activo` (default true): mientras sea false NO se consulta el tablero. Las pantallas le pasan
 * `useFuncion("mesas"/"cocina")`, que es false hasta que la sesión cargó y si la función está
 * apagada: así no se dispara un GET que el portón cortaría con 403. Si la función se apaga mientras
 * el tablero está abierto (otra pestaña), un 403 corta el polling en silencio en vez de repetirlo.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetchSWR, guardadoAlInstante } from "@/lib/api/cache-cliente";
import type { ApiError } from "@/lib/api/client-fetch";
import { URL_TABLERO, type PedidoMesa, type TableroMesas } from "@/modules/mesas/tipos";

export function useTablero(cadaMs = 4000, onNuevos?: (p: PedidoMesa[]) => void, estadoAviso: PedidoMesa["estado"] = "nuevo", activo = true) {
  const [datos, setDatos] = useState<TableroMesas | null>(() => guardadoAlInstante<TableroMesas>(URL_TABLERO) ?? null);
  const [error, setError] = useState<string | null>(null);
  // La función se apagó mientras el tablero estaba abierto: se deja de pedir (no tiene sentido).
  const detenido = useRef(false);
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
    if (detenido.current) return;
    try {
      await apiFetchSWR<TableroMesas>(URL_TABLERO, recibir, { fresco: true, signal });
    } catch (e) {
      if (signal?.aborted) return;
      // Función apagada: cortar el polling sin mostrar error (no reintentar cada 4 s).
      if ((e as ApiError).status === 403) { detenido.current = true; return; }
      setError((e as Error).message);
    }
  }, [recibir]);

  useEffect(() => {
    if (!activo) return;
    detenido.current = false;
    const ctrl = new AbortController();
    const hit = guardadoAlInstante<TableroMesas>(URL_TABLERO);
    if (hit) recibir(hit, true);
    // Un solo pedido a la vez: con la red lenta (respuesta > cadaMs) no se encima otro.
    let enCurso = false;
    const tic = () => {
      if (detenido.current || enCurso || document.visibilityState !== "visible") return;
      enCurso = true;
      void pedir(ctrl.signal).finally(() => { enCurso = false; });
    };
    void pedir(ctrl.signal);
    const id = setInterval(tic, cadaMs);
    const alVolver = tic;
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      ctrl.abort();
      clearInterval(id);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, [cadaMs, pedir, recibir, activo]);

  return { datos, error, recargar: () => pedir(), ahora: () => Date.now() + desfase };
}
