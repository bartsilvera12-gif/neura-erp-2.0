/**
 * Política de comisiones de la empresa y sus escalas (receta 115). Solo Administrador.
 *   GET → { politica, escalas }
 *   PUT { nombre, activo, base_calculo, escalas[] } → { politica, escalas }. Cada guardado deja una versión.
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { errorDb } from "@/modules/clientes/suscripciones/server";

const cuerpo = z.object({
  nombre: z.string().trim().min(1, "Poné un nombre a la política").max(120),
  activo: z.boolean(),
  base_calculo: z.enum(["pago_registrado", "factura_emitida", "factura_pagada"]),
  escalas: z.array(z.object({
    desde_monto: z.coerce.number().min(0),
    hasta_monto: z.coerce.number().positive().nullable(),
    porcentaje_comision: z.coerce.number().min(0, "El porcentaje va de 0 a 100").max(100, "El porcentaje va de 0 a 100"),
    premio_fijo: z.coerce.number().min(0).nullable(),
  })).max(50),
});

export const GET = withTenant(
  async (ctx) => {
    const { data, error } = await ctx.db.rpc("comision_politica_leer");
    if (error) return errorDb(error, "No se pudo cargar la política");
    return ok(data);
  },
  { roles: ["ADMIN"] },
);

export const PUT = withTenant(
  async (ctx, _req, input) => {
    const { data, error } = await ctx.db.rpc("comision_guardar_politica", { p: input });
    if (error) return errorDb(error, "No se pudo guardar la política");
    return ok(data);
  },
  { roles: ["ADMIN"], body: cuerpo },
);
