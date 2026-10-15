/**
 * Gastos operativos (Gastos empresariales).
 *   GET  /api/gastos?q&estado&desde&hasta&sucursal&categoria&proveedor&tipo_costo=fijo|variable
 *        &deducible=1|0&origen=recurrente|personal|sin_comprobante&pagina&por_pagina
 *        → { rows, total, total_monto (confirmados, Gs.), total_iva, total_borradores, resumen }
 *   POST /api/gastos { confirmar, id?, idempotency_key?, proveedor_id?, sucursal_id?, con_comprobante,
 *        tipo_comprobante?, numero_comprobante?, timbrado?, fecha_comprobante, tipo_pago, plazo_dias?,
 *        fecha_vencimiento?, medio_pago?, referencia_pago?, cuenta_bancaria_id?, moneda, tipo_cambio?,
 *        descripcion?, observacion?, items: [{ categoria_id, descripcion, monto, iva_tipo, sucursal_id?, empleado_id? }] }
 *        confirmar=false → borrador ({ id, estado }); confirmar=true → confirma ({ id, numero, total, cxp_id, caja_id }).
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, created, fail } from "@/lib/api/responses";
import { cuerpoGasto, mensajeDb } from "@/lib/gastos/esquema";

export const dynamic = "force-dynamic";

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    const id = (k: string) => {
      const v = sp.get(k);
      return v && UUID.test(v) ? v : null;
    };
    const tipo = sp.get("tipo_costo");
    const ded = sp.get("deducible");
    const origen = sp.get("origen");
    const { data, error } = await ctx.db.rpc("listar_gastos", {
      p_q: sp.get("q")?.trim().slice(0, 200) || null,
      p_estado: estado === "borrador" || estado === "confirmado" || estado === "anulado" ? estado : null,
      p_desde: fecha("desde"),
      p_hasta: fecha("hasta"),
      p_sucursal: id("sucursal"),
      p_categoria: id("categoria"),
      p_proveedor: id("proveedor"),
      p_tipo_costo: tipo === "fijo" || tipo === "variable" ? tipo : null,
      p_deducible: ded === "1" ? true : ded === "0" ? false : null,
      p_origen: origen === "recurrente" || origen === "personal" || origen === "sin_comprobante" ? origen : null,
      p_limit: porPagina,
      p_offset: (pagina - 1) * porPagina,
    });
    if (error) return fail(mensajeDb(error.message), 422);
    return ok(data);
  },
  { roles: ["ADMIN"] },
);

export const POST = withTenant(
  async (ctx, _req, input) => {
    const { confirmar, ...p } = input;
    const { data, error } = await ctx.db.rpc(confirmar ? "confirmar_gasto" : "guardar_gasto", { p });
    if (error) return fail(mensajeDb(error.message), 422);
    return created(data);
  },
  { roles: ["ADMIN"], body: cuerpoGasto },
);
