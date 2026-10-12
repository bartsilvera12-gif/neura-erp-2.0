/**
 * Comentarios del proyecto, en dos canales (interno / cliente). Se piden recién al abrir
 * la pestaña.
 *   GET  /api/proyectos/[id]/comentarios → Comentario[] (más viejos primero, los dos canales)
 *   POST /api/proyectos/[id]/comentarios { canal, contenido, menciones?: uuid[] } → Comentario
 *        Cada @mencionado recibe un aviso en la campanita. Los adjuntos se suben después
 *        (archivos/firmar + archivos con comentario_id) y quedan también en Archivos.
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { created, ok, fail, ERR } from "@/lib/api/responses";
import { avisarUsuarios, errorProy, idTras, nombreActor, nombresUsuarios, proyectoBase, tocarProyecto, usuariosValidos } from "@/modules/proyectos/server";
import { CANALES, CANAL_LABEL, type Adjunto, type Canal, type Comentario } from "@/modules/proyectos/tipos";

export const dynamic = "force-dynamic";

const COLS = "id, canal, contenido, menciones, adjuntos, usuario_id, editado_at, created_at";
type Fila = Omit<Comentario, "usuario_nombre">;

export const GET = withTenant(async (ctx, req) => {
  const id = idTras(req, "proyectos");
  if (!id) return ERR.notFound("Proyecto");
  const { data, error } = await ctx.db.select("proyecto_comentarios", COLS).eq("proyecto_id", id).order("created_at", { ascending: false }).limit(500);
  if (error) return ERR.server();
  const filas = ((data ?? []) as unknown as Fila[]).reverse();
  const nombres = await nombresUsuarios(ctx, filas.map((c) => c.usuario_id));
  return ok(
    filas.map((c) => ({
      ...c,
      menciones: c.menciones ?? [],
      adjuntos: Array.isArray(c.adjuntos) ? (c.adjuntos as Adjunto[]) : [],
      usuario_nombre: c.usuario_id ? (nombres.get(c.usuario_id) ?? null) : null,
    })),
  );
});

const crear = z.object({
  canal: z.enum(CANALES).default("interno"),
  contenido: z.string().trim().min(1, "Escribí el comentario").max(8000),
  menciones: z.array(z.string().uuid()).max(30).optional(),
});

export const POST = withTenant(
  async (ctx, req, input) => {
    const id = idTras(req, "proyectos");
    if (!id) return ERR.notFound("Proyecto");
    const p = await proyectoBase(ctx, id);
    if (!p) return ERR.notFound("Proyecto");
    const menciones = [...new Set(input.menciones ?? [])];
    if (!(await usuariosValidos(ctx, menciones))) return fail("Mención inválida", 422);

    const { data, error } = await ctx.db.insert("proyecto_comentarios", {
      proyecto_id: id,
      canal: input.canal,
      contenido: input.contenido,
      menciones,
      usuario_id: ctx.usuarioId,
    });
    if (error) return errorProy(error, "No se pudo guardar el comentario");
    const c = data?.[0] as unknown as Fila | undefined;
    if (!c) return errorProy(null, "No se pudo guardar el comentario");
    const actor = await nombreActor(ctx);
    await Promise.all([
      avisarUsuarios(ctx, menciones, {
        proyectoId: id,
        titulo: `${actor} te mencionó en ${p.numero}`,
        cuerpo: `[${CANAL_LABEL[input.canal as Canal]}] ${input.contenido.slice(0, 300)}`,
      }),
      tocarProyecto(ctx, id),
    ]);
    return created({ ...c, menciones, adjuntos: [], usuario_nombre: actor } satisfies Comentario);
  },
  { body: crear },
);
