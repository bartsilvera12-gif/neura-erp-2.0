/**
 * Venta (POS) — registra una venta de la caja. Portado de distribuidorajm, re-plomado a 2.0.
 *   POST /api/caja/venta  → crea una venta { cliente_id?, tipo_venta, metodo_pago, items[], pagos[]? }
 *
 * La venta es TRANSACCIONAL (header + ítems + descuento de stock + cobro en caja), y PostgREST
 * no hace transacciones multi-tabla, así que la escritura va por la función `crear_venta`
 * (plpgsql, SECURITY INVOKER, bajo RLS). Precio e IVA salen del catálogo en la base — el cliente
 * no los manda — así no se puede falsear el total. `idempotency_key` evita duplicar la venta si
 * el POS reintenta.
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { created, fail, ERR } from "@/lib/api/responses";

const ROLES_CAJA = ["ADMIN", "CAJERO", "VENDEDOR"];

const ventaSchema = z.object({
  cliente_id: z.string().uuid().nullish(),
  tipo_venta: z.enum(["CONTADO", "CREDITO"]).default("CONTADO"),
  metodo_pago: z.enum(["efectivo", "transferencia", "tarjeta", "pos", "cheque", "qr", "billetera", "mixto", "otro"]).default("efectivo"),
  moneda: z.enum(["GS", "USD"]).default("GS"),
  observaciones: z.string().trim().max(500).nullish(),
  idempotency_key: z.string().trim().max(120).nullish(),
  // Descuento global (%) prorrateado por línea en el backend.
  descuento_pct: z.coerce.number().min(0).max(100).default(0),
  // Plazo de crédito (días). Solo se usa cuando tipo_venta === "CREDITO".
  plazo_dias: z.coerce.number().int().positive().nullish(),
  // Venta que sale de un presupuesto (Presupuestos → "Convertir a venta"): al registrarse,
  // el presupuesto queda "convertido" y la venta guarda presupuesto_id.
  presupuesto_id: z.string().uuid().nullish(),
  items: z
    .array(
      z.object({
        producto_id: z.string().uuid(),
        cantidad: z.coerce.number().positive("La cantidad debe ser mayor a 0"),
        tipo_precio: z.enum(["minorista", "mayorista", "distribuidor", "costo"]).default("minorista"),
        // IVA por producto (override del catálogo). El servidor sólo acepta estos valores.
        tipo_iva: z.enum(["10%", "5%", "EXENTA"]).optional(),
        // Precio unitario manual (editar precio en la línea). Si viene, pisa el de lista.
        precio_unitario: z.coerce.number().positive().optional(),
        // Descuento del producto (%). En súper el descuento es por ítem.
        descuento_pct: z.coerce.number().min(0).max(100).optional(),
      }),
    )
    .min(1, "La venta debe tener al menos un ítem"),
  // Pago (simple o MIXTO). Cada entrada es un medio con su monto; la suma debe
  // cuadrar con el total (lo valida la RPC). Los métodos con tipo (tarjeta/POS
  // débito/crédito) se guardan detallados; la RPC deriva la categoría de caja.
  pagos: z
    .array(
      z.object({
        metodo_pago: z.enum([
          "efectivo", "transferencia", "cheque",
          "tarjeta_debito", "tarjeta_credito", "pos_debito", "pos_credito",
          "tarjeta", "pos", "qr", "billetera", "otro",
        ]),
        monto: z.coerce.number().positive(),
        referencia: z.string().trim().max(120).nullish(),
        titular: z.string().trim().max(120).nullish(),
      }),
    )
    .optional(),
});

export const POST = withTenant(
  async (ctx, _req, input) => {
    // Presupuesto: se valida ANTES de cobrar (ya convertido o rechazado → no se cobra).
    if (input.presupuesto_id) {
      const pre = await ctx.db.rpc("presupuesto_puede_convertir", { p_id: input.presupuesto_id });
      if (pre.error) return fail(pre.error.message.replace(/^.*?ERROR:\s*/, ""), 409);
    }

    const { data, error } = await ctx.db.rpc<{
      venta_id: string;
      numero_control: string;
      total: number;
      reusada: boolean;
    }>("crear_venta", {
      p_cliente_id: input.cliente_id ?? null,
      p_tipo_venta: input.tipo_venta,
      p_metodo_pago: input.metodo_pago,
      p_moneda: input.moneda,
      p_observaciones: input.observaciones ?? null,
      p_items: input.items,
      p_pagos: input.pagos ?? null,
      p_idempotency_key: input.idempotency_key ?? null,
      p_descuento_pct: input.descuento_pct ?? 0,
      p_plazo_dias: input.tipo_venta === "CREDITO" ? (input.plazo_dias ?? null) : null,
    });

    if (error) {
      // La función levanta excepciones de negocio (stock, caja, etc.) con mensaje claro.
      return fail(error.message || "No se pudo registrar la venta.", 409);
    }
    if (!data) return ERR.server();

    // La venta ya quedó registrada: se marca el presupuesto (idempotente). Si esto fallara,
    // la venta NO se pierde: se avisa para vincularlo de nuevo desde el presupuesto.
    if (input.presupuesto_id) {
      const conv = await ctx.db.rpc("presupuesto_marcar_convertido", { p_id: input.presupuesto_id, p_venta_id: data.venta_id });
      if (conv.error) {
        return created({ ...data, aviso_presupuesto: `La venta quedó registrada, pero no se pudo marcar el presupuesto: ${conv.error.message.replace(/^.*?ERROR:\s*/, "")}` });
      }
    }
    return created(data);
  },
  { roles: ROLES_CAJA, body: ventaSchema },
);
