/**
 * POST /api/soporte/tickets/[id]/archivos/firmar { nombre, mime_type, size }
 *   → { bucket, path, token }: URL firmada para subir UN archivo directo al Storage.
 *
 * Valida tipo (sin ejecutables, html ni svg) y tamaño (máx. 50 MB) ANTES de firmar,
 * y la ruta la decide el servidor dentro de la carpeta del ticket.
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { ARCHIVO_MAX_BYTES, mimeAceptado } from "@/modules/soporte/dominio";
import { SOPORTE_BUCKET, firmarSubida, pathArchivoTicket } from "@/lib/soporte/storage";
import { accesoSoporte, cuerpo, falla, idTras, sinAccesoSoporte, ticketDeEmpresa } from "@/modules/soporte/server";

export const POST = withTenant(async (ctx, req) => {
  if (!(await accesoSoporte(ctx))) return sinAccesoSoporte();
  const id = idTras(req, "tickets");
  if (!id || !(await ticketDeEmpresa(ctx, id, "id"))) return falla("Ticket no encontrado", 404);

  const body = await cuerpo(req);
  const nombre = typeof body?.nombre === "string" ? body.nombre.trim() : "";
  const mime = typeof body?.mime_type === "string" ? body.mime_type : "";
  const size = Number(body?.size ?? 0);
  if (!nombre) return falla("Falta el nombre del archivo");
  if (!mimeAceptado(mime, nombre)) return falla(`"${nombre}": tipo de archivo no permitido`);
  if (!Number.isFinite(size) || size <= 0) return falla(`"${nombre}" está vacío`);
  if (size > ARCHIVO_MAX_BYTES) return falla(`"${nombre}" supera los ${Math.round(ARCHIVO_MAX_BYTES / (1024 * 1024))} MB`);

  const firma = await firmarSubida(pathArchivoTicket(ctx.empresaId, id, nombre));
  if ("error" in firma) {
    console.error("[soporte/firmar]", firma.error);
    return falla("No se pudo preparar la subida", 500);
  }
  return ok({ bucket: SOPORTE_BUCKET, path: firma.path, token: firma.token });
});
