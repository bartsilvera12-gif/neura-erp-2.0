/**
 * Nota de crédito en PDF A4 (receta 99). GET /api/notas-credito/[id]/pdf
 */
import { datosEmpresa } from "@/modules/empresa/server";
import { withTenant } from "@/lib/api/with-tenant";
import { fail, ERR } from "@/lib/api/responses";
import { respuestaPdf } from "@/lib/pdf/documento";
import { pdfNotaCredito } from "@/lib/pdf/nota-credito";
import { UUID_RE, idDeRuta, idInvalido } from "@/modules/inventario/server/ids";
import type { NotaCreditoDetalle } from "@/modules/caja/notas-credito";

export const runtime = "nodejs";

export const GET = withTenant(async (ctx, req) => {
  const id = idDeRuta(req.url, "notas-credito");
  if (!UUID_RE.test(id ?? "")) return idInvalido("nota de crédito");
  const { data, error } = await ctx.db.rpc<NotaCreditoDetalle>("nota_credito_detalle", { p_id: id });
  if (error) return /no encontrada/i.test(error.message) ? fail("Nota de crédito no encontrada", 404) : ERR.server();
  if (!data) return ERR.notFound("nota de crédito");
  const doc = await pdfNotaCredito(data, await datosEmpresa(ctx.db));
  return respuestaPdf(doc, `nota-de-credito-${data.nota.numero}.pdf`);
});
