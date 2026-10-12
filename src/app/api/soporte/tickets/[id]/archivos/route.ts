/**
 * Archivos / evidencias del ticket (bucket privado "soporte").
 *   GET  /api/soporte/tickets/[id]/archivos → los vigentes, con URL firmada para ver y bajar
 *   POST /api/soporte/tickets/[id]/archivos { path, nombre, mime_type, comentario_id? }
 *        → registra un archivo que el navegador YA subió con la URL de `archivos/firmar`.
 *          Verifica que el objeto exista dentro de la carpeta de ESTE ticket.
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, created } from "@/lib/api/responses";
import { ARCHIVO_MAX_BYTES, mimeAceptado } from "@/modules/soporte/dominio";
import { SOPORTE_BUCKET, borrarObjeto, objetoSubido, prefijoArchivosTicket, urlsFirmadas } from "@/lib/soporte/storage";
import {
  accesoSoporte,
  cuerpo,
  esUuid,
  falla,
  idTras,
  personasPorId,
  registrarHistorial,
  sinAccesoSoporte,
  ticketDeEmpresa,
  tocarTicket,
} from "@/modules/soporte/server";

type Arch = {
  id: string;
  nombre: string;
  storage_path: string;
  mime: string | null;
  size: number | null;
  subido_por: string | null;
  comentario_id: string | null;
  created_at: string;
};

export const GET = withTenant(async (ctx, req) => {
  if (!(await accesoSoporte(ctx))) return sinAccesoSoporte();
  const id = idTras(req, "tickets");
  if (!id || !(await ticketDeEmpresa(ctx, id, "id"))) return falla("Ticket no encontrado", 404);

  const { data, error } = await ctx.db
    .select("soporte_ticket_archivos", "id, nombre, storage_path, mime, size, subido_por, comentario_id, created_at")
    .eq("ticket_id", id)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  if (error) return falla("No se pudieron cargar los archivos", 500);
  const lista = (data ?? []) as unknown as Arch[];
  const personas = await personasPorId(ctx, lista.map((a) => a.subido_por));
  const archivos = await Promise.all(
    lista.map(async (a) => ({
      id: a.id,
      nombre: a.nombre,
      mime_type: a.mime,
      size_bytes: a.size == null ? null : Number(a.size),
      comentario_id: a.comentario_id,
      created_at: a.created_at,
      subido_por: a.subido_por ? (personas.get(a.subido_por) ?? null) : null,
      ...(await urlsFirmadas(a.storage_path, a.nombre)),
    })),
  );
  return ok(archivos);
});

export const POST = withTenant(async (ctx, req) => {
  if (!(await accesoSoporte(ctx))) return sinAccesoSoporte();
  const id = idTras(req, "tickets");
  if (!id || !(await ticketDeEmpresa(ctx, id, "id"))) return falla("Ticket no encontrado", 404);

  const body = await cuerpo(req);
  const path = typeof body?.path === "string" ? body.path : "";
  const nombre = typeof body?.nombre === "string" ? body.nombre.trim().slice(0, 200) : "";
  const mime = typeof body?.mime_type === "string" ? body.mime_type : "";
  const comentarioId = esUuid(body?.comentario_id) ? body.comentario_id : null;

  // Sin esto, alguien podría registrar en su ticket un archivo de otro.
  if (!path.startsWith(prefijoArchivosTicket(ctx.empresaId, id)) || path.includes("..")) return falla("Ruta de archivo inválida");
  if (!nombre) return falla("Falta el nombre del archivo");
  if (!mimeAceptado(mime, nombre)) return falla("Tipo de archivo no permitido");

  const objeto = await objetoSubido(path);
  if (!objeto) return falla("El archivo no terminó de subirse");
  if (objeto.size && objeto.size > ARCHIVO_MAX_BYTES) {
    await borrarObjeto(path);
    return falla("El archivo supera el máximo permitido");
  }
  if (comentarioId) {
    const { data: com } = await ctx.db.select("soporte_ticket_comentarios", "id").eq("ticket_id", id).eq("id", comentarioId).maybeSingle();
    if (!com) return falla("Comentario inválido");
  }

  const { data, error } = await ctx.db.insert("soporte_ticket_archivos", {
    ticket_id: id,
    comentario_id: comentarioId,
    nombre,
    storage_bucket: SOPORTE_BUCKET,
    storage_path: path,
    mime: mime || null,
    size: objeto.size,
    subido_por: ctx.usuarioId,
  });
  const fila = data?.[0] as { id: string } | undefined;
  if (error || !fila) {
    await borrarObjeto(path);
    return falla("No se pudo registrar el archivo");
  }
  await registrarHistorial(ctx, id, [{ tipo_evento: "archivo_agregado", valor_nuevo: nombre, metadata: { archivo_id: fila.id, size: objeto.size } }]);
  await tocarTicket(ctx, id);
  return created({ id: fila.id });
});
