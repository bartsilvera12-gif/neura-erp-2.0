/**
 * Ventas a crédito (reportería de Caja, reporte_ventas_credito — receta 51).
 *   GET /api/caja/credito?desde=&hasta=&sucursal=&punto=&turno=&cliente=&estado=&q=&pagina=&por_pagina=
 *   → { rows[], total, totales{ cantidad, total, cobrado, saldo, vencido, vencidas } }
 * estado: pendiente | parcial | pagada | anulada | vencida | abiertas. Cajero y vendedor
 * ven su sucursal; ADMIN y SUPERVISOR, todas.
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { falloRpc, fechaONull, uuidONull } from "@/modules/inventario/server/rpc";
import { ROLES_CAJA } from "@/modules/caja/lib";

const ESTADOS = ["pendiente", "parcial", "pagada", "anulada", "vencida", "abiertas"];

export const GET = withTenant(
  async (ctx, req) => {
    const sp = new URL(req.url).searchParams;
    const estado = sp.get("estado") ?? "";
    const { data, error } = await ctx.db.rpc("reporte_ventas_credito", {
      p: {
        desde: fechaONull(sp.get("desde")),
        hasta: fechaONull(sp.get("hasta")),
        sucursal_id: uuidONull(sp.get("sucursal")),
        punto_venta_id: uuidONull(sp.get("punto")),
        caja_id: uuidONull(sp.get("turno")),
        cliente_id: uuidONull(sp.get("cliente")),
        estado: ESTADOS.includes(estado) ? estado : null,
        q: (sp.get("q") ?? "").trim().slice(0, 80) || null,
        pagina: Math.max(1, Number(sp.get("pagina")) || 1),
        por_pagina: Math.min(500, Math.max(10, Number(sp.get("por_pagina")) || 50)),
      },
    });
    if (error) return falloRpc(error);
    return ok(data);
  },
  { roles: ROLES_CAJA },
);
