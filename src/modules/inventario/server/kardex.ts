/** Kardex: registra una entrada/salida de stock en movimientos_inventario. Solo servidor. */
import type { TenantContext } from "@/lib/api/with-tenant";

export type Origen = "inventario_inicial" | "ajuste_manual" | "venta" | "anulacion_venta" | "compra";

/**
 * delta > 0 → ENTRADA, delta < 0 → SALIDA, 0 → no registra nada.
 * Best-effort: si falla, el cambio de stock ya está hecho y no se revierte (se loguea).
 */
export async function registrarMovimiento(
  ctx: TenantContext,
  m: { producto_id: string; producto_nombre: string; producto_sku: string; delta: number; costo_unitario: number; origen: Origen; referencia: string },
) {
  if (!m.delta) return;
  const { error } = await ctx.db.insert("movimientos_inventario", {
    producto_id: m.producto_id,
    producto_nombre: m.producto_nombre,
    producto_sku: m.producto_sku,
    tipo: m.delta > 0 ? "ENTRADA" : "SALIDA",
    cantidad: Math.abs(m.delta),
    costo_unitario: m.costo_unitario || 0,
    origen: m.origen,
    referencia: m.referencia,
    created_by: ctx.usuarioId,
    usuario_nombre: ctx.user.email ?? null,
  });
  if (error) console.error("[kardex]", error.message);
}
