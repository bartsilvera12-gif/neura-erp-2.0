/**
 * Movimientos de caja — plata que entra/sale del cajón sin pasar por una venta
 * (retiro para combustible, adelanto, ajuste de vuelto). Fiel a JM:
 *   - solo sobre la caja ABIERTA (tocar una cerrada sería un ajuste contable, no caja)
 *   - monto siempre positivo; el signo lo da `tipo` (como los que escribe la venta)
 *
 *   GET  /api/caja/movimientos  → movimientos de la caja abierta
 *   POST /api/caja/movimientos  → carga un movimiento { tipo, concepto, monto, medio_pago }
 */
import { z } from "zod";
import { hoyPY } from "@/lib/fecha/paraguay";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, created, fail, ERR } from "@/lib/api/responses";

const ROLES_CAJA = ["ADMIN", "CAJERO", "VENDEDOR"];

/** Devuelve la caja abierta o null (helper interno). */
async function cajaAbierta(ctx: { db: { select: (t: string, c?: string) => any } }) {
  const { data } = await ctx.db.select("cajas", "id, numero_caja").eq("estado", "abierta").limit(1);
  return data?.[0] ?? null;
}

export const GET = withTenant(async (ctx) => {
  const caja = await cajaAbierta(ctx);
  if (!caja) return ok({ caja: null, movimientos: [] });
  const { data, error } = await ctx.db
    .select("caja_movimientos", "id, tipo, concepto, monto, medio_pago, categoria, usuario_email, created_at, anulado_at")
    .eq("caja_id", caja.id)
    .order("created_at", { ascending: false });
  if (error) return ERR.server();
  return ok({ caja, movimientos: data ?? [] });
});

const movSchema = z.object({
  tipo: z.enum(["ingreso", "egreso", "retiro", "ajuste"]),
  concepto: z.string().trim().min(1, "Poné para qué es el movimiento"),
  monto: z.coerce.number().positive("El monto debe ser mayor a 0"),
  medio_pago: z.enum(["efectivo", "transferencia", "tarjeta", "cheque", "otro"]).default("efectivo"),
  observacion: z.string().trim().max(500).nullish(),
});

export const POST = withTenant(
  async (ctx, _req, input) => {
    const caja = await cajaAbierta(ctx);
    if (!caja) return fail("No hay una caja abierta para cargar el movimiento.", 409);

    const { data, error } = await ctx.db.insert("caja_movimientos", {
      caja_id: caja.id,
      tipo: input.tipo,
      concepto: input.concepto,
      monto: input.monto,
      medio_pago: input.medio_pago,
      observacion: input.observacion ?? null,
      usuario_id: ctx.usuarioId,
      usuario_email: ctx.user.email ?? null,
      fecha: hoyPY(),
    });
    if (error || !data?.[0]) return ERR.server();
    return created({ movimiento_id: data[0].id });
  },
  { roles: ROLES_CAJA, body: movSchema },
);
