/**
 * GET /api/soporte/tickets
 *
 * Filtros: pestana, estados (lista separada por comas; manda sobre pestana),
 * cargados=1 (los que cargó quien consulta), q (texto o #número), cliente_id,
 * estado, tipo, responsable_id, prioridad, mios=1 (asignados a quien consulta),
 * revision=1 (con una revisión de QA sin terminar asignada a quien consulta),
 * pagina, por_pagina.
 *
 * Devuelve además el conteo por estado con el resto de los filtros aplicados:
 * cada pantalla arma sus pestañas con eso ("Tickets" y "Mis tickets" no agrupan igual).
 *
 * POST: cerrado. Los tickets nacen de la tipificación del cliente.
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { condicionGrupo, variantesBusqueda } from "@/lib/api/busqueda-servidor";
import { PESTANAS_TICKETS, TICKET_CAMPOS, type TicketFila } from "@/modules/soporte/dominio";
import { accesoSoporte, enriquecerTickets, esUuid, falla, leerCatalogos, leerConfig, sinAccesoSoporte } from "@/modules/soporte/server";

const POR_PAGINA_MAX = 100;
const NINGUNO = "00000000-0000-0000-0000-000000000000";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Q = any;

export const GET = withTenant(async (ctx, req) => {
  if (!(await accesoSoporte(ctx))) return sinAccesoSoporte();
  try {
    const p = new URL(req.url).searchParams;
    const pestana = PESTANAS_TICKETS.find((x) => x.id === p.get("pestana")) ?? PESTANAS_TICKETS[0];
    const pagina = Math.max(1, Number(p.get("pagina") ?? "1") || 1);
    const porPagina = Math.min(POR_PAGINA_MAX, Math.max(5, Number(p.get("por_pagina") ?? "20") || 20));

    // Búsqueda precisa: "#12", "12", "ticket 12" → ese ticket (si existe); si no, cada
    // palabra (o su variante por error de tipeo) en asunto, descripción, próxima acción o
    // cliente (nombre, razón social, RUC/CI), sin tildes ni orden (columna `busqueda`, 58).
    const texto = (p.get("q") ?? "").trim().slice(0, 200);
    const mNumero = /^(?:#|n[°º]?|nro\.?|ticket|t)?\s*0*(\d{1,9})$/i.exec(texto);
    let numeroExacto: number | null = null;
    if (mNumero) {
      const n = Number(mNumero[1]);
      const { data: hay } = await ctx.db.select("soporte_tickets", "id").eq("numero", n).limit(1);
      // "#12" / "ticket 12" son siempre por número; "12" solo, si existe ese ticket
      if ((hay ?? []).length || /^(#|n|nro|ticket|t)/i.test(texto)) numeroExacto = n;
    }
    const grupos = texto && numeroExacto == null ? await variantesBusqueda(ctx.db, texto) : [];
    const aplicarSinMios = (q: Q): Q => {
      let b = q;
      if (numeroExacto != null) b = b.eq("numero", numeroExacto);
      else for (const g of grupos) b = b.or(condicionGrupo(g));
      if (p.get("cargados") === "1") b = b.eq("created_by", ctx.usuarioId);
      for (const [param, columna] of [
        ["cliente_id", "cliente_id"],
        ["estado", "estado_codigo"],
        ["tipo", "tipo_codigo"],
        ["prioridad", "prioridad_codigo"],
        ["responsable_id", "responsable_id"],
      ] as const) {
        const v = p.get(param);
        if (!v) continue;
        if ((param === "cliente_id" || param === "responsable_id") && !esUuid(v)) b = b.eq(columna, NINGUNO);
        else b = b.eq(columna, v);
      }
      return b;
    };
    const soloMios = p.get("mios") === "1";
    const revision = p.get("revision") === "1";
    const aplicar = (q: Q): Q => (soloMios ? aplicarSinMios(q).eq("responsable_id", ctx.usuarioId) : aplicarSinMios(q));

    let idsRevision: string[] = [];
    if (soloMios || revision) {
      const { data: subs } = await ctx.db
        .select("soporte_subtareas", "ticket_id")
        .eq("asignado_id", ctx.usuarioId)
        .in("estado", ["pendiente", "en_proceso"]);
      idsRevision = [...new Set(((subs ?? []) as unknown as { ticket_id: string }[]).map((x) => x.ticket_id))];
    }

    let lista: Q = revision
      ? aplicarSinMios(ctx.db.select("soporte_tickets", TICKET_CAMPOS, { count: "exact" })).in("id", idsRevision.length ? idsRevision : [NINGUNO])
      : aplicar(ctx.db.select("soporte_tickets", TICKET_CAMPOS, { count: "exact" }));
    const estadosParam = (p.get("estados") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    if (!revision && estadosParam.length) lista = lista.in("estado_codigo", estadosParam);
    else if (!revision && pestana.estados) lista = lista.in("estado_codigo", [...pestana.estados]);
    const desde = (pagina - 1) * porPagina;

    const [cat, cfg, res, todos] = await Promise.all([
      leerCatalogos(ctx),
      leerConfig(ctx),
      lista.order("updated_at", { ascending: false }).range(desde, desde + porPagina - 1),
      aplicar(ctx.db.select("soporte_tickets", "estado_codigo")).limit(10_000),
    ]);
    if (res.error) return falla("No se pudieron cargar los tickets", 500);

    const porEstado = new Map<string, number>();
    for (const r of (todos.data ?? []) as { estado_codigo: string }[]) porEstado.set(r.estado_codigo, (porEstado.get(r.estado_codigo) ?? 0) + 1);
    const contadores: Record<string, number> = {};
    for (const t of PESTANAS_TICKETS) {
      contadores[t.id] = t.estados ? t.estados.reduce((s, e) => s + (porEstado.get(e) ?? 0), 0) : [...porEstado.values()].reduce((s, n) => s + n, 0);
    }

    const tickets = await enriquecerTickets(ctx, cat, cfg, (res.data ?? []) as TicketFila[]);
    return ok({
      tickets,
      total: res.count ?? 0,
      pagina,
      por_pagina: porPagina,
      contadores,
      por_estado: Object.fromEntries(porEstado),
      ...(soloMios || revision ? { revisiones_pendientes: idsRevision.length } : {}),
    });
  } catch (e) {
    console.error("[soporte/tickets]", (e as Error)?.message);
    return falla("No se pudieron cargar los tickets", 500);
  }
});

export const POST = withTenant(async () => falla("Los tickets se cargan desde la tipificación del cliente (Gestión de clientes)", 405));
