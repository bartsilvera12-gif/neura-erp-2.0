/**
 * Interés por mora de un cliente a hoy (receta 135).
 *   GET /api/cobros/mora?cliente_id=<uuid> → { activa, tasa, gracia, iva, puede_perdonar, cuotas[{ cxc_id, numero, vencimiento, saldo, dias, interes }], total }
 */
import { withTenant } from "@/lib/api/with-tenant";
import { fail, ok } from "@/lib/api/responses";
import { falloRpc } from "@/modules/usuarios/server";

export const dynamic = "force-dynamic";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET = withTenant(async (ctx, req) => {
  const id = new URL(req.url).searchParams.get("cliente_id") ?? "";
  if (!UUID_RE.test(id)) return fail("Cliente inválido", 400);
  const { data, error } = await ctx.db.rpc("mora_calcular", { p_cliente: id });
  if (error) return falloRpc(error);
  return ok(data);
}, { permiso: "registrar_cobros" });
