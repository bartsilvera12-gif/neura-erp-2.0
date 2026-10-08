/**
 * Venta — detalle y anulación.
 *   GET  /api/ventas/[id]         → venta + ítems + cliente (para el detalle)
 *   POST /api/ventas/[id]/anular  → anula (devuelve stock + revierte cobro) — ver subruta
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";

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
      "id, numero_control, fecha, subtotal, monto_iva, total, estado, tipo_venta, metodo_pago, moneda, cliente_id, observaciones, " +
        "ventas_items(id, producto_nombre, sku, cantidad, precio_venta, tipo_precio, tipo_iva, monto_iva, total_linea), " +
        "cliente:clientes!cliente_id(nombre)",
    )
    .eq("id", id)
    .limit(1);
  if (vq.error) return ERR.server();
  const fila = (vq.data?.[0] ?? null) as unknown as
    | (Record<string, unknown> & { ventas_items?: unknown[] | null; cliente?: { nombre?: string | null } | null })
    | null;
  if (!fila) return ERR.notFound();
  const { ventas_items, cliente, ...venta } = fila;

  return ok({ venta, items: ventas_items ?? [], cliente_nombre: cliente?.nombre || "Sin nombre" });
});
