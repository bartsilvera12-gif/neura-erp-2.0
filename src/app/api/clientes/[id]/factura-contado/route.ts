/**
 * "Factura al contado" de la ficha (como el sistema actual): un servicio puntual sin
 * productos ni caja. Nace la venta con su cuenta a cobrar que vence hoy.
 *   POST /api/clientes/[id]/factura-contado  { monto, descripcion?, tipo_iva }
 *        → { venta_id, numero_control, total, moneda }
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { created, ERR } from "@/lib/api/responses";
import { errorDb, idDeRuta } from "@/modules/clientes/suscripciones/server";

const cuerpo = z.object({
  monto: z.coerce.number().positive("El monto debe ser mayor a 0"),
  descripcion: z.string().trim().max(200).nullish(),
  tipo_iva: z.enum(["10%", "5%", "exenta"]),
});

export const POST = withTenant(
  async (ctx, req, input) => {
    const id = idDeRuta(req, "clientes");
    if (!id) return ERR.invalid("Falta el id del cliente");
    const { data, error } = await ctx.db.rpc("emitir_factura_contado", {
      p_cliente: id, p_monto: input.monto, p_descripcion: input.descripcion ?? null, p_tipo_iva: input.tipo_iva,
    });
    if (error) return errorDb(error, "No se pudo emitir la factura");
    return created(data);
  },
  { roles: ["ADMIN", "VENDEDOR", "CAJERO", "SUPERVISOR"], body: cuerpo },
);
