/**
 * Interés por mora de la empresa (receta 135). Arranca apagado.
 *   GET /api/configuracion/mora → { activa, tasa (% mensual), gracia (días), iva }
 *   PUT /api/configuracion/mora { activa, tasa, gracia, iva } (Configuración del sistema)
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { falloRpc } from "@/modules/usuarios/server";

export const dynamic = "force-dynamic";

export const GET = withTenant(async (ctx) => {
  const { data, error } = await ctx.db.rpc("mora_config");
  if (error) return falloRpc(error);
  return ok(data);
});

export const PUT = withTenant(async (ctx, _req, body) => {
  const { data, error } = await ctx.db.rpc("mora_config_guardar", { p: body });
  if (error) return falloRpc(error);
  return ok(data);
}, {
  permiso: "configuracion",
  body: z.object({ activa: z.boolean(), tasa: z.number().min(0).max(10), gracia: z.number().int().min(0).max(90), iva: z.enum(["EXENTA", "5%", "10%"]) }).strict(),
});
