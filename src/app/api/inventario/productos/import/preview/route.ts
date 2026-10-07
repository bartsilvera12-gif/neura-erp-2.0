/** Importar Excel — vista previa (no escribe nada). POST form-data { file }. ADMIN. */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, fail } from "@/lib/api/responses";
import { MAX_BYTES_EXCEL } from "@/modules/inventario/server/excel-io";
import { previewExcel } from "@/modules/inventario/server/import-excel";

export const POST = withTenant(
  async (ctx, req) => {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return fail("Form-data inválido.", 400);
    }
    const f = form.get("file");
    if (!(f instanceof File) || f.size === 0) return fail("Falta el archivo.", 400);
    if (f.size > MAX_BYTES_EXCEL) return fail("Archivo demasiado grande (máx. 5 MB).", 400);
    try {
      const { _filas, ...preview } = await previewExcel(ctx.db, await f.arrayBuffer());
      void _filas; // lo que se mandaría a la base no viaja al navegador
      return ok(preview);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (/filas/i.test(msg)) return fail(msg, 400);
      console.error("[import preview]", msg);
      return fail("No se pudo generar la vista previa.", 500);
    }
  },
  { roles: ["ADMIN"] },
);
