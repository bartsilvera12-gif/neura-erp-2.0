/**
 * Timeline del prospecto (crm_notas).
 *   GET  /api/crm/[id]/notas                    → Nota[] (más nuevas primero)
 *   POST /api/crm/[id]/notas { texto, tipo? }   → la nota creada
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { created, ok, ERR } from "@/lib/api/responses";
import { errorCrm, idProspecto, nombreUsuario } from "@/modules/crm/server";

export const dynamic = "force-dynamic";

const COLS = "id, tipo, texto, usuario_id, usuario_nombre, created_at";

export const GET = withTenant(async (ctx, req) => {
  const id = idProspecto(req);
  if (!id) return ERR.notFound("Prospecto");
  const { data, error } = await ctx.db.select("crm_notas", COLS).eq("prospecto_id", id).order("created_at", { ascending: false }).limit(300);
  if (error) return ERR.server();
  return ok(data ?? []);
});

const nota = z.object({
  texto: z.string().trim().min(1, "Escribí la nota").max(4000),
  tipo: z.enum(["nota", "llamada", "whatsapp", "email", "reunion"]).default("nota"),
});

export const POST = withTenant(
  async (ctx, req, input) => {
    const id = idProspecto(req);
    if (!id) return ERR.notFound("Prospecto");
    const [p, nombre] = await Promise.all([ctx.db.select("crm_prospectos", "id").eq("id", id).limit(1), nombreUsuario(ctx)]);
    if (p.error) return ERR.server();
    if (!p.data?.length) return ERR.notFound("Prospecto");
    const { data, error } = await ctx.db.insert("crm_notas", {
      prospecto_id: id,
      tipo: input.tipo,
      texto: input.texto,
      usuario_id: ctx.usuarioId,
      usuario_nombre: nombre,
    });
    if (error) return errorCrm(error, "No se pudo guardar la nota");
    const f = (data?.[0] ?? null) as Record<string, unknown> | null;
    return created(f && { id: f.id, tipo: f.tipo, texto: f.texto, usuario_id: f.usuario_id, usuario_nombre: f.usuario_nombre, created_at: f.created_at });
  },
  { body: nota },
);
