/**
 * Un flujo del bot vendedor (solo ADMIN, receta 173).
 *   PUT    { nombre, estilo, nodos, conexiones } → guarda
 *   POST   { accion: "activar" | "desactivar" }  → el activo es el que sigue el bot (uno solo)
 *   DELETE → borra (el activo no: primero activá otro o desactivalo)
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { fail, ok } from "@/lib/api/responses";
import { systemClient } from "@/lib/supabase/clients";
import { esquemaFlujo } from "@/lib/bot-vendedor/flujo-schema";
import { UUID_RE, idDeRuta } from "@/modules/inventario/server/ids";

export const dynamic = "force-dynamic";
const COLS = "id, nombre, estilo, activo, nodos, conexiones, updated_at";
const idDe = (req: Request) => {
  const id = idDeRuta(req.url, "flujos");
  return id && UUID_RE.test(id) ? id : null;
};

export const PUT = withTenant(async (ctx, req, b) => {
  const id = idDe(req);
  if (!id) return fail("Flujo inválido", 400);
  const { data, error } = await systemClient()
    .from("bot_vendedor_flujos")
    .update({ ...b, updated_at: new Date().toISOString(), updated_by: ctx.usuarioId })
    .eq("id", id)
    .eq("empresa_id", ctx.empresaId)
    .select(COLS)
    .maybeSingle();
  if (error) return fail("No se pudo guardar el flujo", 500);
  if (!data) return fail("No existe ese flujo", 404);
  return ok(data);
}, { roles: ["ADMIN"], body: esquemaFlujo });

export const POST = withTenant(async (ctx, req, b) => {
  const id = idDe(req);
  if (!id) return fail("Flujo inválido", 400);
  const db = systemClient();
  const { data: existe } = await db.from("bot_vendedor_flujos").select("id").eq("id", id).eq("empresa_id", ctx.empresaId).maybeSingle();
  if (!existe) return fail("No existe ese flujo", 404);
  if (b.accion === "activar") {
    // Uno solo activo por empresa (índice único): primero se apaga el que estaba.
    const { error: e1 } = await db.from("bot_vendedor_flujos").update({ activo: false }).eq("empresa_id", ctx.empresaId).eq("activo", true).neq("id", id);
    if (e1) return fail("No se pudo cambiar el flujo activo", 500);
  }
  const { error } = await db.from("bot_vendedor_flujos").update({ activo: b.accion === "activar", updated_at: new Date().toISOString(), updated_by: ctx.usuarioId }).eq("id", id);
  if (error) return fail("No se pudo cambiar el flujo activo", 500);
  const { data } = await db.from("bot_vendedor_flujos").select(COLS).eq("empresa_id", ctx.empresaId).order("created_at");
  return ok({ flujos: data ?? [] });
}, { roles: ["ADMIN"], body: z.object({ accion: z.enum(["activar", "desactivar"]) }) });

export const DELETE = withTenant(async (ctx, req) => {
  const id = idDe(req);
  if (!id) return fail("Flujo inválido", 400);
  const db = systemClient();
  const { data } = await db.from("bot_vendedor_flujos").select("activo").eq("id", id).eq("empresa_id", ctx.empresaId).maybeSingle();
  if (!data) return fail("No existe ese flujo", 404);
  if ((data as { activo: boolean }).activo) return fail("Es el flujo que usa el bot: activá otro antes de borrarlo", 409);
  const { error } = await db.from("bot_vendedor_flujos").delete().eq("id", id).eq("empresa_id", ctx.empresaId);
  if (error) return fail("No se pudo borrar el flujo", 500);
  return ok({ borrado: id });
}, { roles: ["ADMIN"] });
