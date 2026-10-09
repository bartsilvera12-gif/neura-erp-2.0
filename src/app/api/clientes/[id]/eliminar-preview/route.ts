/**
 * Lo que arrastra eliminar a un cliente (para el modal "Eliminar").
 *   GET /api/clientes/[id]/eliminar-preview → { ventas, deuda, cobros, saldo_favor, contactos,
 *       notas, puede_eliminar }   (no se puede si tiene ventas o deuda: se da de baja)
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";

function clienteId(req: { url: string }): string | null {
  const segs = new URL(req.url).pathname.split("/").filter(Boolean);
  const i = segs.indexOf("clientes");
  return i >= 0 ? (segs[i + 1] ?? null) : null;
}

type Preview = { ventas: number; deuda: number; cobros: number; saldo_favor: number; contactos: number; notas: number };

export const GET = withTenant(
  async (ctx, req) => {
    const id = clienteId(req);
    if (!id) return ERR.invalid("Falta el id del cliente");
    const r = await ctx.db.rpc<Preview>("cliente_eliminar_preview", { p_cliente: id });
    if (r.error || !r.data) return ERR.server();
    const p = r.data;
    return ok({ ...p, puede_eliminar: Number(p.ventas) === 0 && Number(p.deuda) === 0 });
  },
  { roles: ["ADMIN"] },
);
