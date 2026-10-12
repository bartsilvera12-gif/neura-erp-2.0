/**
 * Un comprobante de compra.
 *   GET    /api/compras/[id]/comprobantes/[cid] → { url, url_descarga } firmadas (5 min)
 *   DELETE /api/compras/[id]/comprobantes/[cid] → lo quita (ADMIN): fila + archivo
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import { borrarComprobante, prefijoComprobantes, urlComprobante } from "@/lib/compras/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ids(req: Request): { compra: string; comp: string } | null {
  const segs = new URL(req.url).pathname.split("/").filter(Boolean);
  const i = segs.indexOf("compras");
  const compra = segs[i + 1];
  const comp = segs[i + 3];
  return RE_UUID.test(compra ?? "") && RE_UUID.test(comp ?? "") ? { compra, comp } : null;
}

type Fila = { id: string; nombre: string; storage_path: string };

export const GET = withTenant(async (ctx, req) => {
  const p = ids(req);
  if (!p) return ERR.invalid("Comprobante inválido");
  const { data, error } = await ctx.db
    .select("compras_comprobantes", "id, nombre, storage_path")
    .eq("id", p.comp)
    .eq("compra_id", p.compra)
    .limit(1);
  if (error) return ERR.server();
  const c = data?.[0] as unknown as Fila | undefined;
  if (!c) return ERR.notFound("comprobante");
  // Defensa extra: la ruta guardada tiene que estar dentro del prefijo de esta empresa y compra.
  if (!c.storage_path.startsWith(prefijoComprobantes(ctx.empresaId, p.compra))) return ERR.forbidden();
  const [url, url_descarga] = await Promise.all([urlComprobante(c.storage_path), urlComprobante(c.storage_path, c.nombre)]);
  if (!url) return ERR.server();
  return ok({ url, url_descarga });
});

export const DELETE = withTenant(
  async (ctx, req) => {
    const p = ids(req);
    if (!p) return ERR.invalid("Comprobante inválido");
    const { data, error } = await ctx.db
      .select("compras_comprobantes", "id, nombre, storage_path")
      .eq("id", p.comp)
      .eq("compra_id", p.compra)
      .limit(1);
    if (error) return ERR.server();
    const c = data?.[0] as unknown as Fila | undefined;
    if (!c) return ERR.notFound("comprobante");
    const del = await ctx.db.delete("compras_comprobantes").eq("id", c.id);
    if (del.error) return ERR.server();
    if (c.storage_path.startsWith(prefijoComprobantes(ctx.empresaId, p.compra))) await borrarComprobante(c.storage_path);
    return ok({ id: c.id });
  },
  { roles: ["ADMIN"] },
);
