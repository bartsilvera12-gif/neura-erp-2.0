/**
 * Usuarios activos de la empresa, en versión mínima (para elegir vendedor, responsable…).
 *   GET /api/usuarios?min=1 → [{ id, nombre, rol }] por nombre
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";

export const GET = withTenant(async (ctx) => {
  const { data, error } = await ctx.db.select("usuarios", "id, nombre, rol").eq("activo", true).order("nombre", { ascending: true });
  if (error) return ERR.server();
  return ok(data ?? []);
});
