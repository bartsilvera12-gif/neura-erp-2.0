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

  const vq = await ctx.db
    .select("ventas", "id, numero_control, fecha, subtotal, monto_iva, total, estado, tipo_venta, metodo_pago, moneda, cliente_id, observaciones")
    .eq("id", id)
    .limit(1);
  if (vq.error) return ERR.server();
  if (!vq.data?.length) return ERR.notFound();
  const venta = vq.data[0];

  const itemsQ = await ctx.db
    .select("ventas_items", "id, producto_nombre, sku, cantidad, precio_venta, tipo_precio, tipo_iva, monto_iva, total_linea")
    .eq("venta_id", id);

  let clienteNombre = "Sin nombre";
  if (venta.cliente_id) {
    const c = await ctx.db.select("clientes", "nombre").eq("id", venta.cliente_id).limit(1);
    if (c.data?.[0]?.nombre) clienteNombre = c.data[0].nombre;
  }

  return ok({ venta, items: itemsQ.data ?? [], cliente_nombre: clienteNombre });
});
