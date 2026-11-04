/**
 * POST /api/sorteos/imagen  multipart `file` → { url } — imagen del sorteo o de un premio (receta 123).
 * La sube el servidor al bucket público `erp-sorteos-publico`, en {schema}/{empresa}/{uuid}.{ext}.
 */
import { randomUUID } from "node:crypto";
import { withTenant } from "@/lib/api/with-tenant";
import { fail, ok } from "@/lib/api/responses";
import { systemClient } from "@/lib/supabase/clients";
import { tenantSchema } from "@/lib/tenant/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TIPOS: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export const POST = withTenant(async (ctx, req) => {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || file.size < 1) return fail("Elegí una imagen.", 422, "invalid_input");
  const ext = TIPOS[file.type];
  if (!ext) return fail("La imagen tiene que ser JPG, PNG o WEBP.", 422, "invalid_input");
  if (file.size > 5 * 1024 * 1024) return fail("La imagen no puede superar 5 MB.", 422, "invalid_input");
  const bucket = systemClient().storage.from("erp-sorteos-publico");
  const path = `${tenantSchema()}/${ctx.empresaId}/${randomUUID()}.${ext}`;
  const { error } = await bucket.upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false, cacheControl: "31536000" });
  if (error) return fail(`No se pudo guardar la imagen: ${error.message}`, 502, "storage_error");
  return ok({ url: bucket.getPublicUrl(path).data.publicUrl });
}, { permiso: "sorteos_administrar" });
