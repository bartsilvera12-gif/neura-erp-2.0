/** Importar proveedores — vista previa (no escribe nada). POST form-data { file }. ADMIN. */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, fail } from "@/lib/api/responses";
import { MAX_BYTES_EXCEL } from "@/modules/inventario/server/excel-io";
import { armarPlan, vistaPrevia } from "@/modules/proveedores/importar";

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
    try {
      // Lo que se mandaría a la base (_ops) no viaja al navegador.
      return ok(vistaPrevia(await armarPlan(ctx.db, await f.arrayBuffer())));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (/filas/i.test(msg)) return fail(msg, 400);
      console.error("[proveedores import preview]", msg);
      return fail(msg === "db" ? "No se pudo generar la vista previa." : "No se pudo leer el archivo. Revisá que sea un Excel (.xlsx) o CSV.", msg === "db" ? 500 : 400);
    }
  },
  { roles: ["ADMIN"] },
);
