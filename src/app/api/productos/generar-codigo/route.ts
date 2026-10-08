/**
 * Autogenerar SKU o código de barras (botón "Generar" del panel de producto). ADMIN.
 *   POST /api/productos/generar-codigo  { tipo: "sku" | "barras" } → { codigo }
 * La lógica vive en la base (generar_sku / generar_codigo_barras, receta
 * 18_codigos_producto.sql): contador reservado por empresa, sin duplicados.
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, fail } from "@/lib/api/responses";

const cuerpo = z.object({ tipo: z.enum(["sku", "barras"]) });

export const POST = withTenant(
  async (ctx, _req, input) => {
    const { data, error } = await ctx.db.rpc<string>(input.tipo === "sku" ? "generar_sku" : "generar_codigo_barras");
    if (error || !data) return fail("No se pudo generar el código. Intentá de nuevo.", 500);
    return ok({ codigo: data });
  },
  { roles: ["ADMIN"], body: cuerpo },
);
