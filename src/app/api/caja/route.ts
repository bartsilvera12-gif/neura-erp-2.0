/**
 * Caja — estado y apertura. Portado de distribuidorajm, re-plomado a 2.0.
 *   GET  /api/caja   → la caja abierta de la empresa (o null)
 *   POST /api/caja   → abre la caja del día { monto_apertura }
 *
 * Reglas fieles a JM: solo puede haber UNA caja abierta por empresa; el monto de
 * apertura es el efectivo inicial contra el que después cuadra el arqueo.
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, created, fail, ERR } from "@/lib/api/responses";

const ROLES_CAJA = ["ADMIN", "CAJERO", "VENDEDOR"];

export const GET = withTenant(async (ctx) => {
  const { data, error } = await ctx.db
    .select("cajas", "id, numero_caja, estado, fecha_apertura, monto_apertura")
    .eq("estado", "abierta")
    .order("fecha_apertura", { ascending: false })
    .limit(1);
  if (error) return ERR.server();
  return ok({ caja: data?.[0] ?? null });
});

const abrirSchema = z.object({
  monto_apertura: z.coerce.number().min(0, "El monto de apertura debe ser ≥ 0").default(0),
  observacion: z.string().trim().max(500).nullish(),
});

export const POST = withTenant(
  async (ctx, _req, input) => {
    // No puede haber dos cajas abiertas: una venta no sabría a cuál imputarse.
    const abierta = await ctx.db.select("cajas", "numero_caja").eq("estado", "abierta").limit(1);
    if (abierta.error) return ERR.server();
    if (abierta.data?.length) {
      return fail(`Ya hay una caja abierta (N° ${abierta.data[0].numero_caja}). Cerrala antes de abrir otra.`, 409);
    }

    // Próximo número de caja de la empresa.
    const ultima = await ctx.db.select("cajas", "numero_caja").order("numero_caja", { ascending: false }).limit(1);
    const numero = (Number(ultima.data?.[0]?.numero_caja) || 0) + 1;

    const { data, error } = await ctx.db.insert("cajas", {
      estado: "abierta",
      numero_caja: numero,
      monto_apertura: input.monto_apertura,
      observacion_apertura: input.observacion ?? null,
      abierta_por: ctx.usuarioId,
      fecha_apertura: new Date().toISOString(),
    });
    if (error || !data?.[0]) return ERR.server();
    return created({ caja_id: data[0].id, numero_caja: data[0].numero_caja });
  },
  { roles: ROLES_CAJA, body: abrirSchema },
);
