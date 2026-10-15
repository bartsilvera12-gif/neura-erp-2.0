/**
 * Alta / edición de una sucursal (ADMIN).
 *   POST /api/inventario/sucursales { id?, nombre, direccion?, ciudad?, telefono?, establecimiento?,
 *        punto_expedicion?, es_principal?, activa?, deposito_nombre? } → { id }
 * En el alta se crea también su depósito principal (deposito_nombre, por defecto
 * "Depósito <sucursal>"). Establecimiento y punto de expedición (3 dígitos) numeran las
 * notas de remisión de los traslados que salen de ella.
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { falloRpc } from "@/modules/inventario/server/rpc";

const tresDigitos = z.string().trim().regex(/^\d{3}$/, "Son 3 dígitos (ej. 001)").nullish().or(z.literal(""));

const cuerpo = z.object({
  id: z.string().uuid().nullish(),
  nombre: z.string().trim().min(1, "Escribí el nombre de la sucursal").max(80),
  direccion: z.string().trim().max(200).nullish(),
  ciudad: z.string().trim().max(80).nullish(),
  telefono: z.string().trim().max(40).nullish(),
  establecimiento: tresDigitos,
  punto_expedicion: tresDigitos,
  es_principal: z.boolean().default(false),
  activa: z.boolean().default(true),
  deposito_nombre: z.string().trim().max(80).nullish(),
});

export const POST = withTenant(
  async (ctx, _req, input) => {
    const { data, error } = await ctx.db.rpc("guardar_sucursal", { p: input });
    if (error) return falloRpc(error);
    return ok(data);
  },
  { roles: ["ADMIN"], body: cuerpo },
);
