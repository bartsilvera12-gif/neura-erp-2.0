/**
 * Logo del KuDE (representación gráfica de la factura electrónica). Solo afecta el PDF: no
 * cambia XML, firma ni envío a la SET. Solo ADMIN con "Configuración del sistema".
 *   GET    → el PNG guardado (para la vista previa de la pantalla) o 404.
 *   POST   multipart `file` (PNG ≤ 1 MB) → sifen_config_leer()
 *   DELETE → vuelve al logo por defecto → sifen_config_leer()
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ERR, fail, ok } from "@/lib/api/responses";
import { falloRpc, soloAdmin } from "@/modules/usuarios/server";
import { leerSecretos } from "@/lib/sifen/secretos";
import type { SifenLectura } from "@/modules/facturacion/tipos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 1024 * 1024;
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export const GET = withTenant(
  async (ctx) => {
    const sec = await leerSecretos(ctx.empresaId);
    if (!sec.kudeLogo) return ERR.notFound("logo");
    return new Response(new Uint8Array(sec.kudeLogo), { headers: { "content-type": "image/png", "cache-control": "private, no-store" } });
  },
  { permiso: "configuracion" },
);

export const POST = withTenant(
  async (ctx, req) => {
    const corte = soloAdmin(ctx);
    if (corte) return corte;
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File) || file.size < 1) return fail("Elegí el logo en PNG", 422, "invalid_input");
    if (file.size > MAX_BYTES) return fail("El logo supera el máximo permitido (1 MB).", 422, "invalid_input");
    const buf = Buffer.from(await file.arrayBuffer());
    if (!PNG.every((b, i) => buf[i] === b)) return fail("Solo se acepta logo en formato PNG.", 422, "invalid_input");
    const { data, error } = await ctx.db.rpc<SifenLectura>("sifen_guardar_kude_logo", { p_png_b64: buf.toString("base64") });
    if (error) return falloRpc(error);
    return ok(data);
  },
  { permiso: "configuracion" },
);

export const DELETE = withTenant(
  async (ctx) => {
    const corte = soloAdmin(ctx);
    if (corte) return corte;
    const { data, error } = await ctx.db.rpc<SifenLectura>("sifen_guardar_kude_logo", { p_png_b64: null });
    if (error) return falloRpc(error);
    return ok(data);
  },
  { permiso: "configuracion" },
);
