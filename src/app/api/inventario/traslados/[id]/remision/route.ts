/**
 * Nota de remisión de un traslado en PDF. GET /api/inventario/traslados/[id]/remision
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ERR, fail } from "@/lib/api/responses";
import { respuestaPdf } from "@/lib/pdf/documento";
import { pdfRemision } from "@/lib/pdf/remision";
import { UUID_RE, idDeRuta, idInvalido } from "@/modules/inventario/server/ids";
import type { TrasladoDetalle } from "@/modules/inventario/documentos";

export const runtime = "nodejs";

export const GET = withTenant(async (ctx, req) => {
  const id = idDeRuta(req.url, "traslados");
  if (!UUID_RE.test(id ?? "")) return idInvalido("traslado");
  const { data, error } = await ctx.db.rpc<TrasladoDetalle>("traslado_detalle", { p_id: id });
  if (error) return /no encontrado/i.test(error.message) ? fail("Traslado no encontrado", 404) : ERR.server();
  if (!data) return ERR.notFound("traslado");
  const doc = await pdfRemision(data);
  return respuestaPdf(doc, `remision-${data.remision_numero}.pdf`);
});
