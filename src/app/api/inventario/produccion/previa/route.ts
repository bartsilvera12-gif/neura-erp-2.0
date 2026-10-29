/**
 * GET /api/inventario/produccion/previa?producto&cantidad&deposito → qué materias primas usa
 * fabricar esa cantidad, cuánto hay y cuánto falta en el depósito, y el costo estimado
 * (receta 97, fabricar_previa). No mueve nada.
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { UUID_RE, idInvalido } from "@/modules/inventario/server/ids";
import { falloRpc, uuidONull } from "@/modules/inventario/server/rpc";

export const GET = withTenant(
  async (ctx, req) => {
    const sp = new URL(req.url).searchParams;
    const producto = sp.get("producto") ?? "";
    if (!UUID_RE.test(producto)) return idInvalido("producto");
    const cantidad = Number(sp.get("cantidad"));
    const { data, error } = await ctx.db.rpc("fabricar_previa", {
      p_producto: producto,
      p_cantidad: Number.isFinite(cantidad) && cantidad > 0 ? Math.min(cantidad, 10000000) : null,
      p_deposito: uuidONull(sp.get("deposito")),
    });
    if (error) return falloRpc(error);
    return ok(data);
  },
  { permiso: "fabricar" },
);
