/**
 * POST /api/inventario/produccion/[id]/anular { motivo } → anula una producción (receta 97):
 * lo fabricado sale de su lote / su capa y las materias primas vuelven a las suyas. Si ya
 * salió parte de lo fabricado (vendido, trasladado), la base no deja.
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { UUID_RE, idDeRuta, idInvalido } from "@/modules/inventario/server/ids";
import { falloRpc } from "@/modules/inventario/server/rpc";

const cuerpo = z.object({ motivo: z.string().trim().min(1, "Escribí el motivo de la anulación").max(500) });

export const POST = withTenant(
  async (ctx, req, input) => {
    const id = idDeRuta(req.url, "produccion");
    if (!UUID_RE.test(id ?? "")) return idInvalido("producción");
    const { data, error } = await ctx.db.rpc("anular_produccion", { p_id: id, p_motivo: input.motivo });
    if (error) return falloRpc(error);
    return ok(data);
  },
  { permiso: "fabricar", body: cuerpo },
);
