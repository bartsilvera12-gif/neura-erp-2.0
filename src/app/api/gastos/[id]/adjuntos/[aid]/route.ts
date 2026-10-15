/**
 * Un adjunto de un gasto.
 *   GET    /api/gastos/[id]/adjuntos/[aid] → { url, url_descarga } firmadas (5 min)
 *   DELETE /api/gastos/[id]/adjuntos/[aid] → lo quita (fila por gasto_adjunto_quitar + archivo)
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, fail, ERR } from "@/lib/api/responses";
import { borrarComprobante, prefijoComprobantes, urlComprobante } from "@/lib/compras/storage";
import { mensajeDb } from "@/lib/gastos/esquema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ids(req: Request): { gasto: string; adj: string } | null {
  const segs = new URL(req.url).pathname.split("/").filter(Boolean);
  const i = segs.indexOf("gastos");
  const gasto = segs[i + 1];
  const adj = segs[i + 3];
  return RE_UUID.test(gasto ?? "") && RE_UUID.test(adj ?? "") ? { gasto, adj } : null;
}

export const GET = withTenant(
  async (ctx, req) => {
    const p = ids(req);
    if (!p) return ERR.invalid("Adjunto inválido");
    const { data, error } = await ctx.db.select("gastos_adjuntos", "id, nombre, storage_path").eq("id", p.adj).eq("gasto_id", p.gasto).limit(1);
    if (error) return ERR.server();
    const a = data?.[0] as unknown as { nombre: string; storage_path: string } | undefined;
    if (!a) return ERR.notFound("adjunto");
    // Defensa extra: la ruta guardada tiene que estar dentro del prefijo de esta empresa y gasto.
    if (!a.storage_path.startsWith(prefijoComprobantes(ctx.empresaId, p.gasto))) return ERR.forbidden();
    const [url, url_descarga] = await Promise.all([urlComprobante(a.storage_path), urlComprobante(a.storage_path, a.nombre)]);
    if (!url) return ERR.server();
    return ok({ url, url_descarga });
  },
  { roles: ["ADMIN"] },
);

export const DELETE = withTenant(
  async (ctx, req) => {
    const p = ids(req);
    if (!p) return ERR.invalid("Adjunto inválido");
    const { data, error } = await ctx.db.rpc<{ id: string; storage_path: string }>("gasto_adjunto_quitar", { p_gasto: p.gasto, p_id: p.adj });
    if (error) return fail(mensajeDb(error.message), 422);
    const path = data?.storage_path;
    if (path && path.startsWith(prefijoComprobantes(ctx.empresaId, p.gasto))) await borrarComprobante(path);
    return ok({ id: p.adj });
  },
  { roles: ["ADMIN"] },
);
