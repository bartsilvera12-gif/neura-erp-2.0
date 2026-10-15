/**
 * Sucursales y depósitos (Inventario › Depósitos).
 *   GET  /api/inventario/depositos → { sucursales[{…, depositos[]}], usuarios[] (ADMIN), mi_sucursal_id,
 *        mi_deposito_id, es_admin, traslados_en_transito, ajustes_pendientes }  (sucursales_depositos)
 *   POST /api/inventario/depositos { id?, sucursal_id, nombre, descripcion?, es_principal?, activo? } → { id }
 *        alta / edición de un depósito (ADMIN, guardar_deposito: no deja desactivar uno con stock
 *        o con traslados en tránsito, ni dejar a una sucursal sin depósito principal).
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import { falloRpc } from "@/modules/inventario/server/rpc";

export const GET = withTenant(async (ctx) => {
  const { data, error } = await ctx.db.rpc("sucursales_depositos");
  if (error || !data) return ERR.server();
  return ok(data);
});

const cuerpo = z.object({
  id: z.string().uuid().nullish(),
  sucursal_id: z.string().uuid("Elegí la sucursal"),
  nombre: z.string().trim().min(1, "Escribí el nombre del depósito").max(80),
  descripcion: z.string().trim().max(300).nullish(),
  es_principal: z.boolean().default(false),
  activo: z.boolean().default(true),
});

export const POST = withTenant(
  async (ctx, _req, input) => {
    const { data, error } = await ctx.db.rpc("guardar_deposito", { p: input });
    if (error) return falloRpc(error);
    return ok(data);
  },
  { permiso: "configuracion", body: cuerpo },
);
