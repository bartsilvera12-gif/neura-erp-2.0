/**
 * Actividad del cliente (la llena un trigger de la base: alta, cambios campo por campo,
 * desactivar/reactivar, baja, eliminación). Lo más nuevo primero.
 *   GET /api/clientes/[id]/historial → [{ id, accion, detalle, usuario_nombre, created_at }]
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";

function clienteId(req: { url: string }): string | null {
  const segs = new URL(req.url).pathname.split("/").filter(Boolean);
  const i = segs.indexOf("clientes");
  return i >= 0 ? (segs[i + 1] ?? null) : null;
}

export const GET = withTenant(async (ctx, req) => {
  const id = clienteId(req);
  if (!id) return ERR.invalid("Falta el id del cliente");
  const { data, error } = await ctx.db
    .select("cliente_historial", "id, accion, detalle, usuario_nombre, created_at")
    .eq("cliente_id", id)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return ERR.server();
  return ok(data ?? []);
});
