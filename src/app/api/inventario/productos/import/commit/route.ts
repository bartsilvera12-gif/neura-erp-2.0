/**
 * Importar Excel — confirmar. POST form-data { file, crear_faltantes: "1"|"0" }. ADMIN.
 * Vuelve a leer el archivo y a armar la vista previa (no confía en lo que mandó el
 * navegador) y lo aplica en la base por RPC, en tandas transaccionales. deposito_id: dónde
 * está el stock de la columna STOCK_ACTUAL (las diferencias van a un ajuste AJ-).
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, fail } from "@/lib/api/responses";
import { aplicarEnTandas, MAX_BYTES_EXCEL } from "@/modules/inventario/server/excel-io";
import { previewExcel } from "@/modules/inventario/server/import-excel";
import { uuidONull } from "@/modules/inventario/server/rpc";

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
      const deposito = uuidONull(String(form.get("deposito_id") ?? ""));
      const preview = await previewExcel(ctx.db, await f.arrayBuffer(), deposito);
      const r = await aplicarEnTandas(ctx.db, preview._filas, {
        modo: "excel",
        crearCategorias: form.get("crear_faltantes") === "1",
        origen: "ajuste",
        referencia: `Importación Excel: ${f.name.slice(0, 80)}`,
        deposito,
      });
      const erroresPreview = preview.rows
        .filter((x) => x.action === "ERROR")
        .map((x) => `Fila ${x.row_number}: ${x.errors.join("; ")}`);
      return ok({
        summary: {
          total: preview.summary.total,
          inserted: r.creados,
          updated: r.actualizados,
          skipped: 0,
          errors: preview.summary.errores + r.errores,
          warnings: preview.summary.warnings,
          movimientos_generados: r.movimientos_generados,
          unidades_entrada: r.unidades_entrada,
          unidades_salida: r.unidades_salida,
          categorias_creadas: r.categorias_creadas,
          ajuste_numero: r.ajuste_numero ?? null,
          deposito: r.deposito ?? null,
        },
        errors: [...erroresPreview, ...r.mensajes_error].slice(0, 100),
      });
    } catch (e) {
      console.error("[import commit]", e instanceof Error ? e.message : e);
      return fail("No se pudo importar.", 500);
    }
  },
  { roles: ["ADMIN"] },
);
