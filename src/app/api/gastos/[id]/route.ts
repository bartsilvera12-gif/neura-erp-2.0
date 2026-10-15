/**
 * Un gasto operativo.
 *   GET    /api/gastos/[id] → { gasto, items, adjuntos, cxp: { …, pagos } | null, caja: { … } | null }
 *   DELETE /api/gastos/[id] → elimina un BORRADOR (y sus adjuntos del bucket)
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, fail, ERR } from "@/lib/api/responses";
import { borrarComprobante, prefijoComprobantes } from "@/lib/compras/storage";
import { mensajeDb } from "@/lib/gastos/esquema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function gastoId(req: Request): string | null {
  const segs = new URL(req.url).pathname.split("/").filter(Boolean);
  const id = segs[segs.indexOf("gastos") + 1];
  return RE_UUID.test(id ?? "") ? id : null;
}

export const GET = withTenant(
  async (ctx, req) => {
    const id = gastoId(req);
    if (!id) return ERR.invalid("Falta el id del gasto");
    const { data, error } = await ctx.db.rpc("gasto_detalle", { p_id: id });
    if (error) return fail(mensajeDb(error.message), 422);
    if (!data) return ERR.notFound("gasto");
    return ok(data);
  },
  { roles: ["ADMIN"] },
);

export const DELETE = withTenant(
  async (ctx, req) => {
    const id = gastoId(req);
    if (!id) return ERR.invalid("Falta el id del gasto");
    const { data, error } = await ctx.db.rpc<{ id: string; paths: string[] | null }>("eliminar_gasto", { p_id: id });
    if (error) return fail(mensajeDb(error.message), 422);
    const prefijo = prefijoComprobantes(ctx.empresaId, id);
    for (const path of data?.paths ?? []) if (path.startsWith(prefijo)) await borrarComprobante(path);
    return ok({ id });
  },
  { roles: ["ADMIN"] },
);
