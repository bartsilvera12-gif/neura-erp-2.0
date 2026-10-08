/**
 * Corregir costos desde el reporte de ventas (ADMIN).
 *   POST /api/reportes/ventas/costos
 *   { costos: [{ producto_id, costo }], completar_ventas: boolean }
 * Carga el costo promedio de cada producto (si viene > 0) y, si se pide, completa con
 * ese costo las líneas de ventas pasadas que habían quedado en 0. No toca precios,
 * totales, stock ni caja.
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";

const cuerpo = z.object({
  costos: z.array(z.object({ producto_id: z.string().uuid(), costo: z.coerce.number().min(0) })).min(1).max(500),
  completar_ventas: z.boolean().default(true),
});

// Tope de ids por UPDATE (la URL hacia la base no puede crecer sin límite) y cuántos
// UPDATE van a la vez.
const IDS_POR_UPDATE = 200;
const EN_PARALELO = 6;

export const POST = withTenant(
  async (ctx, _req, input) => {
    const conCosto = input.costos.filter((c) => c.costo > 0);
    const actualizados = conCosto.length;
    // Un UPDATE por cada costo distinto (con todos los productos que llevan ese costo), en
    // vez de uno por producto y de a uno. Si un producto viene repetido, gana el último
    // (igual que antes, cuando se aplicaban en orden).
    const ultimo = new Map<string, number>();
    for (const c of conCosto) ultimo.set(c.producto_id, c.costo);
    const porCosto = new Map<number, string[]>();
    for (const [id, costo] of ultimo) porCosto.set(costo, [...(porCosto.get(costo) ?? []), id]);
    const updates: { costo: number; ids: string[] }[] = [];
    for (const [costo, ids] of porCosto) {
      for (let i = 0; i < ids.length; i += IDS_POR_UPDATE) updates.push({ costo, ids: ids.slice(i, i + IDS_POR_UPDATE) });
    }
    const ahora = new Date().toISOString();
    for (let i = 0; i < updates.length; i += EN_PARALELO) {
      const res = await Promise.all(
        updates.slice(i, i + EN_PARALELO).map((u) =>
          ctx.db.update("productos", { costo_promedio: u.costo, updated_at: ahora }).in("id", u.ids),
        ),
      );
      if (res.some((r) => r.error)) return ERR.server();
    }
    let lineas = 0;
    if (input.completar_ventas) {
      const { data, error } = await ctx.db.rpc<number>("completar_costo_ventas", {
        p_producto_ids: input.costos.map((c) => c.producto_id),
      });
      if (error) return ERR.server();
      lineas = Number(data) || 0;
    }
    return ok({ productos_actualizados: actualizados, lineas_completadas: lineas });
  },
  { roles: ["ADMIN"], body: cuerpo },
);
