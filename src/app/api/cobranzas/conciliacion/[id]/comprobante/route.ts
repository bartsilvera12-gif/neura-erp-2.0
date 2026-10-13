/**
 * Comprobante de una transferencia. GET /api/cobranzas/conciliacion/[id]/comprobante
 *   → { url } firmada por 1 hora (bucket privado "cobros-comprobantes").
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR, fail } from "@/lib/api/responses";
import { urlComprobanteCobro } from "@/lib/cobranzas/storage";
import { idTras } from "@/modules/cobranzas/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withTenant(async (ctx, req) => {
  const id = idTras(req, "conciliacion");
  if (!id) return ERR.invalid("Falta el id de la transferencia");
  const { data, error } = await ctx.db.select("cobros_pendientes", "id, comprobante_path").eq("id", id).limit(1);
  if (error) return ERR.server();
  const fila = data?.[0] as unknown as { comprobante_path: string | null } | undefined;
  if (!fila) return ERR.notFound("Transferencia");
  if (!fila.comprobante_path) return fail("Esta transferencia no tiene comprobante", 404);
  // Defensa extra: la ruta guardada tiene que estar dentro de la carpeta de esta empresa.
  if (!fila.comprobante_path.startsWith(`${ctx.empresaId}/`)) return ERR.forbidden();
  const url = await urlComprobanteCobro(fila.comprobante_path);
  if (!url) return ERR.server();
  return ok({ url });
});
