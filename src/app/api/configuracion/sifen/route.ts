/**
 * Configuración › Facturación electrónica (SIFEN) — receta 61.
 *   GET /api/configuracion/sifen → sifen_config_leer() (+ si el servidor tiene la clave de cifrado).
 *       Nunca trae secretos: del .p12, su contraseña y el CSC solo dice si están cargados.
 *   PUT /api/configuracion/sifen { ambiente?, activo?, ruc?, razon_social?, direccion_fiscal?,
 *       timbrado_numero?, timbrado_fecha_inicio_vigencia?, actividad_economica_codigo?,
 *       actividad_economica_descripcion?, establecimiento?, punto_expedicion?, csc_id?,
 *       plazo_cancelacion_horas?, certificado_vencimiento?, kude_color_primario?,
 *       kude_color_primario_fill?, certificado_password?, limpiar_password?, csc?, limpiar_csc? }
 *       Sin configuración previa crea (exige los obligatorios); si no, actualiza lo que venga.
 *       Contraseña y CSC: se cifran ACÁ (AES-256-GCM, SIFEN_SECRETS_KEY) antes de llegar a la
 *       base; la contraseña se prueba contra el .p12 cargado (si no abre, no se guarda) y de
 *       paso se leen titular y vencimiento del certificado.
 * Solo ADMIN con "Configuración del sistema" (la base lo vuelve a exigir).
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { fail, ok } from "@/lib/api/responses";
import { falloRpc, soloAdmin } from "@/modules/usuarios/server";
import { cifrar, FaltaClaveSecretos, hayClaveSecretos, leerP12, leerSecretos } from "@/lib/sifen/secretos";
import type { SifenLectura } from "@/modules/facturacion/tipos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const txt = (max: number, nombre: string) => z.string().trim().max(max, `${nombre}: máximo ${max} caracteres`);
const fecha = (nombre: string) => z.string().trim().refine((v) => v === "" || /^\d{4}-\d{2}-\d{2}/.test(v), `${nombre}: fecha inválida`);

const esquema = z.object({
  ambiente: z.enum(["test", "produccion"], { message: "El ambiente debe ser Test o Producción" }),
  activo: z.boolean(),
  ruc: txt(20, "RUC"),
  razon_social: txt(160, "Razón social"),
  direccion_fiscal: txt(255, "Dirección fiscal").nullable(),
  timbrado_numero: txt(15, "Timbrado"),
  timbrado_fecha_inicio_vigencia: fecha("Inicio de vigencia del timbrado"),
  actividad_economica_codigo: txt(8, "Código de actividad"),
  actividad_economica_descripcion: txt(600, "Descripción de actividad"),
  establecimiento: txt(3, "Establecimiento"),
  punto_expedicion: txt(3, "Punto de expedición"),
  csc_id: txt(4, "ID del CSC").nullable(),
  plazo_cancelacion_horas: z.coerce.number().int().min(1).max(8760),
  certificado_vencimiento: fecha("Vencimiento del certificado").nullable(),
  kude_color_primario: z.string().trim().max(7).nullable(),
  kude_color_primario_fill: z.string().trim().max(7).nullable(),
  // Secretos (no se guardan tal cual: se cifran acá).
  certificado_password: z.string().min(1, "La contraseña no puede quedar vacía").max(200),
  limpiar_password: z.boolean(),
  csc: z.string().trim().min(1, "El CSC no puede quedar vacío").max(200),
  limpiar_csc: z.boolean(),
}).partial();

const SECRETOS = ["certificado_password", "limpiar_password", "csc", "limpiar_csc"] as const;

export const GET = withTenant(
  async (ctx) => {
    const { data, error } = await ctx.db.rpc<SifenLectura>("sifen_config_leer");
    if (error) return falloRpc(error);
    return ok({ ...data, clave_servidor: hayClaveSecretos() });
  },
  { permiso: "configuracion" },
);

export const PUT = withTenant(
  async (ctx, _req, input) => {
    const corte = soloAdmin(ctx);
    if (corte) return corte;

    const datos: Record<string, unknown> = { ...input };
    for (const k of SECRETOS) delete datos[k];
    const quiereSecretos = !!(input.certificado_password || input.limpiar_password || input.csc || input.limpiar_csc);

    try {
      // Contraseña nueva: tiene que abrir el .p12 cargado (si hay uno).
      let reCert: { b64: string; nombre: string | null; titular: string; vencimiento: string; pwCifrada: string } | null = null;
      let pwCifrada: string | null = null;
      let cscCifrado: string | null = null;
      if (input.certificado_password && !input.limpiar_password) {
        pwCifrada = cifrar(input.certificado_password);
        const sec = await leerSecretos(ctx.empresaId);
        if (sec.p12) {
          let meta;
          try { meta = leerP12(sec.p12, input.certificado_password); } catch (e) { return fail((e as Error).message, 422, "invalid_input"); }
          reCert = { b64: sec.p12.toString("base64"), nombre: null, titular: meta.titular, vencimiento: meta.vencimiento, pwCifrada };
          if (meta.vencimiento && !("certificado_vencimiento" in input)) datos.certificado_vencimiento = meta.vencimiento;
        }
      }
      if (input.csc && !input.limpiar_csc) cscCifrado = cifrar(input.csc);

      let lectura: SifenLectura | null = null;
      if (Object.keys(datos).length > 0) {
        const r = await ctx.db.rpc<SifenLectura>("sifen_config_guardar", { p: datos });
        if (r.error) return falloRpc(r.error);
        lectura = r.data;
      }
      if (reCert) {
        if (!lectura) {
          const actual = await ctx.db.rpc<SifenLectura>("sifen_config_leer");
          if (actual.error) return falloRpc(actual.error);
          lectura = actual.data;
        }
        const r = await ctx.db.rpc<SifenLectura>("sifen_guardar_certificado", {
          p_p12_b64: reCert.b64,
          p_nombre: lectura?.config?.certificado_nombre ?? "certificado.p12",
          p_titular: reCert.titular,
          p_vencimiento: reCert.vencimiento || null,
          p_password_cifrada: reCert.pwCifrada,
        });
        if (r.error) return falloRpc(r.error);
        lectura = r.data;
      }
      if (quiereSecretos && (input.limpiar_password || input.limpiar_csc || (pwCifrada && !reCert) || cscCifrado)) {
        const r = await ctx.db.rpc<SifenLectura>("sifen_guardar_secretos", {
          p: {
            password_cifrada: reCert ? null : pwCifrada,
            limpiar_password: !!input.limpiar_password,
            csc_cifrado: cscCifrado,
            limpiar_csc: !!input.limpiar_csc,
          },
        });
        if (r.error) return falloRpc(r.error);
        lectura = r.data;
      }
      if (!lectura) {
        const r = await ctx.db.rpc<SifenLectura>("sifen_config_leer");
        if (r.error) return falloRpc(r.error);
        lectura = r.data;
      }
      return ok({ ...lectura, clave_servidor: hayClaveSecretos() });
    } catch (e) {
      if (e instanceof FaltaClaveSecretos) return fail(e.message, 500, "sin_clave");
      throw e;
    }
  },
  { permiso: "configuracion", body: esquema },
);
