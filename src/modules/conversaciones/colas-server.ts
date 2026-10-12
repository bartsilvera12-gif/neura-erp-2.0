/**
 * Colas de atención (configuración, solo ADMIN) — lado servidor.
 * Una cola: nombre, estrategia (equitativa | manual), prioridad, SLA de primera respuesta,
 * tope de reasignaciones, ventana de "mismo asesor", canales vinculados y asesores
 * (recibe nuevos, máximo de conversaciones, supervisor). Se guarda todo junto.
 */
import { z } from "zod";
import type { TenantContext } from "@/lib/api/with-tenant";
import type { AgenteCola, Cola, DatosColas } from "@/modules/conversaciones/supervision";

const entero = (min: number, max: number, campo: string) =>
  z.coerce.number({ invalid_type_error: `${campo}: número inválido` }).int(`${campo}: tiene que ser entero`).min(min, `${campo}: mínimo ${min}`).max(max, `${campo}: máximo ${max}`);

export const esquemaCola = z.object({
  nombre: z.string().trim().min(1, "Poné un nombre a la cola").max(80, "Nombre: máximo 80 caracteres"),
  estrategia: z.enum(["equitativa", "manual"]),
  prioridad: entero(-1000, 1000, "Prioridad"),
  sla_minutos: entero(1, 1440, "SLA"),
  max_reasignaciones: entero(0, 20, "Máx. reasignaciones"),
  mismo_asesor_horas: entero(0, 720, "Mismo asesor"),
  activo: z.boolean(),
  canales: z.array(z.string().uuid()).max(100),
  agentes: z
    .array(
      z.object({
        usuario_id: z.string().uuid(),
        recibe_nuevos: z.boolean(),
        max_conversaciones: entero(1, 500, "Máximo de conversaciones"),
        es_supervisor: z.boolean(),
      }),
    )
    .max(500),
});
export type EntradaCola = z.infer<typeof esquemaCola>;

type FilaCola = Omit<Cola, "canales" | "agentes">;

export async function leerColas(ctx: TenantContext): Promise<DatosColas> {
  const [colas, canalesCola, agentesCola, canales, usuarios] = await Promise.all([
    ctx.db.select("chat_colas", "id, nombre, estrategia, prioridad, sla_minutos, max_reasignaciones, mismo_asesor_horas, activo").order("prioridad", { ascending: false }).order("nombre"),
    ctx.db.select("chat_cola_canales", "cola_id, canal_id"),
    ctx.db.select("chat_cola_agentes", "cola_id, usuario_id, recibe_nuevos, max_conversaciones, es_supervisor"),
    ctx.db.select("chat_canales", "id, nombre, tipo, activo").order("created_at"),
    ctx.db.select("usuarios", "id, nombre, rol, activo").order("nombre"),
  ]);
  const err = colas.error ?? canalesCola.error ?? agentesCola.error ?? canales.error ?? usuarios.error;
  if (err) throw new Error(err.message);
  const cc = (canalesCola.data ?? []) as unknown as { cola_id: string; canal_id: string }[];
  const ca = (agentesCola.data ?? []) as unknown as (AgenteCola & { cola_id: string })[];
  return {
    colas: ((colas.data ?? []) as unknown as FilaCola[]).map((c) => ({
      ...c,
      canales: cc.filter((x) => x.cola_id === c.id).map((x) => x.canal_id),
      agentes: ca
        .filter((x) => x.cola_id === c.id)
        .map(({ usuario_id, recibe_nuevos, max_conversaciones, es_supervisor }) => ({ usuario_id, recibe_nuevos, max_conversaciones, es_supervisor })),
    })),
    canales: (canales.data ?? []) as unknown as DatosColas["canales"],
    usuarios: ((usuarios.data ?? []) as unknown as { id: string; nombre: string; rol: string; activo: boolean }[])
      .filter((u) => u.activo !== false)
      .map(({ id, nombre, rol }) => ({ id, nombre, rol })),
  };
}

/** Los canales y usuarios tienen que ser de la empresa (la FK sola no lo garantiza). */
async function validarReferencias(ctx: TenantContext, e: EntradaCola): Promise<string | null> {
  const canales = [...new Set(e.canales)];
  const usuarios = [...new Set(e.agentes.map((a) => a.usuario_id))];
  if (usuarios.length !== e.agentes.length) return "Hay un asesor repetido en la cola.";
  const [c, u] = await Promise.all([
    canales.length ? ctx.db.select("chat_canales", "id").in("id", canales) : Promise.resolve({ data: [], error: null }),
    usuarios.length ? ctx.db.select("usuarios", "id").in("id", usuarios) : Promise.resolve({ data: [], error: null }),
  ]);
  if ((c.data?.length ?? 0) !== canales.length) return "Algún canal no existe.";
  if ((u.data?.length ?? 0) !== usuarios.length) return "Algún asesor no existe.";
  return null;
}

/** Guarda la cola (alta o edición) con sus canales y asesores. Devuelve el id o un mensaje de error. */
export async function guardarCola(ctx: TenantContext, id: string | null, e: EntradaCola): Promise<{ ok: true; id: string } | { ok: false; mensaje: string; status: number }> {
  const malo = await validarReferencias(ctx, e);
  if (malo) return { ok: false, mensaje: malo, status: 422 };
  const datos = {
    nombre: e.nombre,
    estrategia: e.estrategia,
    prioridad: e.prioridad,
    sla_minutos: e.sla_minutos,
    max_reasignaciones: e.max_reasignaciones,
    mismo_asesor_horas: e.mismo_asesor_horas,
    activo: e.activo,
  };
  let colaId = id;
  if (colaId) {
    const { data, error } = await ctx.db.update("chat_colas", datos).eq("id", colaId).select("id");
    if (error) return { ok: false, mensaje: "No se pudo guardar la cola.", status: 500 };
    if (!data?.length) return { ok: false, mensaje: "La cola no existe.", status: 404 };
  } else {
    const { data, error } = await ctx.db.insert("chat_colas", datos);
    if (error || !data?.[0]) return { ok: false, mensaje: "No se pudo crear la cola.", status: 500 };
    colaId = String((data[0] as { id: string }).id);
  }

  // Canales y asesores: se quitan los que ya no están y se agregan/actualizan los demás
  // (sin vaciar la cola en el medio, así la asignación automática nunca la ve sin asesores).
  const canales = [...new Set(e.canales)];
  const usuarios = e.agentes.map((a) => a.usuario_id);
  const fuera = (lista: string[]) => `(${lista.join(",")})`;
  const sb = ctx.db.unsafeRaw(); // upsert: empresa_id va explícito en cada fila (y la RLS lo exige igual)

  let qc = ctx.db.delete("chat_cola_canales").eq("cola_id", colaId);
  if (canales.length) qc = qc.not("canal_id", "in", fuera(canales));
  let qa = ctx.db.delete("chat_cola_agentes").eq("cola_id", colaId);
  if (usuarios.length) qa = qa.not("usuario_id", "in", fuera(usuarios));
  const [dc, da] = await Promise.all([qc, qa]);
  if (dc.error || da.error) return { ok: false, mensaje: "No se pudieron actualizar los canales o asesores.", status: 500 };

  const [uc, ua] = await Promise.all([
    canales.length
      ? sb.from("chat_cola_canales").upsert(
          canales.map((canal_id) => ({ cola_id: colaId, canal_id, empresa_id: ctx.empresaId })),
          { onConflict: "cola_id,canal_id", ignoreDuplicates: true },
        )
      : Promise.resolve({ error: null }),
    e.agentes.length
      ? sb.from("chat_cola_agentes").upsert(
          e.agentes.map((a) => ({ ...a, cola_id: colaId, empresa_id: ctx.empresaId })),
          { onConflict: "cola_id,usuario_id" },
        )
      : Promise.resolve({ error: null }),
  ]);
  if (uc.error || ua.error) {
    console.error("[conversaciones] colas upsert", uc.error?.message ?? ua.error?.message);
    return { ok: false, mensaje: "No se pudieron guardar los canales o asesores.", status: 500 };
  }
  return { ok: true, id: colaId };
}
