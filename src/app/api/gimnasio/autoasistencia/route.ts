/**
 * Link de autoasistencia (receta 153): el alumno marca su llegada con su CI y su PIN.
 *   GET  /api/gimnasio/autoasistencia → { token, puede_cambiar }  (lo crea la primera vez)
 *   POST /api/gimnasio/autoasistencia { rehacer: true } → link nuevo; el viejo deja de andar (gimnasio_administrar)
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { falloGim } from "@/modules/gimnasio/server";

export const dynamic = "force-dynamic";

export const GET = withTenant(async (ctx) => {
  const { data, error } = await ctx.db.rpc("gim_autoasistencia_link", { p_rehacer: false });
  if (error) return falloGim(error, "No se pudo leer el link");
  // El nombre de la empresa, para el cartel que se imprime.
  const info = await ctx.db.rpc("gim_publico_info", { p_token: (data as { token: string }).token });
  return ok({ ...(data as object), empresa: (info.data as { empresa?: string } | null)?.empresa ?? null });
}, { permiso: "gimnasio_recepcion" });

export const POST = withTenant(async (ctx) => {
  const { data, error } = await ctx.db.rpc("gim_autoasistencia_link", { p_rehacer: true });
  if (error) return falloGim(error, "No se pudo cambiar el link");
  return ok(data);
}, { permiso: "gimnasio_administrar", body: z.object({ rehacer: z.literal(true) }) });