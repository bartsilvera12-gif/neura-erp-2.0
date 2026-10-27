"use client";

/**
 * Pedidos de mostrador (receta 77), lado del navegador:
 *   · imprimirComprobantePedido: trae el HTML del comprobante (con el Bearer) y lo imprime desde
 *     un iframe oculto (misma fila de impresión que la comanda; no abre pestañas).
 *   · usePedidosPorCobrar: bandeja de Caja › Nueva venta (polling cada ~4 s mientras la pestaña
 *     está a la vista; avisa los que entraron con `onNuevos`). Igual que usePorCobrar de mesas.
 *   · "Imprimir al enviar": preferencia del equipo (localStorage).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { browserClient } from "@/lib/supabase/browser";
import { apiFetchSWR, guardadoAlInstante } from "@/lib/api/cache-cliente";
import { imprimirHtml } from "@/modules/mesas/imprimirComanda";
import { urlPedidosPorCobrar, type PedidoMostrador, type PedidosPorCobrar } from "@/modules/pedidos-mostrador/tipos";

export async function imprimirComprobantePedido(id: string): Promise<boolean> {
  try {
    const { data } = await browserClient().auth.getSession();
    const token = data.session?.access_token;
    const res = await fetch(`/api/pedidos-mostrador/${id}/comprobante?acciones=0`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return false;
    await imprimirHtml(await res.text());
    return true;
  } catch {
    return false;
  }
}

const CLAVE_IMPRIMIR = "erp.pedidos.imprimir_al_enviar";
export function leerImprimirAlEnviar(): boolean {
  try { return localStorage.getItem(CLAVE_IMPRIMIR) === "1"; } catch { return false; }
}
export function guardarImprimirAlEnviar(v: boolean) {
  try { localStorage.setItem(CLAVE_IMPRIMIR, v ? "1" : "0"); } catch { /* sin storage */ }
}

export function usePedidosPorCobrar(cajaId: string | null, onNuevos?: (p: PedidoMostrador[]) => void, cadaMs = 4000) {
  const url = cajaId ? urlPedidosPorCobrar(cajaId) : null;
  const [datos, setDatos] = useState<PedidosPorCobrar | null>(() => (url ? guardadoAlInstante<PedidosPorCobrar>(url) ?? null : null));
  const [fresco, setFresco] = useState(false);
  const vistos = useRef<Set<string> | null>(null);
  const aviso = useRef(onNuevos);
  aviso.current = onNuevos;
  const [desfase, setDesfase] = useState(0);

  const recibir = useCallback((d: PedidosPorCobrar, viejo: boolean) => {
    setDatos(d);
    if (!viejo) { setFresco(true); setDesfase(Date.parse(d.ahora) - Date.now()); }
    const ids = d.pedidos.map((p) => p.id);
    if (vistos.current === null) { vistos.current = new Set(ids); return; }
    const llegados = d.pedidos.filter((p) => !vistos.current!.has(p.id));
    vistos.current = new Set(ids);
    if (llegados.length && !viejo) aviso.current?.(llegados);
  }, []);

  const pedir = useCallback(async (signal?: AbortSignal) => {
    if (!url) return;
    try { await apiFetchSWR<PedidosPorCobrar>(url, recibir, { fresco: true, signal }); } catch { /* reintenta en la próxima vuelta */ }
  }, [url, recibir]);

  useEffect(() => {
    vistos.current = null;
    setFresco(false);
    if (!url) { setDatos(null); return; }
    const ctrl = new AbortController();
    const hit = guardadoAlInstante<PedidosPorCobrar>(url);
    if (hit) recibir(hit, true);
    void pedir(ctrl.signal);
    const id = setInterval(() => { if (document.visibilityState === "visible") void pedir(ctrl.signal); }, cadaMs);
    const alVolver = () => { if (document.visibilityState === "visible") void pedir(ctrl.signal); };
    document.addEventListener("visibilitychange", alVolver);
    return () => { ctrl.abort(); clearInterval(id); document.removeEventListener("visibilitychange", alVolver); };
  }, [url, cadaMs, pedir, recibir]);

  return { pedidos: datos?.pedidos ?? [], cargado: !!datos, fresco, recargar: () => pedir(), ahora: () => Date.now() + desfase };
}
