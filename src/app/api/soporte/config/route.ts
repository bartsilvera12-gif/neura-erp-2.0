/**
 * Configuración general de Soporte (pestaña "General").
 *   GET /api/soporte/config → { qa_activo, responsable_defecto_id, hora_inicio, hora_fin, sabado_hasta }
 *   PUT /api/soporte/config { ...lo mismo } → guarda (solo ADMIN)
 *
 * qa_activo apagado: En proceso / Re-abierto pasan directo a Resuelto y no se
 * ofrece "Listo para revisión". El responsable por defecto lo pone la base al
 * crear el ticket. El horario laboral mide el SLA.
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { accesoSoporte, falla, invalidarConfig, leerConfig, sinAccesoSoporte } from "@/modules/soporte/server";

export const GET = withTenant(async (ctx) => {
  if (!(await accesoSoporte(ctx))) return sinAccesoSoporte();
  return ok(await leerConfig(ctx));
});

const hora = z.coerce.number().int("Hora inválida").min(0, "Hora inválida").max(24, "Hora inválida");
const esquema = z.object({
  qa_activo: z.boolean().optional(),
  responsable_defecto_id: z.string().uuid("Responsable inválido").nullable().optional(),
  hora_inicio: hora.optional(),
  hora_fin: hora.optional(),
  sabado_hasta: hora.optional(),
});

export const PUT = withTenant(
  async (ctx, _req, input) => {
    const actual = await leerConfig(ctx);
    const nuevo = {
      qa_activo: input.qa_activo ?? actual.qa_activo,
      responsable_defecto_id: input.responsable_defecto_id === undefined ? actual.responsable_defecto_id : input.responsable_defecto_id,
      hora_inicio: input.hora_inicio ?? actual.hora_inicio,
      hora_fin: input.hora_fin ?? actual.hora_fin,
      sabado_hasta: input.sabado_hasta ?? actual.sabado_hasta,
    };
    if (nuevo.hora_fin <= nuevo.hora_inicio) return falla("La hora de fin tiene que ser posterior a la de inicio");
    if (nuevo.sabado_hasta !== 0 && nuevo.sabado_hasta <= nuevo.hora_inicio) {
      return falla("El sábado tiene que terminar después de la hora de inicio (o 0 si no se trabaja)");
    }
    if (nuevo.responsable_defecto_id) {
      const { data } = await ctx.db.select("usuarios", "id").eq("id", nuevo.responsable_defecto_id).eq("activo", true).maybeSingle();
      if (!data) return falla("El responsable por defecto no es un usuario activo");
    }
    const fila = { ...nuevo, updated_at: new Date().toISOString() };
    const { data: existe } = await ctx.db.select("soporte_config", "empresa_id").maybeSingle();
    const { error } = existe ? await ctx.db.update("soporte_config", fila) : await ctx.db.insert("soporte_config", fila);
    if (error) return falla("No se pudo guardar la configuración");
    invalidarConfig(ctx);
    return ok(await leerConfig(ctx));
  },
  { permiso: "configuracion", body: esquema },
);
