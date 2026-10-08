/**
 * Pagar la deuda del cliente con su saldo a favor (lo más viejo primero).
 *   POST /api/clientes/[id]/usar-saldo → { id, numero_recibo, total }
 * Queda como un cobro con medio "Saldo a favor" (no entra a la caja: esa plata ya entró).
 */
import { withTenant } from "@/lib/api/with-tenant";
import { created, fail, ERR } from "@/lib/api/responses";

export const POST = withTenant(
  async (ctx, req) => {
    const segs = new URL(req.url).pathname.split("/").filter(Boolean);
    const id = segs[segs.indexOf("clientes") + 1];
    if (!/^[0-9a-f-]{36}$/i.test(id ?? "")) return ERR.invalid("Falta el id del cliente");
    const { data, error } = await ctx.db.rpc("usar_saldo_favor", { p_cliente: id });
    if (error) return fail(error.message.replace(/^.*?ERROR:\s*/, ""), 400);
    return created(data);
  },
  { roles: ["ADMIN", "CAJERO", "VENDEDOR"] },
);
