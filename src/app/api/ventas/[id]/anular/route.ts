/**
 * POST /api/ventas/[id]/anular — anula la venta (devuelve stock + revierte el cobro).
 * Transaccional, vía la función `anular_venta`.
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, fail, ERR } from "@/lib/api/responses";

function ventaId(req: { url: string }): string | null {
  const segs = new URL(req.url).pathname.split("/").filter(Boolean);
  const i = segs.indexOf("ventas");
  return i >= 0 ? (segs[i + 1] ?? null) : null;
}

export const POST = withTenant(
  async (ctx, req) => {
    const id = ventaId(req);
    if (!id) return ERR.invalid("Falta el id de la venta");
    const { data, error } = await ctx.db.rpc<{ estado: string }>("anular_venta", { p_venta_id: id });
    if (error) return fail(error.message || "No se pudo anular la venta.", 409);
    return ok(data);
  },
  { roles: ["ADMIN", "CAJERO", "VENDEDOR"] },
);
