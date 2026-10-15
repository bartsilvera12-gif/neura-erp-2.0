/**
 * DELETE /api/gastos/recurrentes/[rid] → la borra si nunca generó gastos; si generó, la desactiva
 *        (los gastos quedan). → { id, accion: "eliminada" | "desactivada" }
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, fail, ERR } from "@/lib/api/responses";
import { mensajeDb } from "@/lib/gastos/esquema";

export const dynamic = "force-dynamic";

export const DELETE = withTenant(
  async (ctx, req) => {
    const segs = new URL(req.url).pathname.split("/").filter(Boolean);
    const id = segs[segs.indexOf("recurrentes") + 1];
    if (!/^[0-9a-f-]{36}$/i.test(id ?? "")) return ERR.invalid("Falta el id de la plantilla");
    const { data, error } = await ctx.db.rpc("eliminar_gasto_recurrente", { p_id: id });
    if (error) return fail(mensajeDb(error.message), 422);
    return ok(data);
  },
  { roles: ["ADMIN"] },
);
