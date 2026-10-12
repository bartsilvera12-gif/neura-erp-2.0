/**
 * GET /api/soporte/dashboard?dias=mes|7|30|90|0
 *
 * Vista ejecutiva sobre los tickets CREADOS en el período: KPIs (con la variación
 * contra el período anterior de igual largo; "mes" y "todo" sin comparación),
 * tickets por estado, por tipo, top clientes y por responsable (cada uno con sus
 * tickets para desplegar).
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { calcularSla, etiquetaTipo, hoyPy, type TicketFila } from "@/modules/soporte/dominio";
import {
  accesoSoporte,
  clientesPorId,
  falla,
  leerCatalogos,
  leerConfig,
  personasPorId,
  sinAccesoSoporte,
  ticketsParaAgregar,
} from "@/modules/soporte/server";

const DIA_MS = 86_400_000;

type Item = { id: string; numero: number | null; cliente: string; tipo: string };

export const GET = withTenant(async (ctx, req) => {
  const acc = await accesoSoporte(ctx);
  if (!acc) return sinAccesoSoporte();
  if (!acc.veDashboard) return falla("El Dashboard de Soporte no está habilitado para tu usuario", 403);
  try {
    const periodo = new URL(req.url).searchParams.get("dias") ?? "mes";
    const [cat, cfg, todos] = await Promise.all([leerCatalogos(ctx), leerConfig(ctx), ticketsParaAgregar(ctx)]);

    const ahora = Date.now();
    const ahoraIso = new Date(ahora).toISOString();
    let inicio: number | null;
    let inicioPrevio: number | null;
    let dias = 0;
    if (periodo === "mes") {
      inicio = Date.parse(`${hoyPy().slice(0, 7)}-01T00:00:00-03:00`);
      inicioPrevio = null;
    } else {
      dias = Math.max(0, Math.min(365, Number(periodo) || 0));
      inicio = dias ? ahora - dias * DIA_MS : null;
      inicioPrevio = dias ? ahora - 2 * dias * DIA_MS : null;
    }
    const enRango = (t: TicketFila, desde: number | null, hasta: number) => {
      const c = Date.parse(t.created_at);
      return (desde == null || c >= desde) && c < hasta;
    };
    const actuales = todos.filter((t) => enRango(t, inicio, ahora + 1));
    const previos = inicioPrevio != null && inicio != null ? todos.filter((t) => enRango(t, inicioPrevio, inicio)) : [];

    const kpis = (lista: TicketFila[]) => {
      const cuenta = (...codigos: string[]) => lista.filter((t) => codigos.includes(t.estado_codigo)).length;
      return {
        total: lista.length,
        pendientes: cuenta("pendiente"),
        en_proceso: cuenta("en_proceso", "reabierto"),
        falta_informacion: cuenta("falta_informacion"),
        en_revision: cuenta("listo_revision"),
        resueltos: cuenta("resuelto"),
        cerrados: cuenta("cerrado", "cancelado"),
        sla_vencidos: lista.filter((t) => calcularSla(t, cfg, ahoraIso).estado === "vencido").length,
      };
    };
    const kActual = kpis(actuales);
    const kPrevio = inicioPrevio != null && inicio != null ? kpis(previos) : null;
    const variacion: Record<string, number | null> = {};
    for (const k of Object.keys(kActual) as (keyof typeof kActual)[]) {
      const antes = kPrevio?.[k];
      variacion[k] = antes == null || antes === 0 ? null : Math.round(((kActual[k] - antes) / antes) * 100);
    }

    const porEstado = cat.estados
      .filter((e) => e.activo && (cfg.qa_activo || e.codigo !== "listo_revision"))
      .map((e) => ({ codigo: e.codigo, nombre: e.nombre, color: e.color, cantidad: actuales.filter((t) => t.estado_codigo === e.codigo).length }));

    const tipos = new Map<string, number>();
    for (const t of actuales) {
      const et = etiquetaTipo(cat, t.tipo_codigo, t.clasificacion_codigo);
      tipos.set(et, (tipos.get(et) ?? 0) + 1);
    }
    const porTipo = [...tipos.entries()].map(([nombre, cantidad]) => ({ nombre, cantidad })).sort((a, b) => b.cantidad - a.cantidad);

    const [clientes, personas] = await Promise.all([
      clientesPorId(ctx, actuales.map((t) => t.cliente_id)),
      personasPorId(ctx, actuales.map((t) => t.responsable_id)),
    ]);
    const porDesc = (a: Item, b: Item) => (b.numero ?? 0) - (a.numero ?? 0);
    const porCliente = new Map<string, Item[]>();
    const porResp = new Map<string | null, Item[]>();
    for (const t of actuales) {
      const item: Item = {
        id: t.id,
        numero: t.numero ?? null,
        cliente: t.cliente_id ? (clientes.get(t.cliente_id) ?? "—") : "—",
        tipo: etiquetaTipo(cat, t.tipo_codigo, t.clasificacion_codigo),
      };
      if (t.cliente_id) porCliente.set(t.cliente_id, [...(porCliente.get(t.cliente_id) ?? []), item]);
      porResp.set(t.responsable_id, [...(porResp.get(t.responsable_id) ?? []), item]);
    }
    const topClientes = [...porCliente.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 10)
      .map(([cid, items]) => ({ cliente: clientes.get(cid) ?? "Cliente", tickets: items.length, items: [...items].sort(porDesc) }));
    const porResponsable = [...porResp.entries()]
      .map(([rid, items]) => ({
        responsable: rid ? (personas.get(rid)?.nombre ?? "Usuario") : "Sin responsable",
        tickets: items.length,
        items: [...items].sort(porDesc),
      }))
      .sort((a, b) => b.tickets - a.tickets);

    return ok({ dias, kpis: kActual, variacion, por_estado: porEstado, por_tipo: porTipo, top_clientes: topClientes, por_responsable: porResponsable });
  } catch (e) {
    console.error("[soporte/dashboard]", (e as Error)?.message);
    return falla("No se pudo cargar el dashboard", 500);
  }
});
