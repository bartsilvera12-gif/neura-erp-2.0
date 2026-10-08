/**
 * Proveedores ya cargados en compras (los más usados primero), para sugerirlos en el
 * campo Proveedor de "Nuevo movimiento". GET /api/inventario/proveedores → string[]
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";

export const GET = withTenant(async (ctx) => {
  const { data, error } = await ctx.db.rpc<string[]>("proveedores_usados");
  if (error) return ERR.server();
  return ok(data ?? []);
});
