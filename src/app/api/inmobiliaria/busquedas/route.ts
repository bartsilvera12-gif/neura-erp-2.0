/**
 * Lo que busca un cliente (receta 134).
 *   POST /api/inmobiliaria/busquedas { id?, cliente_id, gestion, tipo_id?, ciudad?, precio_max?, superficie_min?, notas?, activa }
 *        → la búsqueda con sus coincidencias (alta o edición)
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { falloInmo } from "@/modules/inmobiliaria/server";

export const dynamic = "force-dynamic";

export const POST = withTenant(async (ctx, _req, body) => {
  const { data, error } = await ctx.db.rpc("cliente_busqueda_guardar", { p: body });
  if (error) return falloInmo(error, "No se pudo guardar la búsqueda");
  return ok(data);
}, {
  body: z.object({
    id: z.string().uuid().nullish(),
    cliente_id: z.string().uuid(),
    gestion: z.enum(["venta", "alquiler"]),
    tipo_id: z.string().uuid().nullish(),
    ciudad: z.string().trim().max(80).nullish(),
    precio_max: z.number().min(0).max(1e13).nullish(),
    superficie_min: z.number().min(0).max(1e9).nullish(),
    notas: z.string().trim().max(500).nullish(),
    activa: z.boolean(),
  }).strict(),
});
