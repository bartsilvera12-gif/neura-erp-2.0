/**
 * DELETE /api/soporte/tickets/[id]/archivos/[archivoId] — quita un archivo del ticket.
 *
 * Borrado lógico (deleted_at) y se quita el objeto del bucket; el historial
 * conserva que existió, quién lo subió y quién lo quitó.
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { borrarObjeto } from "@/lib/soporte/storage";
import { accesoSoporte, falla, idTras, registrarHistorial, sinAccesoSoporte, tocarTicket } from "@/modules/soporte/server";

export const DELETE = withTenant(async (ctx, req) => {
  if (!(await accesoSoporte(ctx))) return sinAccesoSoporte();
  const id = idTras(req, "tickets");
  const archivoId = idTras(req, "archivos");
  if (!id || !archivoId) return falla("Archivo no encontrado", 404);

  const { data } = await ctx.db
    .select("soporte_ticket_archivos", "id, nombre, storage_path, subido_por, size")
    .eq("ticket_id", id)
    .eq("id", archivoId)
    .is("deleted_at", null)
    .maybeSingle();
  const archivo = data as unknown as { id: string; nombre: string; storage_path: string; subido_por: string | null; size: number | null } | null;
  if (!archivo) return falla("Archivo no encontrado", 404);

  const { error } = await ctx.db.update("soporte_ticket_archivos", { deleted_at: new Date().toISOString() }).eq("id", archivo.id);
  if (error) return falla("No se pudo eliminar el archivo");
  await borrarObjeto(archivo.storage_path);

  await registrarHistorial(ctx, id, [
    { tipo_evento: "archivo_eliminado", valor_anterior: archivo.nombre, metadata: { archivo_id: archivo.id, subido_por: archivo.subido_por, size: archivo.size } },
  ]);
  await tocarTicket(ctx, id);
  return ok({ eliminado: true });
});
