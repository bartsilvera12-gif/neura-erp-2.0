/**
 * Importar proveedores — confirmar. POST form-data { file }. ADMIN.
 * Vuelve a leer el archivo y a armar el plan (no confía en lo que mandó el navegador):
 * da de alta los nuevos, actualiza solo las columnas con valor de los existentes y crea
 * los rubros que falten.
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, fail } from "@/lib/api/responses";
import { MAX_BYTES_EXCEL } from "@/modules/inventario/server/excel-io";
import { aplicarPlan, armarPlan, type Plan } from "@/modules/proveedores/importar";

export const runtime = "nodejs";

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
    let plan: Plan;
    try {
      plan = await armarPlan(ctx.db, await f.arrayBuffer());
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (/filas/i.test(msg)) return fail(msg, 400);
      if (msg === "db") return fail("No se pudo importar.", 500);
      return fail("No se pudo leer el archivo. Revisá que sea un Excel (.xlsx) o CSV.", 400);
    }
    try {
      return ok(await aplicarPlan(ctx.db, plan));
    } catch (e) {
      console.error("[proveedores import commit]", e instanceof Error ? e.message : e);
      return fail("No se pudo importar.", 500);
    }
  },
  { roles: ["ADMIN"] },
);
