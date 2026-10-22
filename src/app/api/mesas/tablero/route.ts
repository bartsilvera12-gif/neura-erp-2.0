/**
 * Tablero de mesas (receta 68): pedidos activos (más viejo primero) y cuentas abiertas con su
 * total. Lo usan Caja › Pedidos de mesas y Cocina (polling cada pocos segundos). La base exige
 * "Atender pedidos de mesas" o "Pantalla de cocina" y recorta a la sucursal del perfil.
 *   GET /api/mesas/tablero → { ahora, pedidos, cuentas, puede_atender, puede_cocina }
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import { falloRpc } from "@/modules/inventario/server/rpc";

export const GET = withTenant(async (ctx) => {
  if (!ctx.puede("pedidos_mesas") && !ctx.puede("cocina")) return ERR.sinPermiso("pedidos_mesas");
  const { data, error } = await ctx.db.rpc("mesas_tablero");
  if (error) return falloRpc(error);
  if (!data) return ERR.server();
  return ok(data, { headers: { "Cache-Control": "no-store" } });
});
