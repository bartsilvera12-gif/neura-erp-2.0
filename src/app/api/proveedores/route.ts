/**
 * Proveedores (Fase 1 de Compras, portado de Ferretería República).
 *   GET  /api/proveedores → { proveedores } con rubros y cantidad de compras
 *   POST /api/proveedores → alta (ADMIN). Rubros por id o por nombre nuevo (se crean solos).
 * El RUC es único por empresa (se compara sin puntos ni guion). Los nombres se guardan
 * tal cual se escriben.
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, created, fail, ERR } from "@/lib/api/responses";
import { errorProveedor, guardarRubros, listarProveedores } from "@/modules/proveedores/server";
import { cuerpoProveedor } from "@/modules/proveedores/esquema";

export const GET = withTenant(async (ctx) => {
  try {
    return ok({ proveedores: await listarProveedores(ctx.db) });
  } catch {
    return ERR.server();
  }
});

export const POST = withTenant(
  async (ctx, _req, input) => {
    const { categoria_ids, categorias_nuevas, ...datos } = input;
    const { data, error } = await ctx.db.insert("proveedores", {
      ...datos,
      plazo_pago_dias: datos.condicion_pago === "credito" ? datos.plazo_pago_dias ?? null : null,
      activo: datos.activo ?? true,
    });
    if (error) return fail(errorProveedor(error.message), 409);
    const id = (data?.[0] as { id: string }).id;
    try {
      await guardarRubros(ctx.db, id, categoria_ids ?? [], categorias_nuevas ?? []);
    } catch (e) {
      return fail((e as Error).message === "db" ? "Se creó el proveedor, pero no se pudieron guardar sus rubros." : (e as Error).message, 500);
    }
    return created({ id });
  },
  { roles: ["ADMIN"], body: cuerpoProveedor },
);
