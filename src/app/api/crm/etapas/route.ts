/**
 * Etapas del pipeline (columnas del Kanban). Los códigos son fijos; se edita nombre,
 * color, orden y si está activa.
 *   GET /api/crm/etapas[?activas=1] → [{ id, codigo, nombre, color, orden, es_ganado, es_perdido, activo, cantidad }]
 *   PUT /api/crm/etapas { etapas: [{ id, nombre, color, orden, activo }] } → la lista (solo ADMIN)
 *       No se puede desactivar una etapa que tiene prospectos (desaparecerían del tablero).
 */
import { z } from "zod";
import { withTenant, type TenantContext } from "@/lib/api/with-tenant";
import { ok, fail, ERR } from "@/lib/api/responses";
import { COLORES_ETAPA } from "@/modules/crm/tipos";

export const dynamic = "force-dynamic";

const COLS = "id, codigo, nombre, color, orden, es_ganado, es_perdido, activo";

type FilaEtapa = { id: string; codigo: string; nombre: string; color: string; orden: number; es_ganado: boolean; es_perdido: boolean; activo: boolean };

async function listar(ctx: TenantContext, soloActivas: boolean) {
  let q = ctx.db.select("crm_etapas", COLS);
  if (soloActivas) q = q.eq("activo", true);
  const { data, error } = await q.order("orden", { ascending: true });
  if (error) return null;
  return (data ?? []) as unknown as FilaEtapa[];
}

/** Cantidad de prospectos por etapa (una consulta con head+count por etapa es barata con el índice). */
async function cantidades(ctx: TenantContext, codigos: string[]) {
  const r = await Promise.all(
    codigos.map((c) => ctx.db.select("crm_prospectos", "id", { count: "exact", head: true }).eq("etapa", c)),
  );
  return new Map(codigos.map((c, i) => [c, r[i].count ?? 0]));
}

export const GET = withTenant(async (ctx, req) => {
  const soloActivas = new URL(req.url).searchParams.get("activas") === "1";
  const etapas = await listar(ctx, soloActivas);
  if (!etapas) return ERR.server();
  if (soloActivas) return ok(etapas);
  const cant = await cantidades(ctx, etapas.map((e) => e.codigo));
  return ok(etapas.map((e) => ({ ...e, cantidad: cant.get(e.codigo) ?? 0 })));
});

const guardar = z.object({
  etapas: z
    .array(
      z.object({
        id: z.string().uuid(),
        nombre: z.string().trim().min(1, "Cada etapa necesita un nombre").max(60),
        color: z.enum(COLORES_ETAPA),
        orden: z.coerce.number().int().min(0).max(999),
        activo: z.boolean(),
      }),
    )
    .min(1)
    .max(30),
});

export const PUT = withTenant(
  async (ctx, _req, input) => {
    const actuales = await listar(ctx, false);
    if (!actuales) return ERR.server();
    const porId = new Map(actuales.map((e) => [e.id, e]));
    if (input.etapas.some((e) => !porId.has(e.id))) return fail("Etapa inválida", 422);

    const aDesactivar = input.etapas.filter((e) => !e.activo && porId.get(e.id)!.activo).map((e) => porId.get(e.id)!.codigo);
    if (aDesactivar.length) {
      const cant = await cantidades(ctx, aDesactivar);
      const ocupada = aDesactivar.find((c) => (cant.get(c) ?? 0) > 0);
      if (ocupada) {
        const n = porId.get(input.etapas.find((e) => porId.get(e.id)!.codigo === ocupada)!.id)!.nombre;
        return fail(`No se puede desactivar "${n}": tiene ${cant.get(ocupada)} prospecto(s). Movelos a otra etapa primero.`, 422);
      }
    }
    const final = new Map(actuales.map((e) => [e.id, e.activo]));
    for (const e of input.etapas) final.set(e.id, e.activo);
    const quedanAbiertas = actuales.some((e) => final.get(e.id) && !e.es_ganado && !e.es_perdido);
    if (!quedanAbiertas) return fail("Tiene que quedar al menos una etapa abierta activa.", 422);

    const cambios = input.etapas.filter((e) => {
      const a = porId.get(e.id)!;
      return a.nombre !== e.nombre || a.color !== e.color || a.orden !== e.orden || a.activo !== e.activo;
    });
    const r = await Promise.all(
      cambios.map((e) => ctx.db.update("crm_etapas", { nombre: e.nombre, color: e.color, orden: e.orden, activo: e.activo }).eq("id", e.id)),
    );
    if (r.some((x) => x.error)) return fail("No se pudieron guardar las etapas", 422);
    const etapas = await listar(ctx, false);
    if (!etapas) return ERR.server();
    const cant = await cantidades(ctx, etapas.map((e) => e.codigo));
    return ok(etapas.map((e) => ({ ...e, cantidad: cant.get(e.codigo) ?? 0 })));
  },
  { roles: ["ADMIN"], body: guardar },
);
