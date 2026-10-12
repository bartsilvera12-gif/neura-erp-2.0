/**
 * Un archivo del proyecto.
 *   GET    /api/proyectos/[id]/archivos/[archivoId] → { nombre, mime, url, url_descarga }
 *          (URL firmada corta, para abrir un adjunto de comentario sin listar todo)
 *   DELETE /api/proyectos/[id]/archivos/[archivoId] → borrado lógico + se quita del bucket
 *          (quien lo subió, quien puede editar el proyecto o ADMIN). Queda en la bitácora.
 */
import { withTenant, type TenantContext } from "@/lib/api/with-tenant";
import { ok, fail, ERR } from "@/lib/api/responses";
import { borrarObjeto, urlsFirmadasLote } from "@/lib/proyectos/storage";
import { idTras, permisosDe, proyectoBase, registrarEvento } from "@/modules/proyectos/server";

export const dynamic = "force-dynamic";

type Fila = { id: string; nombre: string; storage_path: string; mime: string | null; subido_por: string | null };

async function archivo(ctx: TenantContext, id: string, archivoId: string) {
  const { data } = await ctx.db
    .select("proyecto_archivos", "id, nombre, storage_path, mime, subido_por")
    .eq("proyecto_id", id)
    .eq("id", archivoId)
    .is("deleted_at", null)
    .maybeSingle();
  return (data as unknown as Fila | null) ?? null;
}

export const GET = withTenant(async (ctx, req) => {
  const id = idTras(req, "proyectos");
  const archivoId = idTras(req, "archivos");
  if (!id || !archivoId) return ERR.notFound("Archivo");
  const a = await archivo(ctx, id, archivoId);
  if (!a) return fail("El archivo ya no está disponible (lo eliminaron).", 404);
  const urls = await urlsFirmadasLote([{ path: a.storage_path, nombre: a.nombre }]);
  const u = urls.get(a.storage_path);
  return ok({ nombre: a.nombre, mime: a.mime, url: u?.url ?? null, url_descarga: u?.url_descarga ?? null });
});

export const DELETE = withTenant(async (ctx, req) => {
  const id = idTras(req, "proyectos");
  const archivoId = idTras(req, "archivos");
  if (!id || !archivoId) return ERR.notFound("Archivo");
  const [p, a] = await Promise.all([proyectoBase(ctx, id), archivo(ctx, id, archivoId)]);
  if (!p || !a) return ERR.notFound("Archivo");
  if (a.subido_por !== ctx.usuarioId && !permisosDe(ctx, p).editar) return fail("No tenés permiso para eliminar este archivo.", 403);

  const { error } = await ctx.db.update("proyecto_archivos", { deleted_at: new Date().toISOString() }).eq("id", a.id);
  if (error) return fail("No se pudo eliminar el archivo");
  await borrarObjeto(a.storage_path);
  await registrarEvento(ctx, id, "archivo_eliminado", { nombre: a.nombre });
  return ok({ eliminado: true });
});
