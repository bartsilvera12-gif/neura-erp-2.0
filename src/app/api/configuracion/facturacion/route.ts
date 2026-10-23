/**
 * Configuración › Tickets y facturación (receta 61; 71: ticket_venta / ticket_comanda).
 *   GET /api/configuracion/facturacion → config_facturacion(): cualquier usuario activo (la caja
 *       la lee para el tipo de impresión, "pedir datos del comprador" y el plazo por defecto).
 *   PUT /api/configuracion/facturacion { modo?, impresion_tipo_default?, preguntar_datos_al_confirmar?,
 *       prefijo_factura?, numeracion_inicial?, dias_vencimiento_default?, interes_moratorio?,
 *       gestion_tributaria_clientes?, ocasional_nombre?, ocasional_ruc?, ocasional_tope?,
 *       ticket_venta?: {…parcial}, ticket_comanda?: {…parcial} } → config_facturacion(). Solo ADMIN con "Configuración del
 *       sistema". La única vía de escritura es guardar_config_facturacion (SECURITY DEFINER),
 *       que vuelve a validar todo.
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { falloRpc, soloAdmin } from "@/modules/usuarios/server";
import type { ConfigFacturacion } from "@/modules/facturacion/tipos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const textoTicket = z.string().trim().max(300, "Los textos del ticket pueden tener hasta 300 caracteres");
const copiasTicket = z.coerce.number().int().min(1, "Mínimo 1 copia").max(5, "Máximo 5 copias");

const esquema = z
  .object({
    modo: z.enum(["sin_factura_fiscal", "sifen", "autoimpresor"], { message: "Modo de facturación inválido" }),
    impresion_tipo_default: z.enum(["pdf_a4", "pdf_media_hoja", "ticket_80mm", "ticket_58mm"], { message: "Tipo de impresión inválido" }),
    preguntar_datos_al_confirmar: z.boolean(),
    gestion_tributaria_clientes: z.boolean(),
    prefijo_factura: z
      .string()
      .transform((v) => v.replace(/\s+/g, "").toUpperCase())
      .refine((v) => /^[A-Z0-9][A-Z0-9/_.-]{0,11}$/.test(v), "Prefijo inválido: hasta 12 letras o números y - / _ . (ej. FAC-, 001-001-)"),
    numeracion_inicial: z.coerce.number().int("La numeración inicial debe ser un número entero").min(1, "La numeración inicial debe ser desde 1").max(999999999),
    dias_vencimiento_default: z.coerce.number().int("Los días de vencimiento deben ser un número entero").min(0).max(365, "Máximo 365 días"),
    interes_moratorio: z.coerce.number().min(0, "El interés no puede ser negativo").max(100, "Máximo 100 % mensual"),
    // Receta 67: cliente ocasional (X). Vacío = "X"; tope null = sin tope.
    ocasional_nombre: z.string().trim().max(160, "El nombre del cliente ocasional no puede pasar de 160 caracteres"),
    ocasional_ruc: z.string().transform((v) => v.replace(/\s+/g, "").toUpperCase()).refine((v) => v.length <= 20, "El RUC del cliente ocasional no puede pasar de 20 caracteres"),
    ocasional_tope: z.coerce.number().int("El tope es un monto en guaraníes sin decimales").positive("El tope tiene que ser mayor a 0 (o vacío: sin tope)").max(999999999999).nullable(),
    // Receta 71: ticket de venta y comanda (solo lo que cambia; la base vuelve a validar).
    ticket_venta: z
      .object({
        ancho_mm: z.union([z.literal(58), z.literal(80)]),
        logo: z.boolean(),
        enc_nombre_fantasia: z.boolean(), enc_razon_social: z.boolean(), enc_ruc: z.boolean(),
        enc_direccion: z.boolean(), enc_telefono: z.boolean(), enc_sucursal: z.boolean(),
        encabezado_texto: textoTicket, pie_texto: textoTicket,
        mostrar_cajero: z.boolean(), mostrar_cliente: z.boolean(), mostrar_cliente_doc: z.boolean(),
        mostrar_iva: z.boolean(), mostrar_pago: z.boolean(),
        letra: z.enum(["chica", "normal", "grande"], { message: "Tamaño de letra inválido" }),
        copias: copiasTicket,
        imprimir_al_cobrar: z.boolean(),
      })
      .strict()
      .partial(),
    ticket_comanda: z
      .object({
        ancho_mm: z.union([z.literal(58), z.literal(80)]),
        letra: z.enum(["normal", "grande", "muy_grande"], { message: "Tamaño de letra inválido" }),
        mostrar_cliente: z.boolean(), mostrar_notas: z.boolean(), mostrar_precios: z.boolean(),
        copias: copiasTicket,
        pie_texto: textoTicket,
      })
      .strict()
      .partial(),
  })
  .partial()
  .refine((o) => Object.keys(o).length > 0, "No se envió ningún cambio");

export const GET = withTenant(async (ctx) => {
  const { data, error } = await ctx.db.rpc<ConfigFacturacion>("config_facturacion");
  if (error) return falloRpc(error);
  return ok(data);
});

export const PUT = withTenant(
  async (ctx, _req, input) => {
    const corte = soloAdmin(ctx);
    if (corte) return corte;
    const { data, error } = await ctx.db.rpc<ConfigFacturacion>("guardar_config_facturacion", { p: input });
    if (error) return falloRpc(error);
    return ok(data);
  },
  { permiso: "configuracion", body: esquema },
);
