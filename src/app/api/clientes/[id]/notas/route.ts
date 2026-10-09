/**
 * Notas internas del cliente (con autor y fecha).
 *   GET    /api/clientes/[id]/notas               → [{ id, texto, usuario_id, usuario_nombre, created_at }]
 *   POST   /api/clientes/[id]/notas  { texto }    → la nota creada
 *   DELETE /api/clientes/[id]/notas?nota_id=…     → borra una nota propia (ADMIN: cualquiera)
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok, created, noContent, fail, ERR } from "@/lib/api/responses";

function clienteId(req: { url: string }): string | null {
  const segs = new URL(req.url).pathname.split("/").filter(Boolean);
  const i = segs.indexOf("clientes");
  return i >= 0 ? (segs[i + 1] ?? null) : null;
}

const COLS = "id, texto, usuario_id, usuario_nombre, created_at";

export const GET = withTenant(async (ctx, req) => {
  const id = clienteId(req);
  if (!id) return ERR.invalid("Falta el id del cliente");
  const { data, error } = await ctx.db
    .select("cliente_notas", COLS)
    .eq("cliente_id", id)
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) return ERR.server();
  return ok(data ?? []);
});

const nota = z.object({ texto: z.string().trim().min(1, "Escribí la nota").max(4000) });

export const POST = withTenant(
  async (ctx, req, input) => {
    const id = clienteId(req);
    if (!id) return ERR.invalid("Falta el id del cliente");
    const [cli, yo] = await Promise.all([
      ctx.db.select("clientes", "id").eq("id", id).is("deleted_at", null).limit(1),
      ctx.db.select("usuarios", "nombre").eq("id", ctx.usuarioId).limit(1),
    ]);
    if (cli.error || yo.error) return ERR.server();
    if (!cli.data?.length) return ERR.notFound("Cliente");
    const nombre = (yo.data?.[0] as unknown as { nombre?: string } | undefined)?.nombre ?? ctx.user.email ?? null;
    const { data, error } = await ctx.db.insert("cliente_notas", {
      cliente_id: id,
      texto: input.texto,
      usuario_id: ctx.usuarioId,
      usuario_nombre: nombre,
    });
    if (error) return ERR.server();
    const f = (data?.[0] ?? null) as Record<string, unknown> | null;
    return created(f && { id: f.id, texto: f.texto, usuario_id: f.usuario_id, usuario_nombre: f.usuario_nombre, created_at: f.created_at });
  },
  { body: nota },
);

export const DELETE = withTenant(async (ctx, req) => {
  const id = clienteId(req);
  const notaId = new URL(req.url).searchParams.get("nota_id");
  if (!id || !notaId) return ERR.invalid("Falta la nota");
  let q = ctx.db.delete("cliente_notas").eq("id", notaId).eq("cliente_id", id);
  if (ctx.rol !== "ADMIN") q = q.eq("usuario_id", ctx.usuarioId);
  const { data, error } = await q.select("id");
  if (error) return ERR.server();
  if (!data?.length) return fail("Solo podés borrar tus propias notas.", 403);
  return noContent();
});
