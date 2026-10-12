/**
 * POST /api/proyectos/[id]/archivos/firmar { nombre, mime_type, size }
 *   → { bucket, path, token }: URL firmada para subir UN archivo directo al Storage.
 * Valida tipo (sin ejecutables, html ni svg) y tamaño (máx. 50 MB) ANTES de firmar; la
 * ruta la decide el servidor dentro de la carpeta del proyecto.
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, fail, ERR } from "@/lib/api/responses";
import { ARCHIVO_MAX_BYTES, mimeAceptado } from "@/modules/soporte/dominio";
import { PROYECTOS_BUCKET, firmarSubida, pathArchivoProyecto } from "@/lib/proyectos/storage";
import { idTras, proyectoBase } from "@/modules/proyectos/server";

export const dynamic = "force-dynamic";

export const POST = withTenant(async (ctx, req) => {
  const id = idTras(req, "proyectos");
  if (!id || !(await proyectoBase(ctx, id))) return ERR.notFound("Proyecto");
  const body = (await req.json().catch(() => null)) as { nombre?: unknown; mime_type?: unknown; size?: unknown } | null;
  const nombre = typeof body?.nombre === "string" ? body.nombre.trim() : "";
  const mime = typeof body?.mime_type === "string" ? body.mime_type : "";
  const size = Number(body?.size ?? 0);
  if (!nombre) return fail("Falta el nombre del archivo");
  if (!mimeAceptado(mime, nombre)) return fail(`"${nombre}": tipo de archivo no permitido`);
  if (!Number.isFinite(size) || size <= 0) return fail(`"${nombre}" está vacío`);
  if (size > ARCHIVO_MAX_BYTES) return fail(`"${nombre}" supera los ${Math.round(ARCHIVO_MAX_BYTES / (1024 * 1024))} MB`);

  const firma = await firmarSubida(pathArchivoProyecto(ctx.empresaId, id, nombre));
  if ("error" in firma) {
    console.error("[proyectos/firmar]", firma.error);
    return fail("No se pudo preparar la subida", 500);
  }
  return ok({ bucket: PROYECTOS_BUCKET, path: firma.path, token: firma.token });
});
