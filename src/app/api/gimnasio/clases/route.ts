/**
 * Clases del gimnasio (receta 150).
 *   GET  /api/gimnasio/clases → todas (activas primero)
 *   POST /api/gimnasio/clases → crea o cambia una (con id), gimnasio_administrar
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { falloGim } from "@/modules/gimnasio/server";

export const dynamic = "force-dynamic";

const cuerpo = z.object({
  id: z.string().uuid().optional(),
  nombre: z.string().trim().min(1, "Poné el nombre de la clase").max(120),
  profesor_id: z.string().uuid().nullable().optional(),
  dias: z.array(z.number().int().min(1).max(7)).min(1, "Elegí al menos un día").max(7),
  hora: z.string().regex(/^\d{2}:\d{2}$/, "Hora inválida"),
  duracion_min: z.number().int().min(5).max(600),
  cupo: z.number().int().min(1).max(1000).nullable().optional(),
  precio_suelta: z.number().min(0).max(1e12).nullable().optional(),
  ubicacion: z.string().trim().max(120).nullable().optional(),
  desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  activa: z.boolean().optional(),
});

export const GET = withTenant(async (ctx) => {
  const { data, error } = await ctx.db.rpc("gim_clases_lista");
  if (error) return falloGim(error, "No se pudieron leer las clases");
  return ok(data);
}, { permiso: "gimnasio_recepcion" });

export const POST = withTenant(async (ctx, _req, b) => {
  const { data, error } = await ctx.db.rpc("gim_clase_guardar", { p: b });
  if (error) return falloGim(error, "No se pudo guardar la clase");
  return ok(data);
}, { permiso: "gimnasio_administrar", body: cuerpo });