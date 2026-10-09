/**
 * Suscripciones de todos los clientes.
 *   GET  /api/suscripciones?estado=activa|pausada|cancelada&q=&periodo=YYYY-MM
 *        → listar_suscripciones: { periodo, rows, kpis } (la cuota del mes elegido de cada una)
 *   POST /api/suscripciones → crear_suscripcion → { id }. No emite ninguna cuota: eso es
 *        siempre con un botón visible ("Emitir cuota").
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { created, ok } from "@/lib/api/responses";
import { errorDb, periodoDe } from "@/modules/clientes/suscripciones/server";

export const GET = withTenant(async (ctx, req) => {
  const sp = new URL(req.url).searchParams;
  const estado = sp.get("estado");
  const { data, error } = await ctx.db.rpc("listar_suscripciones", {
    p_estado: estado === "activa" || estado === "pausada" || estado === "cancelada" ? estado : null,
    p_q: sp.get("q")?.trim().slice(0, 200) || null,
    p_periodo: periodoDe(sp.get("periodo")),
  });
  if (error) return errorDb(error, "No se pudieron cargar las suscripciones");
  return ok(data);
});

const crear = z
  .object({
    cliente_id: z.string().uuid("Falta el cliente"),
    plan_id: z.string().uuid("Elegí un plan"),
    precio: z.coerce.number().min(0, "El precio no puede ser negativo").optional().nullable(),
    fecha_inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha de inicio inválida").optional().nullable(),
    duracion_meses: z.coerce.number().int().min(1, "La duración es de al menos 1 mes").max(600).optional().nullable(),
    dia_facturacion: z.coerce.number().int().min(1, "Día de facturación: 1 a 28").max(28, "Día de facturación: 1 a 28").default(1),
    dia_vencimiento: z.coerce.number().int().min(1, "Día de vencimiento: 1 a 31").max(31, "Día de vencimiento: 1 a 31").default(10),
    observacion: z.string().trim().max(500).optional().nullable(),
  })
  .refine((v) => v.dia_vencimiento >= v.dia_facturacion, { message: "El día de vencimiento no puede ser antes del día de facturación" });

export const POST = withTenant(
  async (ctx, _req, input) => {
    const { data, error } = await ctx.db.rpc<{ id: string }>("crear_suscripcion", {
      p: {
        cliente_id: input.cliente_id,
        plan_id: input.plan_id,
        precio: input.precio ?? null,
        fecha_inicio: input.fecha_inicio || null,
        duracion_meses: input.duracion_meses ?? null,
        dia_facturacion: input.dia_facturacion,
        dia_vencimiento: input.dia_vencimiento,
        observacion: input.observacion || null,
      },
    });
    if (error) return errorDb(error, "No se pudo crear la suscripción");
    return created(data);
  },
  { roles: ["ADMIN", "VENDEDOR"], body: crear },
);
