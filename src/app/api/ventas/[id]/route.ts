/**
 * Venta — detalle y anulación.
 *   GET  /api/ventas/[id]         → venta + ítems + cliente (para el detalle)
 *   POST /api/ventas/[id]/anular  → anula (devuelve stock + revierte cobro) — ver subruta
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import { etiquetaOcasional } from "@/modules/empresa/tipos";

function ventaId(req: { url: string }): string | null {
  const segs = new URL(req.url).pathname.split("/").filter(Boolean);
  const i = segs.indexOf("ventas");
  return i >= 0 ? (segs[i + 1] ?? null) : null;
}

export const GET = withTenant(async (ctx, req) => {
  const id = ventaId(req);
  if (!id) return ERR.invalid("Falta el id de la venta");

  // Venta + ítems + cliente en UNA consulta (embebidos de PostgREST), no tres seguidas.
  const vq = await ctx.db
    .select(
      "ventas",
      "id, numero_control, fecha, subtotal, monto_iva, total, estado, tipo_venta, plazo_dias, metodo_pago, moneda, cliente_id, observaciones, " +
        "usuario_nombre, caja_id, anulada_at, anulada_motivo, tipo_documento, receptor_nombre, receptor_ruc, receptor_ocasional, " +
        "ventas_items(id, producto_nombre, sku, cantidad, precio_venta, tipo_precio, tipo_iva, monto_iva, total_linea), " +
        "pagos:ventas_pagos_detalle(id, metodo_pago, monto, referencia, banco, recibido, vuelto, created_at), " +
        "turno:cajas(numero_caja, estado), punto:puntos_venta(nombre), sucursal:sucursales(nombre), deposito:depositos(nombre), " +
        "cliente:clientes!cliente_id(nombre), cuenta:cuentas_por_cobrar(vencimiento, cobrado, saldo, estado)",
    )
    .eq("id", id)
    .limit(1);
  if (vq.error) return ERR.server();
  const fila = (vq.data?.[0] ?? null) as unknown as
    | (Record<string, unknown> & {
        ventas_items?: unknown[] | null;
        pagos?: { created_at: string }[] | null;
        cliente?: { nombre?: string | null } | null;
        cuenta?: unknown[] | Record<string, unknown> | null;
      })
    | null;
  if (!fila) return ERR.notFound();
  const { ventas_items, cliente, pagos, cuenta, ...venta } = fila;

  return ok({
    venta,
    items: ventas_items ?? [],
    pagos: (pagos ?? []).slice().sort((a, b) => (a.created_at < b.created_at ? -1 : 1)),
    cuenta: Array.isArray(cuenta) ? (cuenta[0] ?? null) : (cuenta ?? null),
    // Receta 67: venta a cliente ocasional → "Cliente ocasional (X)".
    cliente_nombre: cliente?.nombre || (venta.receptor_ocasional ? etiquetaOcasional(venta.receptor_nombre as string | null) : "Sin nombre"),
  });
});
