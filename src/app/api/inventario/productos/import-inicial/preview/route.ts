/** Importación inicial — análisis y consolidación de los reportes (no escribe nada). ADMIN. */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, fail } from "@/lib/api/responses";
import { leerReportes, previewInicial } from "@/modules/inventario/server/import-inicial";

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
      return ok(await previewInicial(ctx.db, archivos));
    } catch (e) {
      console.error("[import-inicial preview]", e instanceof Error ? e.message : e);
      return fail("No se pudo generar la vista previa consolidada.", 500);
    }
  },
  { roles: ["ADMIN"] },
);
