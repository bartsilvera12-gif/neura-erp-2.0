/**
 * Flujos del bot vendedor (solo ADMIN, receta 173).
 *   GET  → { flujos, activo_id } (sin flujos guardados el bot sigue el flujo de fábrica)
 *   POST { nombre, estilo, nodos, conexiones } → crea un flujo (apagado)
 */
import { withTenant } from "@/lib/api/with-tenant";
import { created, fail, ok } from "@/lib/api/responses";
import { systemClient } from "@/lib/supabase/clients";
import { esquemaFlujo } from "@/lib/bot-vendedor/flujo-schema";

export const dynamic = "force-dynamic";
const COLS = "id, nombre, estilo, activo, nodos, conexiones, updated_at";

export const GET = withTenant(async (ctx) => {
  const { data, error } = await systemClient().from("bot_vendedor_flujos").select(COLS).eq("empresa_id", ctx.empresaId).order("created_at");
  if (error) {
    console.error("[bot-vendedor/flujos]", error.message);
    return fail(/does not exist|schema cache/i.test(error.message) ? "Falta aplicar la receta 173 en la base" : "No se pudieron leer los flujos", 500);
  }
  return ok({ flujos: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
}, { roles: ["ADMIN"] });

export const POST = withTenant(async (ctx, _req, b) => {
  const { count } = await systemClient().from("bot_vendedor_flujos").select("id", { count: "exact", head: true }).eq("empresa_id", ctx.empresaId);
  if ((count ?? 0) >= 20) return fail("Máximo 20 flujos: borrá alguno que no uses", 422, "invalid_input");
  const { data, error } = await systemClient()
    .from("bot_vendedor_flujos")
    .insert({ ...b, empresa_id: ctx.empresaId, activo: false, updated_by: ctx.usuarioId })
    .select(COLS)
    .single();
  if (error || !data) return fail("No se pudo crear el flujo", 500);
  return created(data);
}, { roles: ["ADMIN"], body: esquemaFlujo });
