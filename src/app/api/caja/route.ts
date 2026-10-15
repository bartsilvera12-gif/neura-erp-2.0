/**
 * Caja — la caja abierta del usuario y la apertura de un turno (receta 51).
 *   GET  /api/caja  → { caja, abiertas[] }  caja = la que le toca al usuario (la que abrió
 *        él, la única de su sucursal…) o, si hay que elegir, la primera de `abiertas`;
 *        null si no hay ninguna abierta. (Compras y pagos a proveedores lo usan para saber
 *        si se puede pagar en efectivo; la elección final la hace la base.)
 *   POST /api/caja  { punto_venta_id, monto_apertura, observacion? } → { caja_id, numero_caja }
 *        abre un turno en esa caja (de la sucursal del usuario; ADMIN cualquiera).
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, created, ERR } from "@/lib/api/responses";
import { falloRpc } from "@/modules/inventario/server/rpc";
import type { EstadoCajas } from "@/modules/caja/turno";

export const GET = withTenant(async (ctx) => {
  const { data, error } = await ctx.db.rpc<EstadoCajas>("listar_cajas");
  if (error || !data) return ERR.server();
  const caja = data.abiertas.find((c) => c.id === data.predeterminada) ?? data.abiertas[0] ?? null;
  return ok({ caja, abiertas: data.abiertas, predeterminada: data.predeterminada });
});

const abrirSchema = z.object({
  punto_venta_id: z.string().uuid("Elegí la caja que vas a abrir"),
  monto_apertura: z.coerce.number().min(0, "El monto inicial tiene que ser 0 o más").default(0),
  observacion: z.string().trim().max(500).nullish(),
});

export const POST = withTenant(
  async (ctx, _req, input) => {
    const { data, error } = await ctx.db.rpc<{ caja_id: string; numero_caja: number }>("abrir_caja", {
      p_punto_venta: input.punto_venta_id,
      p_monto: input.monto_apertura,
      p_observacion: input.observacion ?? null,
    });
    if (error) return falloRpc(error);
    if (!data) return ERR.server();
    return created(data);
  },
  { permiso: "abrir_cerrar_caja", body: abrirSchema },
);
