/**
 * Recetas (receta 72): GET /api/inventario/recetas → productos Menú y preparaciones (materias
 * primas con receta) con costo calculado, porciones posibles en el depósito del usuario y estado
 * (completa / sin_receta / faltante). Pide "ver costos" o "editar productos" (lo controla la base).
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { falloRpc } from "@/modules/inventario/server/rpc";

export const GET = withTenant(async (ctx) => {
  const { data, error } = await ctx.db.rpc("recetas_listar");
  if (error) return falloRpc(error);
  return ok(data);
});
