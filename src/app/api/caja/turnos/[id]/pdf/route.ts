/**
 * Cierre de caja en PDF (o arqueo parcial si el turno sigue abierto).
 *   GET /api/caja/turnos/<id>/pdf → application/pdf (descarga)
 */
import { datosEmpresa } from "@/modules/empresa/server";
import { withTenant } from "@/lib/api/with-tenant";
import { ERR, fail } from "@/lib/api/responses";
import { respuestaPdf } from "@/lib/pdf/documento";
import { pdfCierreCaja } from "@/lib/pdf/cierre-caja";
import { UUID_RE, idDeRuta, idInvalido } from "@/modules/inventario/server/ids";
import type { ResumenTurno } from "@/modules/caja/turno";

export const runtime = "nodejs";

export const GET = withTenant(async (ctx, req) => {
  const id = idDeRuta(req.url, "turnos");
  if (!UUID_RE.test(id ?? "")) return idInvalido("turno");
  const { data, error } = await ctx.db.rpc<ResumenTurno>("resumen_turno", { p_caja: id });
  if (error) return /no encontrado/i.test(error.message) ? fail("Turno no encontrado", 404) : ERR.server();
  if (!data) return ERR.notFound("turno");
  const doc = await pdfCierreCaja(data, await datosEmpresa(ctx.db));
  const dia = new Date(data.caja.fecha_apertura).toLocaleDateString("en-CA", { timeZone: "America/Asuncion" });
  return respuestaPdf(doc, `cierre-caja-turno-${data.caja.numero_caja}-${dia}.pdf`);
});
