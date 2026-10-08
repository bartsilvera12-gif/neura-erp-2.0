/**
 * Una compra con sus productos. GET /api/compras/[id] → compra + items
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import { COLS_COMPRA, COLS_ITEM } from "@/modules/compras/tipos";

export const GET = withTenant(async (ctx, req) => {
  const segs = new URL(req.url).pathname.split("/").filter(Boolean);
  const id = segs[segs.indexOf("compras") + 1];
  if (!/^[0-9a-f-]{36}$/i.test(id ?? "")) return ERR.invalid("Falta el id de la compra");
  const [c, i] = await Promise.all([
    ctx.db.select("compras", COLS_COMPRA).eq("id", id).limit(1),
    ctx.db.select("compras_items", COLS_ITEM).eq("compra_id", id).order("orden", { ascending: true }),
  ]);
  if (c.error || i.error) return ERR.server();
  if (!c.data?.length) return ERR.notFound("compra");
  return ok({ ...(c.data[0] as unknown as Record<string, unknown>), items: i.data ?? [] });
});
