/**
 * Estado de cuenta de un cliente. GET /api/clientes/[id]/estado-cuenta
 * → { cuentas (con días de atraso), cobros (con medios y a qué se aplicaron), deuda, vencido }
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";

export const GET = withTenant(async (ctx, req) => {
  const segs = new URL(req.url).pathname.split("/").filter(Boolean);
  const id = segs[segs.indexOf("clientes") + 1];
  if (!/^[0-9a-f-]{36}$/i.test(id ?? "")) return ERR.invalid("Falta el id del cliente");
  const { data, error } = await ctx.db.rpc("estado_cuenta_cliente", { p_cliente: id });
  if (error) return ERR.server();
  return ok(data);
});
