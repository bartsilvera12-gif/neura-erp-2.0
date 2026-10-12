/**
 * Un prospecto del CRM.
 *   GET    /api/crm/[id] → { prospecto, notas }  (las notas se cargan solo al abrir el detalle)
 *   PATCH  /api/crm/[id] { empresa?, contacto?, telefono?, email?, servicio?, valor_estimado?,
 *                          proxima_accion?, fecha_proxima_accion?, origen_creacion?, origen_detalle?,
 *                          responsable_usuario_id?, observaciones? } → { prospecto }
 *          (la etapa se cambia con POST /api/crm/[id]/mover, que deja la nota del cambio)
 *   DELETE /api/crm/[id] → lo borra (ADMIN, quien lo creó o su responsable)
 */
import { z } from "zod";
import { withTenant, type TenantContext } from "@/lib/api/with-tenant";
import { ok, noContent, fail, ERR } from "@/lib/api/responses";
import { COLS_PROSPECTO, enriquecerTarjetas, errorCrm, idProspecto, usuarioValido } from "@/modules/crm/server";
import { ORIGENES, type Prospecto } from "@/modules/crm/tipos";

export const dynamic = "force-dynamic";

async function conNombres(ctx: TenantContext, fila: Record<string, unknown>): Promise<Prospecto> {
  const [t] = await enriquecerTarjetas(ctx, [fila]);
  let creado: string | null = null;
  if (typeof fila.created_by === "string") {
    const { data } = await ctx.db.select("usuarios", "nombre").eq("id", fila.created_by).limit(1);
    creado = (data?.[0] as unknown as { nombre?: string } | undefined)?.nombre ?? null;
  }
  return { ...(fila as unknown as Prospecto), ...t, creado_por_nombre: creado };
}

export const GET = withTenant(async (ctx, req) => {
  const id = idProspecto(req);
  if (!id) return ERR.notFound("Prospecto");
  const [p, n] = await Promise.all([
    ctx.db.select("crm_prospectos", COLS_PROSPECTO).eq("id", id).limit(1),
    ctx.db.select("crm_notas", "id, tipo, texto, usuario_id, usuario_nombre, created_at").eq("prospecto_id", id).order("created_at", { ascending: false }).limit(300),
  ]);
  if (p.error || n.error) return ERR.server();
  const fila = p.data?.[0] as unknown as Record<string, unknown> | undefined;
  if (!fila) return ERR.notFound("Prospecto");
  return ok({ prospecto: await conNombres(ctx, fila), notas: n.data ?? [] });
});

const texto = (max: number) => z.string().trim().max(max).optional().nullable();

const editar = z.object({
  contacto: z.string().trim().min(1, "El contacto es obligatorio").max(200).optional(),
  empresa: texto(200),
  telefono: texto(40),
  email: z.string().trim().max(200).email("Email inválido").optional().nullable().or(z.literal("")),
  servicio: texto(500),
  valor_estimado: z.coerce.number().min(0).max(1e15).optional(),
  proxima_accion: texto(500),
  fecha_proxima_accion: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida").optional().nullable().or(z.literal("")),
  origen_creacion: z.enum(ORIGENES).optional(),
  origen_detalle: texto(200),
  responsable_usuario_id: z.string().uuid().optional().nullable().or(z.literal("")),
  observaciones: texto(4000),
});

export const PATCH = withTenant(
  async (ctx, req, input) => {
    const id = idProspecto(req);
    if (!id) return ERR.notFound("Prospecto");
    const patch: Record<string, unknown> = {};
    const nul = (v: string | null | undefined) => (v ? v : null);
    if (input.contacto !== undefined) patch.contacto = input.contacto;
    if (input.empresa !== undefined) patch.empresa = nul(input.empresa);
    if (input.telefono !== undefined) patch.telefono = nul(input.telefono);
    if (input.email !== undefined) patch.email = input.email ? input.email.toLowerCase() : null;
    if (input.servicio !== undefined) patch.servicio = nul(input.servicio);
    if (input.valor_estimado !== undefined) patch.valor_estimado = Math.round(input.valor_estimado);
    if (input.proxima_accion !== undefined) patch.proxima_accion = nul(input.proxima_accion);
    if (input.fecha_proxima_accion !== undefined) patch.fecha_proxima_accion = nul(input.fecha_proxima_accion);
    if (input.origen_creacion !== undefined) patch.origen_creacion = input.origen_creacion;
    if (input.origen_detalle !== undefined) patch.origen_detalle = nul(input.origen_detalle);
    if (input.observaciones !== undefined) patch.observaciones = nul(input.observaciones);
    if (input.responsable_usuario_id !== undefined) {
      const r = input.responsable_usuario_id || null;
      if (r && r !== ctx.usuarioId && !(await usuarioValido(ctx, r))) return fail("Responsable inválido", 422);
      patch.responsable_usuario_id = r;
    }
    if (!Object.keys(patch).length) return ERR.invalid("No hay cambios");
    const { data, error } = await ctx.db.update("crm_prospectos", patch).eq("id", id).select(COLS_PROSPECTO);
    if (error) return errorCrm(error, "No se pudo guardar el prospecto");
    const fila = data?.[0] as unknown as Record<string, unknown> | undefined;
    if (!fila) return ERR.notFound("Prospecto");
    return ok({ prospecto: await conNombres(ctx, fila) });
  },
  { body: editar },
);

export const DELETE = withTenant(async (ctx, req) => {
  const id = idProspecto(req);
  if (!id) return ERR.notFound("Prospecto");
  let q = ctx.db.delete("crm_prospectos").eq("id", id);
  if (ctx.rol !== "ADMIN") q = q.or(`created_by.eq.${ctx.usuarioId},responsable_usuario_id.eq.${ctx.usuarioId}`);
  const { data, error } = await q.select("id");
  if (error) return errorCrm(error, "No se pudo eliminar el prospecto");
  if (!data?.length) return fail("Solo podés eliminar prospectos tuyos (o pedíselo a un administrador).", 403);
  return noContent();
});
