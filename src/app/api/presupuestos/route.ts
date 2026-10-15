/**
 * Presupuestos.
 *   GET  /api/presupuestos?q&estado&cliente&vendedor&desde&hasta&pagina&por_pagina
 *        → { rows, total, conteos, kpis }  (una sola consulta: listar_presupuestos)
 *        estado: "" | abiertos | borrador | enviado | aceptado | rechazado | vencido | convertido
 *   POST /api/presupuestos → crea (guardar_presupuesto valida empresa y rol adentro)
 */
import { withTenant } from "@/lib/api/with-tenant";
import { created, fail, ok, ERR } from "@/lib/api/responses";
import { cuerpoPresupuesto, ROLES_PRESUPUESTOS, type ListaPresupuestos } from "@/modules/presupuestos/tipos";

const UUID = /^[0-9a-f-]{36}$/i;
const DIA = /^\d{4}-\d{2}-\d{2}$/;
const ESTADOS = ["abiertos", "borrador", "enviado", "aceptado", "rechazado", "vencido", "convertido"];
const limpio = (m: string) => m.replace(/^.*?ERROR:\s*/, "");

export const GET = withTenant(async (ctx, req) => {
  const sp = new URL(req.url).searchParams;
  const estado = sp.get("estado") ?? "";
  const cliente = sp.get("cliente") ?? "";
  const vendedor = sp.get("vendedor") ?? "";
  const desde = sp.get("desde") ?? "";
  const hasta = sp.get("hasta") ?? "";
  const { data, error } = await ctx.db.rpc<ListaPresupuestos>("listar_presupuestos", {
    p_q: (sp.get("q") ?? "").trim().slice(0, 120) || null,
    p_estado: ESTADOS.includes(estado) ? estado : null,
    p_cliente: UUID.test(cliente) ? cliente : null,
    p_vendedor: UUID.test(vendedor) ? vendedor : null,
    p_desde: DIA.test(desde) ? desde : null,
    p_hasta: DIA.test(hasta) ? hasta : null,
    p_pagina: Math.max(1, Number(sp.get("pagina")) || 1),
    p_por_pagina: Math.min(100, Math.max(5, Number(sp.get("por_pagina")) || 25)),
  });
  if (error) {
    console.error("[presupuestos GET]", error.message);
    return ERR.server();
  }
  return ok(data);
}, { roles: ROLES_PRESUPUESTOS });

export const POST = withTenant(
  async (ctx, _req, input) => {
    const { data, error } = await ctx.db.rpc<{ id: string; numero: string; revision: number; total: number }>("guardar_presupuesto", { p: input });
    if (error) return fail(limpio(error.message), 400);
    return created(data);
  },
  { roles: ROLES_PRESUPUESTOS, body: cuerpoPresupuesto },
);
