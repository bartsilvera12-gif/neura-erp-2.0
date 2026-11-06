/** Padrón de funcionarios — confirmar. POST form-data { file, empresa_id }. Re-arma el plan y lo aplica. */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, fail } from "@/lib/api/responses";
import { MAX_BYTES_EXCEL } from "@/modules/inventario/server/excel-io";
import { aplicarPlan, armarPlan, type Plan } from "@/modules/comedor/importar-funcionarios";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const POST = withTenant(
  async (ctx, req) => {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return fail("Form-data inválido.", 400);
    }
    const f = form.get("file");
    const empresaId = String(form.get("empresa_id") ?? "");
    if (!(f instanceof File) || f.size === 0) return fail("Falta el archivo.", 400);
    if (f.size > MAX_BYTES_EXCEL) return fail("Archivo demasiado grande (máx. 5 MB).", 400);
    if (!UUID_RE.test(empresaId)) return fail("Elegí la empresa contratante antes de importar.", 400);
    let plan: Plan;
    try {
      plan = await armarPlan(ctx.db, await f.arrayBuffer(), empresaId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (/filas/i.test(msg)) return fail(msg, 400);
      return fail("No se pudo leer el archivo. Revisá que sea un Excel (.xlsx) o CSV.", 400);
    }
    try {
      return ok(await aplicarPlan(ctx.db, plan, ctx.usuarioId));
    } catch (e) {
      console.error("[comedor padron commit]", e instanceof Error ? e.message : e);
      return fail("No se pudo importar el padrón.", 500);
    }
  },
  { permiso: "comedor_administrar" },
);
