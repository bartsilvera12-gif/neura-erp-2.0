/**
 * POST /api/configuracion/sifen/certificado — sube / reemplaza el certificado .p12 (multipart:
 * `file`, y opcional `password`). Solo ADMIN con "Configuración del sistema".
 *   · Si viene la contraseña (o ya hay una guardada), el servidor abre el .p12 con ella: si no
 *     abre, no se guarda nada; si abre, se leen titular y vencimiento (sin cargarlos a mano).
 *   · El archivo va a `sifen_secretos.certificado_p12` (bytea sin ningún privilegio para la
 *     sesión del usuario) por sifen_guardar_certificado; la contraseña, cifrada acá.
 *   · La respuesta trae solo metadatos (titular, vencimiento, "cargado"), nunca el archivo.
 */
import { withTenant } from "@/lib/api/with-tenant";
import { fail, ok } from "@/lib/api/responses";
import { falloRpc, soloAdmin } from "@/modules/usuarios/server";
import { cifrar, descifrar, FaltaClaveSecretos, hayClaveSecretos, leerP12, leerSecretos, type DatosCertificado } from "@/lib/sifen/secretos";
import type { SifenLectura } from "@/modules/facturacion/tipos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 5 * 1024 * 1024;

export const POST = withTenant(
  async (ctx, req) => {
    const corte = soloAdmin(ctx);
    if (corte) return corte;

    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File) || file.size < 1) return fail("Elegí el archivo .p12 del certificado", 422, "invalid_input");
    if (file.size > MAX_BYTES) return fail("El certificado supera el tamaño máximo permitido (5 MB)", 422, "invalid_input");
    if (!/\.(p12|pfx)$/i.test(file.name)) return fail("El certificado tiene que ser un archivo .p12 o .pfx", 422, "invalid_input");
    const passwordNueva = String(form?.get("password") ?? "");
    const buf = Buffer.from(await file.arrayBuffer());
    if (buf[0] !== 0x30) return fail("El archivo no parece un certificado .p12 / .pfx", 422, "invalid_input");

    try {
      // Contraseña para abrirlo: la que viene, o la que ya está guardada (si el servidor puede descifrarla).
      let password = passwordNueva;
      if (!password && hayClaveSecretos()) {
        const sec = await leerSecretos(ctx.empresaId);
        if (sec.passwordCifrada) {
          try { password = descifrar(sec.passwordCifrada); } catch { password = ""; }
        }
      }
      let meta: DatosCertificado | null = null;
      if (password) {
        try {
          meta = leerP12(buf, password);
        } catch (e) {
          // Con la contraseña guardada que no abre el archivo nuevo: se guarda igual, pidiendo la nueva.
          if (passwordNueva) return fail((e as Error).message, 422, "invalid_input");
          meta = null;
        }
      }
      const { data, error } = await ctx.db.rpc<SifenLectura>("sifen_guardar_certificado", {
        p_p12_b64: buf.toString("base64"),
        p_nombre: file.name.slice(0, 160),
        p_titular: meta?.titular ?? null,
        p_vencimiento: meta?.vencimiento || null,
        p_password_cifrada: passwordNueva && meta ? cifrar(passwordNueva) : null,
      });
      if (error) return falloRpc(error);
      let lectura = data;
      if (!meta && password) {
        // La contraseña guardada era del certificado anterior: no sirve para este, se borra.
        const r = await ctx.db.rpc<SifenLectura>("sifen_guardar_secretos", { p: { limpiar_password: true } });
        if (r.error) return falloRpc(r.error);
        lectura = r.data;
      }
      const aviso = !meta
        ? password
          ? "Certificado cargado, pero la contraseña guardada no lo abre: cargá la contraseña de este .p12."
          : "Certificado cargado. Cargá su contraseña para validarlo y leer el vencimiento."
        : meta.ruc && lectura?.config?.ruc && meta.ruc.replace("-", "") !== lectura.config.ruc.replace("-", "")
          ? `Ojo: el certificado es del RUC ${meta.ruc} y el emisor configurado es ${lectura.config.ruc}.`
          : null;
      return ok({ ...lectura, clave_servidor: hayClaveSecretos(), certificado: meta, aviso });
    } catch (e) {
      if (e instanceof FaltaClaveSecretos) return fail(e.message, 500, "sin_clave");
      throw e;
    }
  },
  { permiso: "configuracion" },
);
