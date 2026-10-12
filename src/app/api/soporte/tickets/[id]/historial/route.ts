/**
 * GET /api/soporte/tickets/[id]/historial — la auditoría del ticket, en orden cronológico.
 *
 * Los valores se guardan como códigos e ids y se traducen acá al nombre ACTUAL:
 * renombrar un estado en Configuración no deja el historial con nombres viejos.
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { EVENTOS_DE_ESTADO, fechaHora, nombreEstadoSubtarea } from "@/modules/soporte/dominio";
import { accesoSoporte, falla, idTras, leerCatalogos, personasPorId, sinAccesoSoporte, ticketDeEmpresa } from "@/modules/soporte/server";

type Fila = {
  id: string;
  tipo_evento: string;
  usuario_id: string | null;
  valor_anterior: string | null;
  valor_nuevo: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export const GET = withTenant(async (ctx, req) => {
  if (!(await accesoSoporte(ctx))) return sinAccesoSoporte();
  const id = idTras(req, "tickets");
  if (!id || !(await ticketDeEmpresa(ctx, id, "id"))) return falla("Ticket no encontrado", 404);

  const { data, error } = await ctx.db
    .select("soporte_ticket_historial", "id, tipo_evento, usuario_id, valor_anterior, valor_nuevo, metadata, created_at")
    .eq("ticket_id", id)
    .order("created_at", { ascending: true });
  if (error) return falla("No se pudo cargar el historial", 500);
  const lista = (data ?? []) as unknown as Fila[];
  const cat = await leerCatalogos(ctx);

  const ids = new Set<string>();
  for (const f of lista) {
    if (f.usuario_id) ids.add(f.usuario_id);
    if (f.tipo_evento === "cambio_responsable") {
      if (f.valor_anterior) ids.add(f.valor_anterior);
      if (f.valor_nuevo) ids.add(f.valor_nuevo);
    }
  }
  const personas = await personasPorId(ctx, [...ids]);

  const traducir = (evento: string, v: string | null): string | null => {
    if (v == null) return null;
    if (EVENTOS_DE_ESTADO.includes(evento)) return cat.estados.find((e) => e.codigo === v)?.nombre ?? v;
    if (evento === "cambio_prioridad") return cat.prioridades.find((p) => p.codigo === v)?.nombre ?? v;
    if (evento === "cambio_clasificacion") return cat.clasificaciones.find((c) => c.codigo === v)?.nombre ?? v;
    if (evento === "cambio_tipo") return cat.tipos.find((t) => t.codigo === v)?.nombre ?? v;
    if (evento === "cambio_responsable") return personas.get(v)?.nombre ?? "Usuario";
    if (evento === "cambio_sla") return `${v} h`;
    if (evento === "cambio_fecha_objetivo") return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v.split("-").reverse().join("/") : fechaHora(v);
    if (evento === "subtarea_estado") return nombreEstadoSubtarea(v);
    return v;
  };

  return ok(
    lista.map((f) => ({
      ...f,
      usuario: f.usuario_id ? (personas.get(f.usuario_id) ?? null) : null,
      anterior: traducir(f.tipo_evento, f.valor_anterior),
      nuevo: traducir(f.tipo_evento, f.valor_nuevo),
    })),
  );
});
