/**
 * Configuración del gimnasio (receta 150): precio de la clase suelta, IVA, bloqueo por deuda y comisión.
 *   GET /api/gimnasio/config (gimnasio_recepcion) · PUT (gimnasio_administrar)
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { falloGim } from "@/modules/gimnasio/server";

export const dynamic = "force-dynamic";

const cuerpo = z.object({
  precio_clase_suelta: z.number().min(0).max(1e12),
  tipo_iva: z.enum(["10%", "5%", "exenta"]),
  bloquear_morosos: z.boolean(),
  comision_modo: z.enum(["ninguna", "por_alumno", "por_clase", "porcentaje"]),
  comision_monto: z.number().min(0).max(1e12),
  comision_pct: z.number().min(0).max(100),
}).partial();

export const GET = withTenant(async (ctx) => {
  const { data, error } = await ctx.db.rpc("gim_config_leer");
  if (error) return falloGim(error, "No se pudo leer la configuración");
  return ok(data);
}, { permiso: "gimnasio_recepcion" });

export const PUT = withTenant(async (ctx, _req, b) => {
  const { data, error } = await ctx.db.rpc("gim_config_guardar", { p: b });
  if (error) return falloGim(error, "No se pudo guardar la configuración");
  return ok(data);
}, { permiso: "gimnasio_administrar", body: cuerpo });