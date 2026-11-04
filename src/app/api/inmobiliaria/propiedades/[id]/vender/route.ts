/**
 * Vender una propiedad (receta 131), desde la caja abierta del usuario.
 *   POST /api/inmobiliaria/propiedades/<id>/vender
 *     { cliente_id, contado, pagos[{ metodo_pago, monto, referencia? }], plan_id?, cuotas?, cuotas_cada?,
 *       plazo_dias?, entrega?, tipo_documento, idempotency_key }
 *   Contado: los pagos cubren el total. En cuotas: los pagos son la entrega (se cobra en el mismo paso).
 *   La base exige los permisos de siempre: vender a crédito y registrar cobros.
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { fail, ok } from "@/lib/api/responses";
import { falloInmo, idDe } from "@/modules/inmobiliaria/server";

export const dynamic = "force-dynamic";

const esquema = z.object({
  cliente_id: z.string().uuid("Elegí el comprador"),
  contado: z.boolean(),
  pagos: z.array(z.object({
    metodo_pago: z.enum(["efectivo", "transferencia", "tarjeta", "cheque"]),
    monto: z.number().positive(),
    referencia: z.string().trim().max(120).nullish(),
  }).strict()).max(4),
  plan_id: z.string().uuid().nullish(),
  cuotas: z.number().int().min(1).max(360).nullish(),
  cuotas_cada: z.enum(["mes", "quincena", "semana"]).nullish(),
  plazo_dias: z.number().int().min(1).max(3650).nullish(),
  entrega: z.number().min(0).nullish(),
  tipo_documento: z.enum(["ticket", "factura"]),
  idempotency_key: z.string().min(8).max(80),
}).strict();

export const POST = withTenant(async (ctx, req, body) => {
  const id = idDe(req, "propiedades");
  if (!id) return fail("Propiedad inválida", 400);
  const { data, error } = await ctx.db.rpc("propiedad_vender", { p: { ...body, propiedad_id: id } });
  if (error) return falloInmo(error, "No se pudo vender la propiedad");
  return ok(data);
}, { body: esquema });
