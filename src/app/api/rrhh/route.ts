/** GET /api/rrhh → todos los usuarios con su legajo (receta 118). */
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { errorDb } from "@/modules/clientes/suscripciones/server";

export const GET = withTenant(async (ctx) => {
  const { data, error } = await ctx.db.rpc("rrhh_listado");
  if (error) return errorDb(error, "No se pudo leer el personal");
  return ok(data);
}, { permiso: "administrar_rrhh" });
