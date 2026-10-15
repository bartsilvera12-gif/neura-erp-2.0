/**
 * Estados de Proyectos (columnas del Kanban). Los códigos son fijos; se edita nombre,
 * color, orden, tipo de SLA, objetivo en horas laborales, rol, estado inicial y si está activo.
 *   GET /api/proyectos/estados[?activas=1] → [{ id, codigo, nombre, color, orden, tipo_sla, sla_horas_objetivo, rol, es_inicial, es_final, activo, cantidad? }]
 *   PUT /api/proyectos/estados { estados: [...] } → la lista (solo ADMIN)
 *       No se puede desactivar un estado que tiene proyectos (desaparecerían del tablero).
 */
import { z } from "zod";
import { withTenant, type TenantContext } from "@/lib/api/with-tenant";
import { ok, fail, ERR } from "@/lib/api/responses";
import { ROLES_ESTADO, TIPOS_SLA, type Estado } from "@/modules/proyectos/tipos";

export const dynamic = "force-dynamic";

const COLS = "id, codigo, nombre, color, orden, tipo_sla, sla_horas_objetivo, rol, es_inicial, es_final, activo";

type Fila = Required<Estado>;

async function listar(ctx: TenantContext, soloActivas: boolean): Promise<Fila[] | null> {
  let q = ctx.db.select("proyecto_estados", COLS);
  if (soloActivas) q = q.eq("activo", true);
  const { data, error } = await q.order("orden", { ascending: true });
  if (error) return null;
  return ((data ?? []) as unknown as Fila[]).map((e) => ({ ...e, sla_horas_objetivo: e.sla_horas_objetivo == null ? null : Number(e.sla_horas_objetivo) }));
}

/** Proyectos por estado (activos y archivados: un estado con archivados tampoco se puede ocultar). */
async function cantidades(ctx: TenantContext, ids: string[]) {
  const r = await Promise.all(ids.map((id) => ctx.db.select("proyectos", "id", { count: "exact", head: true }).eq("estado_id", id)));
  return new Map(ids.map((id, i) => [id, r[i].count ?? 0]));
}

async function conCantidad(ctx: TenantContext, estados: Fila[]) {
  const cant = await cantidades(ctx, estados.map((e) => e.id));
  return estados.map((e) => ({ ...e, cantidad: cant.get(e.id) ?? 0 }));
}

export const GET = withTenant(async (ctx, req) => {
  const soloActivas = new URL(req.url).searchParams.get("activas") === "1";
  const estados = await listar(ctx, soloActivas);
  if (!estados) return ERR.server();
  if (soloActivas) return ok(estados);
  return ok(await conCantidad(ctx, estados));
});

const HEX = /^#[0-9a-f]{6}$/i;

const guardar = z.object({
  estados: z
    .array(
      z.object({
        id: z.string().uuid(),
        nombre: z.string().trim().min(1, "Cada estado necesita un nombre").max(60),
        color: z.string().regex(HEX, "Color inválido"),
        orden: z.coerce.number().int().min(0).max(999),
        tipo_sla: z.enum(TIPOS_SLA),
        sla_horas_objetivo: z.coerce.number().min(0).max(10_000).nullable(),
        rol: z.enum(ROLES_ESTADO),
        es_inicial: z.boolean(),
        activo: z.boolean(),
      }),
    )
    .min(1)
    .max(40),
});

export const PUT = withTenant(
  async (ctx, _req, input) => {
    const actuales = await listar(ctx, false);
    if (!actuales) return ERR.server();
    const porId = new Map(actuales.map((e) => [e.id, e]));
    if (input.estados.some((e) => !porId.has(e.id))) return fail("Estado inválido", 422);

    const final = new Map(actuales.map((e) => [e.id, { ...e }]));
    for (const e of input.estados) {
      final.set(e.id, { ...porId.get(e.id)!, ...e, es_final: e.tipo_sla === "final", sla_horas_objetivo: e.tipo_sla === "interno" && e.sla_horas_objetivo ? e.sla_horas_objetivo : null });
    }
    const todos = [...final.values()];

    for (const e of todos) {
      if ((e.rol === "entregado" || e.rol === "cancelado") && e.tipo_sla !== "final") {
        return fail(`"${e.nombre}" es de entrega o cancelación: su tipo de SLA tiene que ser "Final".`, 422);
      }
      if (e.rol === "pausado" && e.tipo_sla !== "pausado") return fail(`"${e.nombre}" tiene rol Pausado: su tipo de SLA tiene que ser "Pausado".`, 422);
    }
    if (!todos.some((e) => e.activo && !e.es_final)) return fail("Tiene que quedar al menos un estado abierto activo.", 422);
    const iniciales = todos.filter((e) => e.es_inicial);
    if (iniciales.length !== 1) return fail("Marcá un (y solo un) estado inicial.", 422);
    if (!iniciales[0].activo || iniciales[0].es_final) return fail("El estado inicial tiene que estar activo y no puede ser final.", 422);

    const aDesactivar = input.estados.filter((e) => !e.activo && porId.get(e.id)!.activo).map((e) => e.id);
    if (aDesactivar.length) {
      const cant = await cantidades(ctx, aDesactivar);
      const ocupado = aDesactivar.find((id) => (cant.get(id) ?? 0) > 0);
      if (ocupado) {
        return fail(`No se puede desactivar "${final.get(ocupado)!.nombre}": tiene ${cant.get(ocupado)} proyecto(s). Movelos a otro estado primero.`, 422);
      }
    }

    const campos = ["nombre", "color", "orden", "tipo_sla", "sla_horas_objetivo", "rol", "es_inicial", "es_final", "activo"] as const;
    const cambios = todos.filter((e) => campos.some((k) => porId.get(e.id)![k] !== e[k]));
    // Primero se apaga el inicial viejo (si cambió) para no dejar dos marcados a la vez.
    const orden = [...cambios].sort((a, b) => Number(a.es_inicial) - Number(b.es_inicial));
    for (const e of orden) {
      const { error } = await ctx.db
        .update("proyecto_estados", Object.fromEntries(campos.map((k) => [k, e[k]])))
        .eq("id", e.id);
      if (error) return fail("No se pudieron guardar los estados", 422);
    }
    const estados = await listar(ctx, false);
    if (!estados) return ERR.server();
    return ok(await conCantidad(ctx, estados));
  },
  { permiso: "configuracion", body: guardar },
);
