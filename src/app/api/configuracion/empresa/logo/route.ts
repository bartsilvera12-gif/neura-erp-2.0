/**
 * Logo de los documentos (Configuración › Datos de la empresa). Solo ADMIN con
 * "Configuración del sistema" (la base lo vuelve a exigir en guardar_logo_empresa).
 *   POST   multipart `file` (PNG / JPG / WEBP ≤ 2 MB) → datos_empresa()
 *          El servidor guarda el ORIGINAL normalizado (≤ 1200 px) y, a partir de él, el logo de
 *          los PDF (≤ 600 px) con el fondo liso quitado automáticamente (si no hay fondo liso, tal
 *          cual). `logo_fondo` dice qué pasó: quitado / no_detectado / transparente.
 *   PATCH  { sin_fondo: boolean } → datos_empresa()
 *          Alterna entre la imagen original (con fondo) y la versión sin fondo, rehaciéndola
 *          desde el original guardado.
 *   DELETE → vuelve al logo de la instalación → datos_empresa()
 * Las versiones anteriores (logo y original) se borran del bucket después de registrar la nueva.
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { fail, ok } from "@/lib/api/responses";
import { falloRpc, soloAdmin } from "@/modules/usuarios/server";
import {
  bajarOriginalEmpresa, borrarLogoEmpresa, logoDesdeOriginalGuardado, procesarLogoSubido, subirLogoEmpresa, subirOriginalEmpresa,
} from "@/lib/empresa/logo";
import type { DatosEmpresa } from "@/modules/empresa/tipos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ConAnterior = DatosEmpresa & { logo_anterior?: string | null; original_anterior?: string | null };
const sinAnterior = ({ logo_anterior: _x, original_anterior: _y, ...d }: ConAnterior): DatosEmpresa => d;

export const POST = withTenant(
  async (ctx, req) => {
    const corte = soloAdmin(ctx);
    if (corte) return corte;
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File) || file.size < 1) return fail("Elegí la imagen del logo (PNG, JPG o WEBP).", 422, "invalid_input");
    if (file.size > 2 * 1024 * 1024) return fail("El logo no puede superar 2 MB.", 422, "invalid_input");

    const r = await procesarLogoSubido(Buffer.from(await file.arrayBuffer()));
    if ("error" in r) return fail(r.error, 422, "invalid_input");
    const orig = await subirOriginalEmpresa(ctx.empresaId, r.original);
    if ("error" in orig) return fail(orig.error, 502, "storage_error");
    const sub = await subirLogoEmpresa(ctx.empresaId, r.logo);
    if ("error" in sub) {
      await borrarLogoEmpresa(ctx.empresaId, orig.path);
      return fail(sub.error, 502, "storage_error");
    }

    const { data, error } = await ctx.db.rpc<ConAnterior>("guardar_logo_empresa", {
      p: {
        path: sub.path, url: sub.url, mime: r.logo.mime, ancho: r.logo.ancho, alto: r.logo.alto,
        original_path: orig.path, sin_fondo: r.sinFondo, fondo: r.fondo,
      },
    });
    if (error || !data) {
      await borrarLogoEmpresa(ctx.empresaId, sub.path, orig.path);
      return error ? falloRpc(error) : fail("No se pudo guardar el logo.", 500, "internal");
    }
    await borrarLogoEmpresa(ctx.empresaId, data.logo_anterior, data.original_anterior);
    return ok(sinAnterior(data));
  },
  { permiso: "configuracion" },
);

export const PATCH = withTenant(
  async (ctx, _req, input) => {
    const corte = soloAdmin(ctx);
    if (corte) return corte;
    const { data: actual, error: errLeer } = await ctx.db.rpc<DatosEmpresa>("datos_empresa");
    if (errLeer) return falloRpc(errLeer);
    if (!actual?.logo_url || !actual.logo_original_path) return fail("Este logo no tiene la imagen original guardada: volvé a subirlo.", 409, "conflict");
    if (input.sin_fondo && actual.logo_fondo !== "quitado") return fail("No detectamos un fondo liso para quitar en este logo.", 422, "invalid_input");
    if (!!actual.logo_sin_fondo === input.sin_fondo) return ok(actual);

    const original = await bajarOriginalEmpresa(ctx.empresaId, actual.logo_original_path);
    if (!original) return fail("No se pudo leer la imagen original: volvé a subir el logo.", 502, "storage_error");
    const r = await logoDesdeOriginalGuardado(original, input.sin_fondo);
    if ("error" in r) return fail(r.error, 422, "invalid_input");
    const sub = await subirLogoEmpresa(ctx.empresaId, r.logo);
    if ("error" in sub) return fail(sub.error, 502, "storage_error");

    const { data, error } = await ctx.db.rpc<ConAnterior>("guardar_logo_empresa", {
      p: {
        path: sub.path, url: sub.url, mime: r.logo.mime, ancho: r.logo.ancho, alto: r.logo.alto,
        original_path: actual.logo_original_path, sin_fondo: r.sinFondo, fondo: r.fondo,
      },
    });
    if (error || !data) {
      await borrarLogoEmpresa(ctx.empresaId, sub.path);
      return error ? falloRpc(error) : fail("No se pudo guardar el logo.", 500, "internal");
    }
    await borrarLogoEmpresa(ctx.empresaId, data.logo_anterior, data.original_anterior);
    return ok(sinAnterior(data));
  },
  { permiso: "configuracion", body: z.object({ sin_fondo: z.boolean() }) },
);

export const DELETE = withTenant(
  async (ctx) => {
    const corte = soloAdmin(ctx);
    if (corte) return corte;
    const { data, error } = await ctx.db.rpc<ConAnterior>("guardar_logo_empresa", { p: null });
    if (error || !data) return error ? falloRpc(error) : fail("No se pudo quitar el logo.", 500, "internal");
    await borrarLogoEmpresa(ctx.empresaId, data.logo_anterior, data.original_anterior);
    return ok(sinAnterior(data));
  },
  { permiso: "configuracion" },
);
