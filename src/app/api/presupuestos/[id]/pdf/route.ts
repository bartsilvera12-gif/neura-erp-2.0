/**
 * Presupuesto en PDF (para descargar y mandar). GET /api/presupuestos/[id]/pdf
 * El documento sale de presupuesto_documento (solo campos públicos: nunca las notas
 * internas) y deja constancia de la descarga en el historial.
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ERR, fail } from "@/lib/api/responses";
import { respuestaPdf } from "@/lib/pdf/documento";
import { nombreArchivoPresupuesto, pdfPresupuesto } from "@/modules/presupuestos/pdf";
import { ROLES_PRESUPUESTOS, type PresupuestoDoc } from "@/modules/presupuestos/tipos";

export const runtime = "nodejs";

export const GET = withTenant(async (ctx, req) => {
  const segs = new URL(req.url).pathname.split("/").filter(Boolean);
  const id = segs[segs.indexOf("presupuestos") + 1];
  if (!/^[0-9a-f-]{36}$/i.test(id ?? "")) return ERR.invalid("Falta el id del presupuesto");
  const { data, error } = await ctx.db.rpc<PresupuestoDoc>("presupuesto_documento", { p_id: id, p_registrar_pdf: true });
  if (error) return fail(error.message.replace(/^.*?ERROR:\s*/, ""), 404);
  if (!data) return ERR.notFound("presupuesto");
  const doc = await pdfPresupuesto(data);
  return respuestaPdf(doc, nombreArchivoPresupuesto(data.numero, data.revision));
}, { roles: ROLES_PRESUPUESTOS });
