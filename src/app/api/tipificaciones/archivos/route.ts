/**
 * Evidencias de un ticket creado desde una tipificación (subida en dos pasos, como el actual):
 *
 *   POST /api/tipificaciones/archivos { accion: "firmar", ticket_id, nombre, mime_type, size }
 *        → { bucket, path, token }  (valida tipo y tamaño ANTES de firmar; el path lo decide el servidor)
 *   POST /api/tipificaciones/archivos { accion: "registrar", ticket_id, path, nombre, mime_type }
 *        → registra la fila en soporte_ticket_archivos (sólo si el objeto existe y es de ese ticket)
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { created, ok, fail, ERR } from "@/lib/api/responses";
import { ARCHIVO_MAX_BYTES, mimeAceptado } from "@/modules/tipificacion/dominio";
import { SOPORTE_BUCKET, firmarSubida, objetoSubido, pathArchivoTicket, prefijoArchivosTicket } from "@/modules/tipificacion/archivos-server";

const cuerpo = z.discriminatedUnion("accion", [
  z.object({
    accion: z.literal("firmar"),
    ticket_id: z.string().uuid(),
    nombre: z.string().trim().min(1, "Falta el nombre del archivo").max(255),
    mime_type: z.string().max(200).default(""),
    size: z.number(),
  }),
  z.object({
    accion: z.literal("registrar"),
    ticket_id: z.string().uuid(),
    path: z.string().min(1).max(500),
    nombre: z.string().trim().min(1).max(255),
    mime_type: z.string().max(200).default(""),
  }),
]);

export const POST = withTenant(
  async (ctx, _req, input) => {
    const { data: tk } = await ctx.db.select("soporte_tickets", "id").eq("id", input.ticket_id).limit(1);
    if (!tk?.length) return ERR.notFound("Ticket");

    if (input.accion === "firmar") {
      if (!mimeAceptado(input.mime_type ?? "", input.nombre)) return fail(`"${input.nombre}": tipo de archivo no permitido`);
      if (!Number.isFinite(input.size) || input.size <= 0) return fail(`"${input.nombre}" está vacío`);
      if (input.size > ARCHIVO_MAX_BYTES) return fail(`"${input.nombre}" supera los ${Math.round(ARCHIVO_MAX_BYTES / (1024 * 1024))} MB`);
      const path = pathArchivoTicket(ctx.empresaId, input.ticket_id, input.nombre);
      const r = await firmarSubida(ctx.empresaId, path);
      if ("error" in r) return fail(r.error);
      return ok({ bucket: SOPORTE_BUCKET, path, token: r.token });
    }

    // registrar
    if (!input.path.startsWith(prefijoArchivosTicket(ctx.empresaId, input.ticket_id)) || input.path.includes("..")) {
      return fail("Ruta de archivo inválida", 403);
    }
    if (!mimeAceptado(input.mime_type ?? "", input.nombre)) return fail(`"${input.nombre}": tipo de archivo no permitido`);
    const obj = await objetoSubido(ctx.empresaId, input.path);
    if (!obj) return fail(`"${input.nombre}" no llegó a subirse`);
    const { data, error } = await ctx.db.insert("soporte_ticket_archivos", {
      ticket_id: input.ticket_id,
      nombre: input.nombre,
      storage_bucket: SOPORTE_BUCKET,
      storage_path: input.path,
      mime: input.mime_type || null,
      size: obj.size,
      subido_por: ctx.usuarioId,
    });
    if (error) return fail(error.message);
    return created({ id: (data?.[0] as { id?: string } | undefined)?.id ?? null });
  },
  { body: cuerpo },
);
