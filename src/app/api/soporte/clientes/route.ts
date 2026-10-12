/**
 * GET /api/soporte/clientes — Soporte visto por cliente: sólo los clientes con
 * tickets, con abiertos / cerrados / urgentes / SLA vencidos, último ticket y
 * última actividad. No hay otra tabla de clientes: se agrega desde los tickets.
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { calcularSla } from "@/modules/soporte/dominio";
import { accesoSoporte, clientesPorId, falla, leerCatalogos, leerConfig, sinAccesoSoporte, ticketsParaAgregar } from "@/modules/soporte/server";

type Fila = {
  cliente_id: string;
  abiertos: number;
  cerrados: number;
  urgentes: number;
  sla_vencidos: number;
  ultimo: { id: string; numero: number; asunto: string; created_at: string } | null;
  ultima_actividad: string | null;
};

export const GET = withTenant(async (ctx) => {
  if (!(await accesoSoporte(ctx))) return sinAccesoSoporte();
  try {
    const [cat, cfg, tickets] = await Promise.all([
      leerCatalogos(ctx),
      leerConfig(ctx),
      ticketsParaAgregar(ctx, (q) => q.not("cliente_id", "is", null)),
    ]);
    const ahora = new Date().toISOString();
    const cerrados = new Set(cat.estados.filter((e) => e.tipo === "cerrado").map((e) => e.codigo));
    const mapa = new Map<string, Fila>();
    for (const t of tickets) {
      const id = t.cliente_id as string;
      const f = mapa.get(id) ?? { cliente_id: id, abiertos: 0, cerrados: 0, urgentes: 0, sla_vencidos: 0, ultimo: null, ultima_actividad: null };
      if (cerrados.has(t.estado_codigo)) f.cerrados += 1;
      else {
        f.abiertos += 1;
        if (t.prioridad_codigo === "urgente") f.urgentes += 1;
        if (calcularSla(t, cfg, ahora).estado === "vencido") f.sla_vencidos += 1;
      }
      if (!f.ultimo || t.created_at > f.ultimo.created_at) f.ultimo = { id: t.id, numero: t.numero, asunto: t.asunto, created_at: t.created_at };
      if (!f.ultima_actividad || t.updated_at > f.ultima_actividad) f.ultima_actividad = t.updated_at;
      mapa.set(id, f);
    }
    const nombres = await clientesPorId(ctx, [...mapa.keys()]);
    return ok(
      [...mapa.values()]
        .map((f) => ({ ...f, cliente_nombre: nombres.get(f.cliente_id) ?? "Cliente" }))
        .sort((a, b) => b.abiertos - a.abiertos || (b.ultima_actividad ?? "").localeCompare(a.ultima_actividad ?? "")),
    );
  } catch (e) {
    console.error("[soporte/clientes]", (e as Error)?.message);
    return falla("No se pudieron cargar los clientes", 500);
  }
});
