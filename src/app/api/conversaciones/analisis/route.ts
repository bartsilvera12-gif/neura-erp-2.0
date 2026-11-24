/**
 * Análisis de conversaciones (solo ADMIN, receta 174). SOLO LEE los chats: no manda mensajes.
 *   GET  → últimos informes
 *   POST { dias: 7 | 30 | 90 } → arranca un informe ("procesando") y lo corre en segundo plano
 */
import { after } from "next/server";
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { created, fail, ok } from "@/lib/api/responses";
import { systemClient } from "@/lib/supabase/clients";
import { correrAnalisis } from "@/lib/conversaciones/analisis";

export const dynamic = "force-dynamic";
export const maxDuration = 600;
const COLS = "id, desde, hasta, estado, conversaciones, mensajes, resultado, aplicadas, costo_usd, error, creado_at, terminado_at";

export const GET = withTenant(async (ctx) => {
  const { data, error } = await systemClient().from("chat_analisis").select(COLS).eq("empresa_id", ctx.empresaId).order("creado_at", { ascending: false }).limit(20);
  if (error) return fail(/does not exist|schema cache/i.test(error.message) ? "Falta aplicar la receta 174 en la base" : "No se pudieron leer los informes", 500);
  return ok({ informes: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
}, { roles: ["ADMIN"] });

export const POST = withTenant(async (ctx, _req, b) => {
  const db = systemClient();
  // Uno a la vez por empresa (cada informe gasta saldo de Claude).
  const { data: corriendo } = await db
    .from("chat_analisis")
    .select("id")
    .eq("empresa_id", ctx.empresaId)
    .eq("estado", "procesando")
    .gte("creado_at", new Date(Date.now() - 15 * 60_000).toISOString())
    .limit(1);
  if (corriendo?.length) return fail("Ya hay un análisis en curso: esperá a que termine", 409);
  const hasta = new Date();
  const desde = new Date(hasta.getTime() - b.dias * 86_400_000);
  const { data, error } = await db
    .from("chat_analisis")
    .insert({ empresa_id: ctx.empresaId, desde: desde.toISOString(), hasta: hasta.toISOString(), creado_por: ctx.usuarioId })
    .select(COLS)
    .single();
  if (error || !data) return fail("No se pudo crear el análisis", 500);
  after(() => correrAnalisis((data as { id: string }).id));
  return created(data);
}, { roles: ["ADMIN"], body: z.object({ dias: z.union([z.literal(7), z.literal(30), z.literal(90)]) }) });
