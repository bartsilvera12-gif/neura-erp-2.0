/**
 * Detalle de una celda de "Existencias por depósito" (reporte_existencias_celda, receta 80):
 * cantidad y valor del producto en ESE depósito, capas de costo vigentes (con "ver costos")
 * y, si controla lotes, sus lotes con vencimiento.
 *   GET /api/reportes/existencias/detalle?producto=<uuid>&deposito=<uuid>
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import { falloRpc, uuidONull } from "@/modules/inventario/server/rpc";
import type { DetalleCelda } from "@/modules/reportes/existencias";

export const dynamic = "force-dynamic";

export const GET = withTenant(
  async (ctx, req) => {
    const sp = new URL(req.url).searchParams;
    const producto = uuidONull(sp.get("producto"));
    const deposito = uuidONull(sp.get("deposito"));
    if (!producto || !deposito) return ERR.invalid("Faltan el producto o el depósito");
    const { data, error } = await ctx.db.rpc<DetalleCelda>("reporte_existencias_celda", { p_producto: producto, p_deposito: deposito });
    if (error) {
      if (/no encontrado/i.test(error.message)) return ERR.notFound("producto o depósito");
      return falloRpc(error);
    }
    return ok(data);
  },
  { permiso: "ver_reportes_financieros" },
);
