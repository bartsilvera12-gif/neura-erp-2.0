/**
 * Ficha de un proveedor (reporte_proveedor, receta 54): productos asociados (principal + los
 * que se le compraron), historial de compras, productos que más se le compran, evolución
 * mensual, cuentas por pagar y pagos. Todo con el rango de fechas.
 *   GET /api/reportes/proveedores/<id>?desde&hasta&sucursal   · ADMIN
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { idDeRuta, idInvalido, UUID_RE } from "@/modules/inventario/server/ids";
import { argsRango, filtrosRango, leerReporte } from "@/modules/reportes/server/rpc";
import type { ProveedorDetalle } from "@/modules/reportes/tipos";

export const dynamic = "force-dynamic";

export const GET = withTenant(
  async (ctx, req) => {
    const id = idDeRuta(req.url, "proveedores");
    if (!UUID_RE.test(id ?? "")) return idInvalido("proveedor");
    const r = await leerReporte<ProveedorDetalle>(ctx.db, "reporte_proveedor", { p_proveedor: id, ...argsRango(filtrosRango(new URL(req.url).searchParams)) });
    return r.ok ? ok(r.data) : r.res;
  },
  { roles: ["ADMIN"] },
);
