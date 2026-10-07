/**
 * Importación inicial — confirmar. POST form-data con los mismos archivos +
 * actualizar_existentes ("1"|"0") y crear_categorias ("1"|"0"). ADMIN.
 * El servidor vuelve a consolidar (no recibe el JSON de la vista previa).
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, fail } from "@/lib/api/responses";
import { commitInicial, leerReportes } from "@/modules/inventario/server/import-inicial";

export const POST = withTenant(
  async (ctx, req) => {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return fail("Form-data inválido.", 400);
    }
    const archivos = await leerReportes(form);
    if (typeof archivos === "string") return fail(archivos, 400);
    try {
      return ok(
        await commitInicial(ctx.db, archivos, {
          actualizarExistentes: form.get("actualizar_existentes") === "1",
          crearCategorias: (form.get("crear_categorias") ?? "1") === "1",
        }),
      );
    } catch (e) {
      console.error("[import-inicial commit]", e instanceof Error ? e.message : e);
      return fail("No se pudo completar la importación.", 500);
    }
  },
  { roles: ["ADMIN"] },
);
