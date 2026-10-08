/**
 * Autogenerar SKU o código de barras (botón "Generar" del panel de producto). ADMIN.
 *   POST /api/productos/generar-codigo  { tipo: "sku" | "barras", nombre? } → { codigo }
 *   SKU: legible, armado desde el nombre (COC-COL-2L). Barras: EAN-13 interno (prefijo 20).
 * La lógica vive en la base (generar_sku / generar_codigo_barras, receta
 * 18_codigos_producto.sql): contador reservado por empresa, sin duplicados.
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, fail } from "@/lib/api/responses";

const cuerpo = z.object({ tipo: z.enum(["sku", "barras"]), nombre: z.string().trim().max(200).optional() });

export const POST = withTenant(
  async (ctx, _req, input) => {
    if (input.tipo === "sku" && !input.nombre) return fail("Escribí primero el nombre del producto.", 400);
    const { data, error } = input.tipo === "sku"
      ? await ctx.db.rpc<string>("generar_sku", { p_nombre: input.nombre })
      : await ctx.db.rpc<string>("generar_codigo_barras");
    if (error || !data) return fail("No se pudo generar el código. Intentá de nuevo.", 500);
    return ok({ codigo: data });
  },
  { roles: ["ADMIN"], body: cuerpo },
);
