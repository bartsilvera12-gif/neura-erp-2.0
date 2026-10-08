/**
 * Cuentas a cobrar de todos los clientes (pantalla "Cuentas a cobrar").
 *   GET /api/cuentas-cobrar?q&filtro=vencidas|por_vencer|semana&pagina&por_pagina
 *   → { rows, total, total_saldo, antiguedad: { por_vencer, d1_30, d31_60, d61_90, d90,
 *        clientes, total, cobrado_mes } }
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";

export const GET = withTenant(async (ctx, req) => {
  const sp = new URL(req.url).searchParams;
  const porPagina = Math.min(200, Math.max(10, Number(sp.get("por_pagina")) || 50));
  const pagina = Math.max(1, Number(sp.get("pagina")) || 1);
  const filtro = sp.get("filtro");
  const { data, error } = await ctx.db.rpc("listar_cuentas_cobrar", {
    p_q: sp.get("q")?.trim().slice(0, 200) || null,
    p_filtro: filtro === "vencidas" || filtro === "por_vencer" || filtro === "semana" ? filtro : null,
    p_limit: porPagina,
    p_offset: (pagina - 1) * porPagina,
  });
  if (error) return ERR.server();
  return ok(data);
});
