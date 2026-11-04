/** POST /api/sorteos/<id>/estado { estado } → activar, pausar, cerrar o anular (sorteos_administrar). */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { fail, ok } from "@/lib/api/responses";
import { falloSorteo, idDe } from "@/modules/sorteos/server";

export const POST = withTenant(async (ctx, req, body) => {
  const id = idDe(req, "sorteos");
  if (!id) return fail("Sorteo inválido", 400);
  const { data, error } = await ctx.db.rpc("sorteo_estado", { p_id: id, p_estado: body.estado });
  if (error) return falloSorteo(error, "No se pudo cambiar el estado");
  return ok(data);
}, { permiso: "sorteos_administrar", body: z.object({ estado: z.enum(["activo", "pausado", "cerrado", "anulado"]) }) });
