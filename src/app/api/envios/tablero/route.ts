/**
 * Tablero de Envíos (receta 170): estados (columnas), choferes y los envíos a la vista.
 *   GET /api/envios/tablero → { estados[], choferes[], envios[] }
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import { falloRpc } from "@/modules/inventario/server/rpc";

export const dynamic = "force-dynamic";

export const GET = withTenant(async (ctx) => {
  const { data, error } = await ctx.db.rpc("envios_tablero", {});
  if (error) return falloRpc(error);
  if (!data) return ERR.server();
  return ok(data, { headers: { "Cache-Control": "no-store" } });
}, { permiso: "envios_operar" });
