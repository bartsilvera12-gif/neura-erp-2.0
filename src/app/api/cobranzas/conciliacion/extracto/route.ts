/**
 * Cruce del extracto del banco contra las transferencias APROBADAS (solo lectura).
 *   POST /api/cobranzas/conciliacion/extracto  form-data { file (Excel .xlsx/.xls o CSV), mes? (YYYY-MM) }
 *   → { conciliados, montos_difieren, aprobados_sin_extracto, extracto_sin_registrar, resumen }
 *   Sin IA y sin PDF: se leen las columnas del Excel/CSV. No modifica nada.
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, fail, ERR } from "@/lib/api/responses";
import { conciliar, leerExtracto, type AprobadoLite } from "@/lib/cobranzas/extracto";
import type { ListaConciliacion } from "@/modules/cobranzas/tipos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 10 * 1024 * 1024;

/** Primer y último día del mes (YYYY-MM). */
function rangoMes(mes: string): { desde: string; hasta: string } {
  const [y, m] = mes.split("-").map(Number);
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { desde: `${mes}-01`, hasta: `${mes}-${String(ultimo).padStart(2, "0")}` };
}

export const POST = withTenant(
  async (ctx, req) => {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return fail("Form-data inválido (¿el archivo supera los 10 MB?).", 400);
    }
    const f = form.get("file");
    if (!(f instanceof File) || f.size === 0) return fail("Subí el extracto (Excel o CSV).", 400);
    const nombre = (f.name || "extracto").slice(0, 200);
    if (f.size > MAX_BYTES) return fail(`«${nombre}» supera los 10 MB.`, 400);
    if (!/\.(xlsx|xls|csv)$/i.test(nombre)) return fail("Subí el extracto en Excel (.xlsx, .xls) o CSV.", 400);
    const mesRaw = form.get("mes");
    const mes = typeof mesRaw === "string" && /^\d{4}-\d{2}$/.test(mesRaw) ? mesRaw : null;

    const lectura = leerExtracto(new Uint8Array(await f.arrayBuffer()));
    if ("error" in lectura) return fail(lectura.error, 400);

    const rango = mes ? rangoMes(mes) : null;
    const { data, error } = await ctx.db.rpc<ListaConciliacion>("listar_cobros_pendientes", {
      p_estado: "aprobado", p_desde: rango?.desde ?? null, p_hasta: rango?.hasta ?? null, p_q: null, p_limit: 2000,
    });
    if (error || !data) return ERR.server();
    const aprobados: AprobadoLite[] = data.cobros.map((c) => ({
      id: c.id, monto: Number(c.monto), fecha: c.fecha, numero_operacion: c.numero_operacion, banco_origen: c.banco_origen,
      titular: c.titular, cliente_nombre: c.cliente_nombre, numero_factura: c.numero_factura,
    }));
    return ok(conciliar(aprobados, lectura.transacciones, { archivo: nombre, mes }));
  },
  { roles: ["ADMIN", "SUPERVISOR"] },
);
