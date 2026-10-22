/**
 * Cuenta abierta de una mesa (receta 68). "Atender pedidos de mesas".
 *   POST /api/mesas/cuentas/<id> { accion: "cobrar", caja_id?, cliente_id?, cliente_ocasional, tipo_documento, pagos[] }
 *        → arma la venta (crear_venta: contado, caja abierta de la sucursal de la mesa) y cierra la cuenta.
 *   POST /api/mesas/cuentas/<id> { accion: "liberar" } → cierra sin cobrar (todo rechazado).
 * Precios y total salen de la base (lo pedido por la mesa); el cliente solo dice cómo paga.
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { created, ok, fail, ERR } from "@/lib/api/responses";
import { falloRpc } from "@/modules/inventario/server/rpc";
import { UUID_RE, idDeRuta, idInvalido } from "@/modules/inventario/server/ids";

const pago = z.object({
  metodo_pago: z.enum(["efectivo", "transferencia", "cheque", "tarjeta_debito", "tarjeta_credito", "qr", "billetera", "otro"]),
  monto: z.coerce.number().positive("Hay una forma de pago con monto en cero"),
  recibido: z.coerce.number().positive().nullish(),
  referencia: z.string().trim().max(120).nullish(),
  banco: z.string().trim().max(80).nullish(),
});

const cuerpo = z.discriminatedUnion("accion", [
  z.object({
    accion: z.literal("cobrar"),
    caja_id: z.string().uuid().nullish(),
    cliente_id: z.string().uuid().nullish(),
    cliente_ocasional: z.boolean().default(false),
    tipo_documento: z.enum(["factura", "ticket"]).default("ticket"),
    pagos: z.array(pago).min(1, "Cargá cómo paga").max(10, "Demasiadas formas de pago"),
  }),
  z.object({ accion: z.literal("liberar") }),
]);

export const POST = withTenant(
  async (ctx, req, input) => {
    const id = idDeRuta(req.url, "cuentas");
    if (!id || !UUID_RE.test(id)) return idInvalido("cuenta");
    if (!ctx.puede("pedidos_mesas")) return ERR.sinPermiso("pedidos_mesas");

    if (input.accion === "liberar") {
      const { error } = await ctx.db.rpc("mesa_cuenta_liberar", { p_cuenta_id: id });
      if (error) return falloRpc(error);
      return ok({ id });
    }

    if (input.cliente_ocasional && input.cliente_id) return fail('Elegí un cliente o "Cliente ocasional (X)", no los dos.', 400);
    const { data, error } = await ctx.db.rpc("mesa_cuenta_cobrar", {
      p_cuenta_id: id,
      p_cliente_id: input.cliente_ocasional ? null : (input.cliente_id ?? null),
      p_cliente_ocasional: input.cliente_ocasional,
      p_tipo_documento: input.tipo_documento,
      p_pagos: input.pagos,
      p_caja_id: input.caja_id ?? null,
    });
    if (error) return falloRpc(error);
    if (!data) return ERR.server();
    return created(data);
  },
  { body: cuerpo },
);
