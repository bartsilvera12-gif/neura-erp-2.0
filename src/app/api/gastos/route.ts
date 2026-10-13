/**
 * Gastos y Servicios.
 *   GET  /api/gastos?q&estado=borrador|confirmado|anulado&desde&hasta&pagina&por_pagina
 *        → { rows, total, total_monto (confirmados de la vista), resumen: { total, borrador, confirmado, anulado } }
 *   POST /api/gastos { confirmar, id?, idempotency_key?, proveedor_id, tipo_comprobante, numero_comprobante,
 *        timbrado, fecha_comprobante, tipo_pago, plazo_dias?, fecha_vencimiento?, medio_pago?, referencia_pago?,
 *        descripcion?, observacion?, items: [{ categoria_id, descripcion, monto (IVA incluido), iva_tipo }] }
 *        confirmar=false → borrador ({ id, estado }); confirmar=true → confirma ({ id, numero, total, cxp_id, caja_id }).
 *        A crédito nace la cuenta a pagar; al contado en efectivo sale de la caja abierta.
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, created, fail } from "@/lib/api/responses";
import { cuerpoGasto } from "@/lib/gastos/esquema";

export const dynamic = "force-dynamic";

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export const GET = withTenant(
  async (ctx, req) => {
    const sp = new URL(req.url).searchParams;
    const porPagina = Math.min(200, Math.max(10, Number(sp.get("por_pagina")) || 50));
    const pagina = Math.max(1, Number(sp.get("pagina")) || 1);
    const estado = sp.get("estado");
    const fecha = (k: string) => {
      const v = sp.get(k);
      return v && FECHA.test(v) ? v : null;
    };
    const { data, error } = await ctx.db.rpc("listar_gastos", {
      p_q: sp.get("q")?.trim().slice(0, 200) || null,
      p_estado: estado === "borrador" || estado === "confirmado" || estado === "anulado" ? estado : null,
      p_desde: fecha("desde"),
      p_hasta: fecha("hasta"),
      p_limit: porPagina,
      p_offset: (pagina - 1) * porPagina,
    });
    if (error) return fail(error.message.replace(/^.*?ERROR:\s*/, ""), 422);
    return ok(data);
  },
  { roles: ["ADMIN"] },
);

export const POST = withTenant(
  async (ctx, _req, input) => {
    const { confirmar, ...p } = input;
    const { data, error } = await ctx.db.rpc(confirmar ? "confirmar_gasto" : "guardar_gasto", { p });
    if (error) return fail(error.message.replace(/^.*?ERROR:\s*/, ""), 422);
    return created(data);
  },
  { roles: ["ADMIN"], body: cuerpoGasto },
);
