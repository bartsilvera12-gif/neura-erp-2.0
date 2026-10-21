/**
 * Logo de los documentos (Configuración › Datos de la empresa). Solo ADMIN con
 * "Configuración del sistema" (la base lo vuelve a exigir en guardar_logo_empresa).
 *   POST   multipart `file` (PNG / JPG / WEBP ≤ 2 MB) → datos_empresa()
 *          El servidor lo normaliza (PNG o JPEG, lado mayor ≤ 600 px), lo sube al bucket
 *          público `empresas-logos` en la carpeta de la empresa y registra la versión.
 *   DELETE → vuelve al logo de la instalación → datos_empresa()
 * La versión anterior se borra del bucket después de registrar la nueva.
 */
import { withTenant } from "@/lib/api/with-tenant";
import { fail, ok } from "@/lib/api/responses";
import { falloRpc, soloAdmin } from "@/modules/usuarios/server";
import { borrarLogoEmpresa, normalizarLogo, subirLogoEmpresa } from "@/lib/empresa/logo";
import type { DatosEmpresa } from "@/modules/empresa/tipos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ConAnterior = DatosEmpresa & { logo_anterior?: string | null };
const sinAnterior = ({ logo_anterior: _x, ...d }: ConAnterior): DatosEmpresa => d;

export const POST = withTenant(
  async (ctx, req) => {
    const corte = soloAdmin(ctx);
    if (corte) return corte;
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File) || file.size < 1) return fail("Elegí la imagen del logo (PNG, JPG o WEBP).", 422, "invalid_input");
    if (file.size > 2 * 1024 * 1024) return fail("El logo no puede superar 2 MB.", 422, "invalid_input");

    const logo = await normalizarLogo(Buffer.from(await file.arrayBuffer()));
    if ("error" in logo) return fail(logo.error, 422, "invalid_input");
    const sub = await subirLogoEmpresa(ctx.empresaId, logo);
    if ("error" in sub) return fail(sub.error, 502, "storage_error");

    const { data, error } = await ctx.db.rpc<ConAnterior>("guardar_logo_empresa", {
      p: { path: sub.path, url: sub.url, mime: logo.mime, ancho: logo.ancho, alto: logo.alto },
    });
    if (error || !data) {
      await borrarLogoEmpresa(ctx.empresaId, sub.path);
      return error ? falloRpc(error) : fail("No se pudo guardar el logo.", 500, "internal");
    }
    await borrarLogoEmpresa(ctx.empresaId, data.logo_anterior);
    return ok(sinAnterior(data));
  },
  { permiso: "configuracion" },
);

export const DELETE = withTenant(
  async (ctx) => {
    const corte = soloAdmin(ctx);
    if (corte) return corte;
    const { data, error } = await ctx.db.rpc<ConAnterior>("guardar_logo_empresa", { p: null });
    if (error || !data) return error ? falloRpc(error) : fail("No se pudo quitar el logo.", 500, "internal");
    await borrarLogoEmpresa(ctx.empresaId, data.logo_anterior);
    return ok(sinAnterior(data));
  },
  { permiso: "configuracion" },
);
