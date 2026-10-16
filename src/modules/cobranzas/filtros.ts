/**
 * Filtros de Seguimiento (los usa la pantalla y el export a Excel, así exportás lo que ves).
 *   · plan y categoría: "genéricos" en lugar del Contable/SaaS del sistema actual. El plan
 *     filtra SERVICIOS (un cliente con 2 planes muestra solo el elegido); la categoría
 *     filtra CLIENTES.
 *   · la búsqueda mira cliente, plan y categoría
 *   · tramo y "promesa hoy" filtran solo la tabla (las cifras de arriba no)
 */
import { filtrar } from "@/lib/busqueda";
import { planDe, TRAMO_PESO, type ClienteCobranza, type ServicioCobranza, type TramoKey } from "@/modules/cobranzas/tipos";

export const TODOS = "__all__";
export const SIN_CATEGORIA = "__sin__";

export type FilaSeguimiento = {
  c: ClienteCobranza;
  servicios: ServicioCobranza[];
  /** Plan a mostrar: el único, el filtrado o "Varios (n)". */
  plan: string;
  total_adeudado: number;
  cuotas_vencidas: number;
  tramo: TramoKey;
  monto_mensual: number | null;
  proximo_vencimiento: string | null;
};


function peorTramo(servs: { tramo: TramoKey }[]): TramoKey {
  let w: TramoKey = "por_vencer";
  for (const s of servs) if (TRAMO_PESO[s.tramo] > TRAMO_PESO[w]) w = s.tramo;
  return w;
}

function armarFila(c: ClienteCobranza, servs: ServicioCobranza[], planFiltro: string): FilaSeguimiento {
  const proximos = servs.map((s) => s.proximo_vencimiento).filter((x): x is string => !!x).sort();
  return {
    c,
    servicios: servs,
    plan: servs.length === 1 ? planDe(servs[0]) : planFiltro !== TODOS ? planFiltro : `Varios (${servs.length})`,
    total_adeudado: servs.reduce((a, s) => a + Number(s.total_adeudado), 0),
    cuotas_vencidas: servs.reduce((a, s) => a + s.cuotas_vencidas, 0),
    tramo: peorTramo(servs),
    monto_mensual: servs.reduce<number | null>((a, s) => (s.monto_mensual != null ? (a ?? 0) + Number(s.monto_mensual) : a), null),
    proximo_vencimiento: proximos[0] ?? null,
  };
}

/** Filas por plan + categoría + búsqueda (base de las cifras y los contadores de los chips). */
export function filasBase(clientes: ClienteCobranza[], f: { q: string; plan: string; categoria: string }): FilaSeguimiento[] {
  const out: FilaSeguimiento[] = [];
  for (const c of clientes) {
    if (f.categoria === SIN_CATEGORIA ? c.categoria != null : f.categoria !== TODOS && c.categoria !== f.categoria) continue;
    const servs = f.plan === TODOS ? c.servicios : c.servicios.filter((s) => planDe(s) === f.plan);
    if (servs.length === 0) continue;
    out.push(armarFila(c, servs, f.plan));
  }
  // Búsqueda inteligente (lib/busqueda): sin tildes, palabras en cualquier orden, errores de
  // tipeo, teléfono en cualquier forma; en cliente, categoría y plan(es). Respeta el orden.
  return filtrar(out, f.q, (r) => ({
    principal: r.c.cliente_label,
    otros: [r.c.categoria, ...r.servicios.map(planDe)],
    codigos: [r.c.telefono],
  }));
}

export function filtrarTabla(filas: FilaSeguimiento[], tramo: TramoKey | "todos", soloPromesaHoy: boolean, hoy: string): FilaSeguimiento[] {
  return filas.filter((r) => (tramo === "todos" || r.tramo === tramo) && (!soloPromesaHoy || r.c.promesa_fecha === hoy));
}

/** Orden por defecto: peor tramo y luego mayor deuda. */
export function ordenPorDefecto(filas: FilaSeguimiento[]): FilaSeguimiento[] {
  return [...filas].sort((a, b) => TRAMO_PESO[b.tramo] - TRAMO_PESO[a.tramo] || b.total_adeudado - a.total_adeudado);
}
