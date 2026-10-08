/**
 * Rubros de proveedores (ej. "Bebidas", "Limpieza").
 *   GET /api/proveedores/categorias → { categorias }
 * Se crean solos al escribirlos en el formulario del proveedor.
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";

export const GET = withTenant(async (ctx) => {
  const { data, error } = await ctx.db.select("proveedor_categorias", "id, nombre, activo").order("nombre", { ascending: true });
  if (error) return ERR.server();
  return ok({ categorias: data ?? [] });
});
