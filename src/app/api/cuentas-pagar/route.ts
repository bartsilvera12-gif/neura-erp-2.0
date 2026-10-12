/**
 * Cuentas a pagar a proveedores (pantalla "Pagos a proveedores").
 *   GET /api/cuentas-pagar?q&filtro=vencidas|por_vencer|semana&moneda=GS|USD&proveedor&pagina&por_pagina
 *   → { rows, total, total_saldo, antiguedad: { por_vencer, vence_semana, d1_30, d31_60, d61_90, d90,
 *        proveedores, total, pagado_mes } }
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, fail } from "@/lib/api/responses";

const UUID = /^[0-9a-f-]{36}$/i;

export const GET = withTenant(
  async (ctx, req) => {
    const sp = new URL(req.url).searchParams;
    const porPagina = Math.min(200, Math.max(10, Number(sp.get("por_pagina")) || 50));
    const pagina = Math.max(1, Number(sp.get("pagina")) || 1);
    const filtro = sp.get("filtro");
    const proveedor = sp.get("proveedor");
    const { data, error } = await ctx.db.rpc("listar_cuentas_pagar", {
      p_q: sp.get("q")?.trim().slice(0, 200) || null,
      p_filtro: filtro === "vencidas" || filtro === "por_vencer" || filtro === "semana" ? filtro : null,
      p_moneda: sp.get("moneda") === "USD" ? "USD" : "GS",
      p_proveedor: proveedor && UUID.test(proveedor) ? proveedor : null,
      p_limit: porPagina,
      p_offset: (pagina - 1) * porPagina,
    });
    if (error) return fail(error.message.replace(/^.*?ERROR:\s*/, ""), 422);
    return ok(data);
  },
  { roles: ["ADMIN"] },
);
