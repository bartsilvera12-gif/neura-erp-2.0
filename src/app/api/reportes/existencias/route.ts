/**
 * Reporte "Existencias por depósito" (reporte_existencias, receta 80): foto de hoy del stock,
 * una fila por producto y una columna por depósito, con total y valor por capas PEPS.
 *   GET /api/reportes/existencias?sucursal&deposito&categoria&tipo&todos=1&bajo=1
 * La búsqueda (q) la hace la pantalla; el Excel y el PDF la aplican en el servidor.
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { falloRpc } from "@/modules/inventario/server/rpc";
import { filtrosExistencias, reporteExistencias } from "@/modules/reportes/server/existencias";

export const dynamic = "force-dynamic";

export const GET = withTenant(
  async (ctx, req) => {
    try {
      return ok(await reporteExistencias(ctx.db, filtrosExistencias(new URL(req.url).searchParams)));
    } catch (e) {
      console.error("[reportes/existencias]", e instanceof Error ? e.message : e);
      return falloRpc({ message: e instanceof Error ? e.message : "Error" });
    }
  },
  { permiso: "ver_reportes_financieros" },
);
