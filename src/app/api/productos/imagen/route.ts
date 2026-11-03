/**
 * Imagen de un producto (Inventario y alta rápida desde Caja).
 *   POST multipart `file` (imagen ≤ 5 MB) → { url }
 * Sube el SERVIDOR con el cliente de sistema al bucket público `erp-productos` (receta 122), bajo
 * {schema}/{empresa}/{uuid}.{ext}. El bucket no tiene políticas de escritura: en un Supabase
 * compartido ningún usuario de otro sistema puede subir ahí.
 */
import { randomUUID } from "node:crypto";
import { withTenant } from "@/lib/api/with-tenant";
import { fail, ok } from "@/lib/api/responses";
import { systemClient } from "@/lib/supabase/clients";
import { tenantSchema } from "@/lib/tenant/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRODUCTOS_BUCKET = "erp-productos";
const TIPOS: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

export const POST = withTenant(
  async (ctx, req) => {
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File) || file.size < 1) return fail("Elegí una imagen.", 422, "invalid_input");
    const ext = TIPOS[file.type];
    if (!ext) return fail("La imagen tiene que ser JPG, PNG, WEBP o GIF.", 422, "invalid_input");
    if (file.size > 5 * 1024 * 1024) return fail("La imagen no puede superar 5 MB.", 422, "invalid_input");

    const bucket = systemClient().storage.from(PRODUCTOS_BUCKET);
    const path = `${tenantSchema()}/${ctx.empresaId}/${randomUUID()}.${ext}`;
    const { error } = await bucket.upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false, cacheControl: "31536000" });
    if (error) return fail(`No se pudo guardar la imagen: ${error.message}`, 502, "storage_error");
    return ok({ url: bucket.getPublicUrl(path).data.publicUrl });
  },
  { permiso: "editar_productos" },
);
