/** Kardex: registra una entrada/salida de stock en movimientos_inventario. Solo servidor. */
import type { TenantContext } from "@/lib/api/with-tenant";

export type Origen = "inventario_inicial" | "ajuste_manual" | "venta" | "anulacion_venta" | "compra";

// Nombre del usuario por id, recordado unos minutos: el portón (withTenant) no lo trae y
// no hace falta ir a la base en cada movimiento de stock.
const NOMBRE_TTL_MS = 5 * 60_000;
const nombres = new Map<string, { nombre: string | null; hasta: number }>();

async function nombreUsuario(ctx: TenantContext): Promise<string | null> {
  const hit = nombres.get(ctx.usuarioId);
  if (hit && hit.hasta > Date.now()) return hit.nombre;
  const u = await ctx.db.select("usuarios", "nombre").eq("id", ctx.usuarioId).limit(1);
  const nombre = (u.data?.[0] as { nombre?: string } | undefined)?.nombre ?? null;
  // Solo se recuerda si la consulta anduvo (un error no deja el nombre vacío pegado).
  if (!u.error) {
    if (nombres.size >= 500) nombres.delete(nombres.keys().next().value!);
    nombres.set(ctx.usuarioId, { nombre, hasta: Date.now() + NOMBRE_TTL_MS });
  }
  return nombre;
}

/**
 * delta > 0 → ENTRADA, delta < 0 → SALIDA, 0 → no registra nada.
 * Best-effort: si falla, el cambio de stock ya está hecho y no se revierte (se loguea).
 */
export async function registrarMovimiento(
  ctx: TenantContext,
  m: { producto_id: string; producto_nombre: string; producto_sku: string; delta: number; costo_unitario: number; origen: Origen; referencia: string },
) {
  if (!m.delta) return;
  // Nombre del usuario (igual que lo guardan las funciones de venta/anulación en la base).
  const nombre = await nombreUsuario(ctx);
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
    usuario_nombre: nombre || ctx.user.email || null,
  });
  if (error) console.error("[kardex]", error.message);
}
