/**
 * Una orden de compra.
 *   GET   /api/ordenes-compra/[id] → orden + items + compras con las que se recibió
 *   PATCH /api/ordenes-compra/[id] → edita (ADMIN), solo si no se recibió nada todavía
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, fail, ERR } from "@/lib/api/responses";
import { COLS_OC, COLS_OC_ITEM, cuerpoOrden } from "@/modules/compras/ordenes";

const idDe = (req: { url: string }) => {
  const segs = new URL(req.url).pathname.split("/").filter(Boolean);
  const id = segs[segs.indexOf("ordenes-compra") + 1];
  return /^[0-9a-f-]{36}$/i.test(id ?? "") ? id : null;
};

export const GET = withTenant(async (ctx, req) => {
  const id = idDe(req);
  if (!id) return ERR.invalid("Falta el id de la orden");
  const [o, i, c] = await Promise.all([
    ctx.db.select("ordenes_compra", COLS_OC).eq("id", id).limit(1),
    ctx.db.select("ordenes_compra_items", COLS_OC_ITEM).eq("orden_compra_id", id).order("orden", { ascending: true }),
    ctx.db.select("compras", "id, numero_control, numero_factura, fecha, total, estado").eq("orden_compra_id", id).order("fecha", { ascending: true }),
  ]);
  if (o.error || i.error || c.error) return ERR.server();
  if (!o.data?.length) return ERR.notFound("orden de compra");
  return ok({ ...(o.data[0] as unknown as Record<string, unknown>), items: i.data ?? [], compras: c.data ?? [] });
});

export const PATCH = withTenant(
  async (ctx, req, input) => {
    const id = idDe(req);
    if (!id) return ERR.invalid("Falta el id de la orden");
    const { data, error } = await ctx.db.rpc("guardar_orden_compra", { p: { ...input, id } });
    if (error) return fail(error.message.replace(/^.*?ERROR:\s*/, ""), 400);
    return ok(data);
  },
  { roles: ["ADMIN"], body: cuerpoOrden },
);
