/**
 * Proveedores (reporte_proveedores, receta 54): total comprado en el rango, cantidad de
 * compras, última compra, gastos operativos, deuda y productos asociados de cada proveedor.
 *   GET /api/reportes/proveedores?desde&hasta&sucursal   · ADMIN
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { argsRango, filtrosRango, leerReporte } from "@/modules/reportes/server/rpc";
import type { Proveedores } from "@/modules/reportes/tipos";

export const dynamic = "force-dynamic";

export const GET = withTenant(
  async (ctx, req) => {
    const r = await leerReporte<Proveedores>(ctx.db, "reporte_proveedores", argsRango(filtrosRango(new URL(req.url).searchParams)));
    return r.ok ? ok(r.data) : r.res;
  },
  { roles: ["ADMIN"] },
);
