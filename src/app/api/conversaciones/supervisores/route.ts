/**
 * Equipo de cada supervisor (solo ADMIN; se edita en Colas y enrutamiento).
 *   PUT /api/conversaciones/supervisores { supervisor_id, asesores: uuid[] } → { supervisor_id, asesores }
 * Con asesores cargados, el supervisor ve en Monitoreo y Finalizadas solo a ellos (y a sí
 * mismo); con la lista vacía vuelve a ver a todos. La lectura va con GET /colas.
 */
import { withTenant } from "@/lib/api/with-tenant";
import { fail, ok } from "@/lib/api/responses";
import { esquemaSupervisor, guardarSupervisor } from "@/modules/conversaciones/colas-server";

export const dynamic = "force-dynamic";

export const PUT = withTenant(
  async (ctx, _req, input) => {
    const r = await guardarSupervisor(ctx, input);
    if (!r.ok) return fail(r.mensaje, r.status);
    return ok({ supervisor_id: input.supervisor_id, asesores: r.asesores });
  },
  { permiso: "configuracion", body: esquemaSupervisor },
);
