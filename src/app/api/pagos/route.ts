/**
 * Pagos (cobro de facturas pendientes, igual que el sistema actual).
 *   GET /api/pagos?tab=pendientes|cobrados&q&desde&hasta&categoria&plan&pagina&por_pagina&opciones=1
 *   → { pendientes: { rows, total, total_monto, total_saldo, total_general },
 *       cobrados:   { rows, total, total_monto, total_general },
 *       opciones?:  { categorias: [{ id, nombre }], planes: [{ id, nombre }] } }
 * Siempre vuelven los totales de las dos pestañas (las tarjetas de arriba); las filas solo
 * de la pestaña activa. Desde/Hasta: vencimiento en Pendientes y fecha del pago en Cobrados.
 * categoria / plan: uuid o "__sin__" (sin categoría / sin plan).
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, fail } from "@/lib/api/responses";

export const dynamic = "force-dynamic";

const FILTRO_ID = /^([0-9a-f-]{36}|__sin__)$/i;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export const GET = withTenant(async (ctx, req) => {
  const sp = new URL(req.url).searchParams;
  const tab = sp.get("tab") === "cobrados" ? "cobrados" : "pendientes";
  const porPagina = Math.min(200, Math.max(10, Number(sp.get("por_pagina")) || 50));
  const pagina = Math.max(1, Number(sp.get("pagina")) || 1);
  const fecha = (k: string) => {
    const v = sp.get(k);
    return v && FECHA.test(v) ? v : null;
  };
  const id = (k: string) => {
    const v = sp.get(k);
    return v && FILTRO_ID.test(v) ? v : null;
  };
  const args = {
    p_q: sp.get("q")?.trim().slice(0, 200) || null,
    p_desde: fecha("desde"),
    p_hasta: fecha("hasta"),
    p_categoria: id("categoria"),
    p_plan: id("plan"),
  };
  const pag = (activa: boolean) => ({ p_limit: activa ? porPagina : 0, p_offset: activa ? (pagina - 1) * porPagina : 0 });

  const [pend, cob, cats, planes] = await Promise.all([
    ctx.db.rpc("pagos_facturas_pendientes", { ...args, ...pag(tab === "pendientes") }),
    ctx.db.rpc("pagos_cobrados", { ...args, ...pag(tab === "cobrados") }),
    sp.get("opciones") === "1" ? ctx.db.select("cliente_categorias", "id, nombre").eq("activo", true).order("orden").order("nombre") : null,
    sp.get("opciones") === "1" ? ctx.db.select("planes", "id, nombre").order("nombre") : null,
  ]);
  const err = pend.error ?? cob.error ?? cats?.error ?? planes?.error;
  if (err) return fail(err.message.replace(/^.*?ERROR:\s*/, ""), 422);
  return ok({
    pendientes: pend.data,
    cobrados: cob.data,
    ...(cats && planes ? { opciones: { categorias: cats.data ?? [], planes: planes.data ?? [] } } : {}),
  });
});
