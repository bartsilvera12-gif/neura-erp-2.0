/**
 * Registro de TODAS las tipificaciones (receta 81, tipificaciones_registro): una consulta con
 * el cliente, el ticket y la capacitación vinculados (estado en vivo), paginado.
 *
 *   GET /api/tipificaciones/registro?q&desde&hasta&familia&usuario&accion&pagina&por
 *     → { total, filas[] }       · ?id=<uuid> → esa sola (detalle desde un enlace)
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import { filtrosDesdeUrl, leerRegistro } from "@/modules/tipificacion/server";

export const dynamic = "force-dynamic";

export const GET = withTenant(async (ctx, req) => {
  const sp = new URL(req.url).searchParams;
  const id = sp.get("id");
  try {
    return ok(await leerRegistro(ctx.db, id ? { id, limite: 1 } : filtrosDesdeUrl(sp)));
  } catch (e) {
    console.error("[tipificaciones/registro]", e instanceof Error ? e.message : e);
    return ERR.server();
  }
});
