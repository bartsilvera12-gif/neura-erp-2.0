/**
 * Anular un retiro / ingreso de efectivo (solo manuales y con la caja abierta).
 *   POST /api/caja/movimientos/<id>/anular { motivo } → { id }
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { falloRpc } from "@/modules/inventario/server/rpc";
import { UUID_RE, idDeRuta, idInvalido } from "@/modules/inventario/server/ids";
import { ROLES_CAJA } from "@/modules/caja/lib";

const cuerpo = z.object({ motivo: z.string().trim().min(1, "Escribí el motivo").max(200) });

export const POST = withTenant(
  async (ctx, req, input) => {
    const id = idDeRuta(req.url, "movimientos");
    if (!UUID_RE.test(id ?? "")) return idInvalido("movimiento");
    const { data, error } = await ctx.db.rpc("anular_movimiento_caja", { p_id: id, p_motivo: input.motivo });
    if (error) return falloRpc(error);
    return ok(data);
  },
  { roles: ROLES_CAJA, body: cuerpo },
);
