/**
 * Archivos del proyecto (bucket privado "proyectos"). Se piden recién al abrir la pestaña.
 *   GET  /api/proyectos/[id]/archivos → Archivo[] vigentes, con URL firmada para ver y bajar
 *        (todas en UNA llamada a Storage)
 *   POST /api/proyectos/[id]/archivos { path, nombre, mime_type, comentario_id? }
 *        → registra un archivo que el navegador YA subió con la URL de `archivos/firmar`.
 *          Verifica que el objeto exista dentro de la carpeta de ESTE proyecto. Con
 *          comentario_id queda además como adjunto de ese comentario (solo de su autor).
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, created, fail, ERR } from "@/lib/api/responses";
import { ARCHIVO_MAX_BYTES, mimeAceptado } from "@/modules/soporte/dominio";
import { borrarObjeto, objetoSubido, prefijoArchivosProyecto, urlsFirmadasLote } from "@/lib/proyectos/storage";
import { esUuid, idTras, nombresUsuarios, proyectoBase, registrarEvento, tocarProyecto } from "@/modules/proyectos/server";
import type { Adjunto, Archivo } from "@/modules/proyectos/tipos";

export const dynamic = "force-dynamic";

type Fila = { id: string; nombre: string; storage_path: string; mime: string | null; size: number | string | null; subido_por: string | null; created_at: string };

export const GET = withTenant(async (ctx, req) => {
  const id = idTras(req, "proyectos");
  if (!id) return ERR.notFound("Proyecto");
  const { data, error } = await ctx.db
    .select("proyecto_archivos", "id, nombre, storage_path, mime, size, subido_por, created_at")
    .eq("proyecto_id", id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) return ERR.server();
  const filas = (data ?? []) as unknown as Fila[];
  const [nombres, urls] = await Promise.all([
    nombresUsuarios(ctx, filas.map((a) => a.subido_por)),
    urlsFirmadasLote(filas.map((a) => ({ path: a.storage_path, nombre: a.nombre }))),
  ]);
  return ok(
    filas.map((a): Archivo => ({
      id: a.id,
      nombre: a.nombre,
      mime: a.mime,
      size: a.size == null ? null : Number(a.size),
      subido_por_nombre: a.subido_por ? (nombres.get(a.subido_por) ?? null) : null,
      created_at: a.created_at,
      url: urls.get(a.storage_path)?.url ?? null,
      url_descarga: urls.get(a.storage_path)?.url_descarga ?? null,
    })),
  );
});

export const POST = withTenant(async (ctx, req) => {
  const id = idTras(req, "proyectos");
  if (!id || !(await proyectoBase(ctx, id))) return ERR.notFound("Proyecto");
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const path = typeof body?.path === "string" ? body.path : "";
  const nombre = typeof body?.nombre === "string" ? body.nombre.trim().slice(0, 200) : "";
  const mime = typeof body?.mime_type === "string" ? body.mime_type : "";
  const comentarioId = esUuid(body?.comentario_id) ? body.comentario_id : null;

  // Sin esto, alguien podría registrar en su proyecto un archivo de otro.
  if (!path.startsWith(prefijoArchivosProyecto(ctx.empresaId, id)) || path.includes("..")) return fail("Ruta de archivo inválida");
  if (!nombre) return fail("Falta el nombre del archivo");
  if (!mimeAceptado(mime, nombre)) return fail("Tipo de archivo no permitido");

  let comentario: { id: string; adjuntos: Adjunto[] } | null = null;
  if (comentarioId) {
    const { data: com } = await ctx.db
      .select("proyecto_comentarios", "id, adjuntos, usuario_id")
      .eq("proyecto_id", id)
      .eq("id", comentarioId)
      .maybeSingle();
    const c = com as unknown as { id: string; adjuntos: Adjunto[] | null; usuario_id: string | null } | null;
    if (!c || c.usuario_id !== ctx.usuarioId) return fail("Comentario inválido");
    comentario = { id: c.id, adjuntos: Array.isArray(c.adjuntos) ? c.adjuntos : [] };
  }

  const objeto = await objetoSubido(path);
  if (!objeto) return fail("El archivo no terminó de subirse");
  if (objeto.size && objeto.size > ARCHIVO_MAX_BYTES) {
    await borrarObjeto(path);
    return fail("El archivo supera el máximo permitido");
  }

  const { data, error } = await ctx.db.insert("proyecto_archivos", {
    proyecto_id: id,
    nombre,
    storage_path: path,
    mime: mime || null,
    size: objeto.size,
    subido_por: ctx.usuarioId,
  });
  const fila = data?.[0] as { id: string } | undefined;
  if (error || !fila) {
    await borrarObjeto(path);
    return fail("No se pudo registrar el archivo");
  }
  if (comentario) {
    const adj: Adjunto = { id: fila.id, nombre, mime: mime || null, size: objeto.size };
    await ctx.db.update("proyecto_comentarios", { adjuntos: [...comentario.adjuntos, adj] }).eq("id", comentario.id);
  }
  await Promise.all([
    registrarEvento(ctx, id, "archivo_subido", { nombre, ...(comentario ? { en_comentario: true } : {}) }),
    tocarProyecto(ctx, id),
  ]);
  return created({ id: fila.id });
});
