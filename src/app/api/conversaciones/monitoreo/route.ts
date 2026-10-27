/**
 * Monitoreo (ADMIN o supervisor de una cola).
 *   GET /api/conversaciones/monitoreo?fecha=YYYY-MM-DD
 *   → { resumen, sin_asignar, esperando, agentes, fecha_leads, es_admin }
 * chat_monitoreo arma todo en UNA consulta; acá se suma el teléfono, canal y cola de los
 * chats listados (una consulta por id) y los "leads" (asignaciones automáticas) del día
 * elegido desde chat_asignaciones_dia. Un supervisor con equipo cargado
 * (chat_supervisor_asesores) ve solo a esos asesores y sus chats en espera.
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import { hoyPY } from "@/lib/fecha/paraguay";
import { alcanceSupervision, puedeSupervisar } from "@/modules/conversaciones/server";
import type { AgenteMonitoreo, DatosMonitoreo, Esperando, ResumenMonitoreo, SinAsignar } from "@/modules/conversaciones/supervision";

export const dynamic = "force-dynamic";

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const RESUMEN_VACIO: ResumenMonitoreo = {
  abiertas: 0, sin_asignar: 0, esperando_respuesta: 0, sla_vencidos: 0, fuera_de_ventana: 0, agentes_online: 0, nuevos_hoy: 0, cerradas_hoy: 0,
};

type Crudo = {
  resumen: ResumenMonitoreo | null;
  sin_asignar: Omit<SinAsignar, "telefono" | "canal" | "canal_tipo" | "cola">[];
  esperando: Omit<Esperando, "telefono" | "canal">[];
  agentes: Omit<AgenteMonitoreo, "leads">[];
};
type Extra = { id: string; canal_id: string; cola_id: string | null; contacto: { telefono: string | null } | null };

export const GET = withTenant(async (ctx, req) => {
  if (!(await puedeSupervisar(ctx))) return ERR.forbidden();
  const sp = new URL(req.url).searchParams;
  const hoy = hoyPY();
  const f = sp.get("fecha");
  const fecha = f && FECHA_RE.test(f) && f <= hoy ? f : hoy;

  const [mon, dia, colas, canales] = await Promise.all([
    ctx.db.rpc<Crudo>("chat_monitoreo"),
    ctx.db.select("chat_asignaciones_dia", "usuario_id, cantidad").eq("dia", fecha),
    ctx.db.select("chat_colas", "id, nombre"),
    ctx.db.select("chat_canales", "id, nombre, tipo"),
  ]);
  if (mon.error) {
    console.error("[conversaciones] monitoreo", mon.error.message);
    return ERR.server();
  }
  const d = mon.data;
  // Supervisor con equipo: solo sus asesores (y él) y los chats que esperan respuesta de
  // ellos. Los sin asignar se ven igual (todavía no son de nadie).
  const equipo = await alcanceSupervision(ctx);
  const enEquipo = (id: string | null | undefined) => !equipo || (!!id && equipo.includes(id));
  const sinAsignar = d?.sin_asignar ?? [];
  const esperando = (d?.esperando ?? []).filter((x) => enEquipo(x.asignado_id));

  // Teléfono, canal y cola de los chats listados (una sola consulta por id).
  const ids = [...new Set([...sinAsignar.map((x) => x.id), ...esperando.map((x) => x.id)])];
  const extra = new Map<string, Extra>();
  if (ids.length) {
    const { data, error } = await ctx.db
      .select("chat_conversaciones", "id, canal_id, cola_id, contacto:chat_contactos!contacto_id(telefono)")
      .in("id", ids);
    if (error) console.error("[conversaciones] monitoreo extra", error.message);
    for (const r of (data ?? []) as unknown as Extra[]) extra.set(r.id, r);
  }
  const nombreCola = new Map(((colas.data ?? []) as unknown as { id: string; nombre: string }[]).map((c) => [c.id, c.nombre]));
  const canal = new Map(((canales.data ?? []) as unknown as { id: string; nombre: string; tipo: string }[]).map((c) => [c.id, c]));
  const leads = new Map<string, number>();
  for (const r of (dia.data ?? []) as unknown as { usuario_id: string; cantidad: number }[]) {
    leads.set(r.usuario_id, (leads.get(r.usuario_id) ?? 0) + (Number(r.cantidad) || 0));
  }

  const out: DatosMonitoreo = {
    resumen: { ...RESUMEN_VACIO, ...(d?.resumen ?? {}) },
    sin_asignar: sinAsignar.map((x) => {
      const e = extra.get(x.id);
      const c = e ? canal.get(e.canal_id) : undefined;
      return {
        ...x,
        telefono: e?.contacto?.telefono ?? null,
        canal: c?.nombre ?? null,
        canal_tipo: c?.tipo ?? null,
        cola: e?.cola_id ? nombreCola.get(e.cola_id) ?? null : null,
      };
    }),
    esperando: esperando.map((x) => {
      const e = extra.get(x.id);
      return { ...x, telefono: e?.contacto?.telefono ?? null, canal: e ? canal.get(e.canal_id)?.nombre ?? null : null };
    }),
    agentes: (d?.agentes ?? []).filter((a) => enEquipo(a.id)).map((a) => ({
      ...a,
      carga: Number(a.carga) || 0,
      esperando_respuesta: Number(a.esperando_respuesta) || 0,
      sla_vencidos: Number(a.sla_vencidos) || 0,
      asignadas_hoy: Number(a.asignadas_hoy) || 0,
      cerradas_hoy: Number(a.cerradas_hoy) || 0,
      leads: leads.get(a.id) ?? 0,
    })),
    fecha_leads: fecha,
    es_admin: ctx.rol === "ADMIN",
    equipo_limitado: !!equipo,
  };
  return ok(out);
});
