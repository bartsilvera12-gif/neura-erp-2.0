/**
 * Bot de venta por WhatsApp del rubro Sorteos (receta 125) — configuración (Administrador).
 *   GET /api/sorteos/whatsapp → { activo, canal_id, bienvenida, canales[], sorteos[], lector }
 *   PUT /api/sorteos/whatsapp { activo, canal_id, bienvenida }
 * `lector`: si el servidor tiene configurada la lectura automática de comprobantes.
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { lectorConfigurado } from "@/lib/sorteos/lector-comprobante";
import { falloSorteo } from "@/modules/sorteos/server";

export const dynamic = "force-dynamic";

export const GET = withTenant(async (ctx) => {
  const { data, error } = await ctx.db.rpc<Record<string, unknown>>("sorteo_bot_config_leer", {});
  if (error || !data) return falloSorteo(error ?? { message: "" }, "No se pudo leer la configuración del bot");
  return ok({ ...data, lector: lectorConfigurado() });
}, { permiso: "sorteos_administrar" });

const cuerpo = z.object({
  activo: z.boolean(),
  canal_id: z.string().uuid().nullish(),
  bienvenida: z.string().trim().max(1000).nullish(),
});

export const PUT = withTenant(async (ctx, _req, body) => {
  const { data, error } = await ctx.db.rpc<Record<string, unknown>>("sorteo_bot_config_guardar", { p: body });
  if (error || !data) return falloSorteo(error ?? { message: "" }, "No se pudo guardar la configuración del bot");
  return ok({ ...data, lector: lectorConfigurado() });
}, { permiso: "sorteos_administrar", body: cuerpo });
