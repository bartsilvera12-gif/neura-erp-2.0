/**
 * Configuración › Facturación › Datos del autoimpresor / timbrado (modo "autoimpresor").
 *   PUT /api/configuracion/facturacion/autoimpresor { activo, ruc_emisor?, razon_social_emisor?, … }
 *       → config_facturacion(). Solo ADMIN con "Configuración del sistema"; la base
 *       (guardar_autoimpresor) valida los mínimos para emitir cuando queda activo.
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { falloRpc, soloAdmin } from "@/modules/usuarios/server";
import type { ConfigFacturacion } from "@/modules/facturacion/tipos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const txt = (max: number) => z.string().trim().max(max).nullish().transform((v) => (v ? v : null));
const fecha = z.string().trim().nullish().transform((v) => (v ? v.slice(0, 10) : null))
  .refine((v) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v), "Fecha inválida");
const num = z.union([z.number(), z.string()]).nullish()
  .transform((v) => (v === null || v === undefined || v === "" ? null : Number(v)))
  .refine((v) => v === null || (Number.isInteger(v) && v >= 1 && v <= 9999999999), "Los números del rango deben ser enteros desde 1");

const esquema = z.object({
  activo: z.boolean(),
  ruc_emisor: txt(20),
  razon_social_emisor: txt(160),
  nombre_fantasia: txt(120),
  direccion_matriz: txt(200),
  telefono: txt(40),
  timbrado_numero: txt(20),
  timbrado_inicio_vigencia: fecha,
  timbrado_fin_vigencia: fecha,
  establecimiento_codigo: txt(3),
  punto_expedicion_codigo: txt(3),
  numero_actual: num,
  numero_inicial: num,
  numero_final: num,
  tipo_documento_default: z.enum(["factura", "ticket", "nota_venta", "otro"]).optional(),
  formato_impresion_default: z.enum(["pdf_a4", "pdf_media_hoja", "ticket_80mm", "ticket_58mm"]).optional(),
  leyenda_papel_termico: txt(120),
  observaciones: txt(500),
});

export const PUT = withTenant(
  async (ctx, _req, input) => {
    const corte = soloAdmin(ctx);
    if (corte) return corte;
    const { data, error } = await ctx.db.rpc<ConfigFacturacion>("guardar_autoimpresor", { p: input });
    if (error) return falloRpc(error);
    return ok(data);
  },
  { permiso: "configuracion", body: esquema },
);
