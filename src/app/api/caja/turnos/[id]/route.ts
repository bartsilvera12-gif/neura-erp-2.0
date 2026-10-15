/**
 * Turno de caja — resumen completo (resumen_turno, receta 51): arqueo por método, efectivo,
 * ventas contado / crédito, cobros, egresos, retiros e ingresos, crédito otorgado, ventas y
 * movimientos. GET /api/caja/turnos/<id>
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, fail, ERR } from "@/lib/api/responses";
import { UUID_RE, idDeRuta, idInvalido } from "@/modules/inventario/server/ids";

export const GET = withTenant(async (ctx, req) => {
  const id = idDeRuta(req.url, "turnos");
  if (!UUID_RE.test(id ?? "")) return idInvalido("turno");
  const { data, error } = await ctx.db.rpc("resumen_turno", { p_caja: id });
  if (error) return /no encontrado/i.test(error.message) ? fail("Turno no encontrado", 404) : ERR.server();
  return ok(data);
});
