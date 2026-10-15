/**
 * Retiro / ingreso de EFECTIVO documentado (MC-000001). POST /api/caja/movimientos
 *   { caja_id, tipo: "retiro" | "ingreso", motivo, detalle?, monto } → { id, numero }
 * Motivos de retiro: deposito_banco | retiro_dueno | caja_fuerte | otro; de ingreso:
 * cambio | aporte | devolucion_retiro | otro ("otro" pide el detalle). Un retiro no puede
 * superar el efectivo que debería haber en la caja. Las compras, gastos y pagos a
 * proveedores en efectivo salen de la caja desde sus propios módulos.
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { created, ERR } from "@/lib/api/responses";
import { falloRpc } from "@/modules/inventario/server/rpc";

const movSchema = z.object({
  caja_id: z.string().uuid("Elegí la caja"),
  tipo: z.enum(["retiro", "ingreso"]),
  motivo: z.string().trim().min(1).max(30),
  detalle: z.string().trim().max(200).nullish(),
  monto: z.coerce.number().positive("El monto tiene que ser mayor a cero"),
});

export const POST = withTenant(
  async (ctx, _req, input) => {
    const { data, error } = await ctx.db.rpc("registrar_movimiento_caja", { p: input });
    if (error) return falloRpc(error);
    if (!data) return ERR.server();
    return created(data);
  },
  { permiso: "movimientos_caja", body: movSchema },
);
