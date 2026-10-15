/**
 * Cajas (puntos de venta) por sucursal.
 *   GET  /api/caja/cajas → listar_cajas: sucursales con sus cajas y el turno en curso de cada
 *        una, las cajas abiertas que el usuario puede usar, la que le toca por defecto y los
 *        últimos turnos cerrados. ADMIN ve todas las sucursales; el resto, la suya.
 *   POST /api/caja/cajas { id?, sucursal_id, nombre, deposito_id?, activo? } → { id }  (ADMIN)
 *        alta / edición de una caja (depósito de salida: uno activo de la misma sucursal; por
 *        defecto el principal). Abierta no se puede mover de sucursal, de depósito ni desactivar.
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import { falloRpc } from "@/modules/inventario/server/rpc";

export const GET = withTenant(async (ctx) => {
  const { data, error } = await ctx.db.rpc("listar_cajas");
  if (error || !data) return ERR.server();
  return ok(data);
});

const cuerpo = z.object({
  id: z.string().uuid().nullish(),
  sucursal_id: z.string().uuid("Elegí la sucursal"),
  nombre: z.string().trim().min(1, "Escribí el nombre de la caja").max(60, "El nombre es muy largo"),
  deposito_id: z.string().uuid().nullish(),
  activo: z.boolean().default(true),
});

export const POST = withTenant(
  async (ctx, _req, input) => {
    const { data, error } = await ctx.db.rpc("guardar_punto_venta", { p: input });
    if (error) return falloRpc(error);
    return ok(data);
  },
  { permiso: "configuracion", body: cuerpo },
);
