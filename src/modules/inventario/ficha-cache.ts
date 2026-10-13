"use client";

/**
 * Ficha del producto (panel lateral de Inventario): sus secciones que se piden aparte
 * (historial de costos, lotes) van por el cache de listas, así:
 *   · al pasar el mouse por "editar" ya se piden (y se baja el JS del panel)
 *   · volver a abrir el mismo producto pinta al instante y se refresca en segundo plano
 */
import { precargarLista } from "@/modules/inventario/lista-cache";

export const urlCostos = (productoId: string) => `/api/productos/${productoId}/costos`;
export const urlLotes = (productoId: string) => `/api/productos/${productoId}/lotes`;

/** Precarga lo que va a pedir la ficha de este producto (sin esperar ni avisar errores). */
export function precargarFichaProducto(p: { id: string; controla_lotes?: boolean; controla_stock?: boolean }) {
  precargarLista(urlCostos(p.id));
  if (p.controla_lotes && p.controla_stock !== false) precargarLista(urlLotes(p.id));
}
