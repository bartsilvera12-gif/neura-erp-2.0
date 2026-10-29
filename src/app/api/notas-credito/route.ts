/**
 * Notas de crédito (receta 99).
 *   GET  /api/notas-credito?pagina&por_pagina&estado&q&desde&hasta
 *        → { rows, total, totales }  (listar_notas_credito)
 *   POST /api/notas-credito → emite una nota sobre una venta (crear_nota_credito):
 *        { venta_id, tipo: devolucion|descuento, motivo, items?[{ venta_item_id, cantidad, vuelve_stock }],
 *          monto? (descuento), destino: devolver|saldo_favor, metodo?, referencia?, caja_id?, idempotency_key }
 *        Crédito: primero baja la deuda de la venta; lo que sobra se devuelve desde una caja o
 *        queda a favor del cliente. Lo devuelto vuelve al stock (o queda como pérdida).
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, created, ERR } from "@/lib/api/responses";
import { falloRpc, fechaONull } from "@/modules/inventario/server/rpc";

export const GET = withTenant(async (ctx, req) => {
  const sp = new URL(req.url).searchParams;
  const porPagina = Math.min(100, Math.max(10, Number(sp.get("por_pagina")) || 25));
  const pagina = Math.max(1, Number(sp.get("pagina")) || 1);
  const estado = sp.get("estado") ?? "";
  const { data, error } = await ctx.db.rpc("listar_notas_credito", {
    p_desde: fechaONull(sp.get("desde")),
    p_hasta: fechaONull(sp.get("hasta")),
    p_q: (sp.get("q") ?? "").trim().slice(0, 100) || null,
    p_estado: estado === "emitida" || estado === "anulada" ? estado : null,
    p_limit: porPagina,
    p_offset: (pagina - 1) * porPagina,
  });
  if (error) return falloRpc(error);
  if (!data) return ERR.server();
  return ok(data);
});

const cuerpo = z
  .object({
    venta_id: z.string().uuid("Falta la venta"),
    tipo: z.enum(["devolucion", "descuento"]).default("devolucion"),
    motivo: z.string().trim().min(3, "Escribí el motivo de la nota de crédito").max(500),
    items: z
      .array(
        z.object({
          venta_item_id: z.string().uuid(),
          cantidad: z.coerce.number().positive().max(10000000),
          vuelve_stock: z.boolean().default(true),
        }),
      )
      .max(200)
      .optional(),
    monto: z.coerce.number().positive("Poné el monto del descuento").max(100000000000).nullish(),
    destino: z.enum(["devolver", "saldo_favor"]).default("devolver"),
    metodo: z.enum(["efectivo", "transferencia", "tarjeta_debito", "tarjeta_credito", "qr", "cheque", "otro"]).default("efectivo"),
    referencia: z.string().trim().max(80).nullish(),
    caja_id: z.string().uuid().nullish(),
    idempotency_key: z.string().uuid().nullish(),
  })
  .refine((b) => (b.tipo === "devolucion" ? (b.items?.length ?? 0) > 0 : b.monto != null), {
    message: "Elegí qué se devuelve (o el monto del descuento)",
  });

export const POST = withTenant(
  async (ctx, _req, input) => {
    const { data, error } = await ctx.db.rpc("crear_nota_credito", { p: input });
    if (error) return falloRpc(error);
    return created(data);
  },
  { permiso: "notas_credito", body: cuerpo },
);
