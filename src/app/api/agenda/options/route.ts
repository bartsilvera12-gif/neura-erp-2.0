/**
 * Datos para el formulario y los filtros de Agenda (portado del actual):
 *   GET /api/agenda/options → { responsables: [{ id, nombre, rol }], tipos, horario }
 * Los clientes no van acá: el formulario los BUSCA (/api/clientes?q=).
 * `horario` (soporte_config) es para advertir citas fuera del horario laboral.
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import { TIPOS_CITA } from "@/modules/agenda/dominio";
import { leerHorario } from "@/modules/agenda/server";

export const GET = withTenant(async (ctx) => {
  const [usuarios, horario] = await Promise.all([
    ctx.db.select("usuarios", "id, nombre, rol, activo").order("nombre", { ascending: true }),
    leerHorario(ctx.db),
  ]);
  if (usuarios.error) return ERR.server();
  const responsables = ((usuarios.data ?? []) as unknown as { id: string; nombre: string | null; rol: string | null; activo: boolean | null }[])
    .filter((u) => u.activo !== false)
    .map((u) => ({ id: u.id, nombre: u.nombre ?? null, rol: u.rol ?? null }));
  return ok({ responsables, tipos: TIPOS_CITA, horario });
});
