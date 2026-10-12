/**
 * Un comentario del proyecto.
 *   PATCH  /api/proyectos/[id]/comentarios/[comentarioId] { contenido, menciones? } → Comentario (solo su autor)
 *          A los NUEVOS mencionados les llega el aviso.
 *   DELETE /api/proyectos/[id]/comentarios/[comentarioId] (su autor o ADMIN)
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, noContent, fail, ERR } from "@/lib/api/responses";
import { avisarUsuarios, errorProy, idTras, nombreActor, proyectoBase, usuariosValidos } from "@/modules/proyectos/server";
import { CANAL_LABEL, type Adjunto, type Canal, type Comentario } from "@/modules/proyectos/tipos";

export const dynamic = "force-dynamic";

const COLS = "id, canal, contenido, menciones, adjuntos, usuario_id, editado_at, created_at";
type Fila = Omit<Comentario, "usuario_nombre">;

const editar = z.object({
  contenido: z.string().trim().min(1, "Escribí el comentario").max(8000),
  menciones: z.array(z.string().uuid()).max(30).optional(),
});

export const PATCH = withTenant(
  async (ctx, req, input) => {
    const id = idTras(req, "proyectos");
    const cid = idTras(req, "comentarios");
    if (!id || !cid) return ERR.notFound("Comentario");
    const { data: actual } = await ctx.db.select("proyecto_comentarios", COLS).eq("proyecto_id", id).eq("id", cid).maybeSingle();
    const c = actual as unknown as Fila | null;
    if (!c) return ERR.notFound("Comentario");
    if (c.usuario_id !== ctx.usuarioId) return fail("Solo el autor puede editar el comentario.", 403);
    const menciones = [...new Set(input.menciones ?? c.menciones ?? [])];
    if (!(await usuariosValidos(ctx, menciones))) return fail("Mención inválida", 422);

    const { data, error } = await ctx.db
      .update("proyecto_comentarios", { contenido: input.contenido, menciones, editado_at: new Date().toISOString() })
      .eq("id", cid)
      .select(COLS);
    if (error) return errorProy(error, "No se pudo editar el comentario");
    const nuevo = data?.[0] as unknown as Fila | undefined;
    if (!nuevo) return ERR.notFound("Comentario");
    const nuevas = menciones.filter((m) => !(c.menciones ?? []).includes(m));
    const actor = await nombreActor(ctx);
    if (nuevas.length) {
      const p = await proyectoBase(ctx, id);
      await avisarUsuarios(ctx, nuevas, {
        proyectoId: id,
        titulo: `${actor} te mencionó en ${p?.numero ?? "un proyecto"}`,
        cuerpo: `[${CANAL_LABEL[nuevo.canal as Canal] ?? nuevo.canal}] ${input.contenido.slice(0, 300)}`,
      });
    }
    return ok({ ...nuevo, menciones, adjuntos: Array.isArray(nuevo.adjuntos) ? (nuevo.adjuntos as Adjunto[]) : [], usuario_nombre: actor } satisfies Comentario);
  },
  { body: editar },
);

export const DELETE = withTenant(async (ctx, req) => {
  const id = idTras(req, "proyectos");
  const cid = idTras(req, "comentarios");
  if (!id || !cid) return ERR.notFound("Comentario");
  let q = ctx.db.delete("proyecto_comentarios").eq("proyecto_id", id).eq("id", cid);
  if (ctx.rol !== "ADMIN") q = q.eq("usuario_id", ctx.usuarioId);
  const { data, error } = await q.select("id");
  if (error) return errorProy(error, "No se pudo eliminar el comentario");
  if (!data?.length) return fail("Solo el autor (o un administrador) puede eliminar el comentario.", 403);
  return noContent();
});
