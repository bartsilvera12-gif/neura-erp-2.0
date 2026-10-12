/**
 * Una cola de atención (solo ADMIN).
 *   PATCH  /api/conversaciones/colas/[cid] { …misma forma que el alta… } → { id }
 *   DELETE /api/conversaciones/colas/[cid] → { id }   (los chats que estaban en ella quedan sin cola)
 */
import { withTenant } from "@/lib/api/with-tenant";
import { fail, ok, ERR } from "@/lib/api/responses";
import { idDeRuta } from "@/modules/tipificacion/server";
import { esquemaCola, guardarCola } from "@/modules/conversaciones/colas-server";

export const dynamic = "force-dynamic";

export const PATCH = withTenant(
  async (ctx, req, input) => {
    const id = idDeRuta(req, "colas");
    if (!id) return ERR.invalid("Cola inválida");
    const r = await guardarCola(ctx, id, input);
    if (!r.ok) return fail(r.mensaje, r.status);
    return ok({ id: r.id });
  },
  { roles: ["ADMIN"], body: esquemaCola },
);

export const DELETE = withTenant(
  async (ctx, req) => {
    const id = idDeRuta(req, "colas");
    if (!id) return ERR.invalid("Cola inválida");
    const { data, error } = await ctx.db.delete("chat_colas").eq("id", id).select("id");
    if (error) {
      console.error("[conversaciones] borrar cola", error.message);
      return ERR.server();
    }
    if (!data?.length) return ERR.notFound("Cola");
    return ok({ id });
  },
  { roles: ["ADMIN"] },
);
