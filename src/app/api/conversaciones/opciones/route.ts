/**
 * Lo que la bandeja pide UNA vez (el navegador lo cachea): canales, equipo (para
 * transferir y filtrar por asesor), respuestas rápidas activas, plantillas y permisos.
 *   GET /api/conversaciones/opciones
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ok, ERR } from "@/lib/api/responses";
import { leerEquipo, puedeCargarSoporte } from "@/modules/tipificacion/server";
import { PLANTILLAS, type OpcionesBandeja, type RespuestaRapida } from "@/modules/conversaciones/dominio";

export const dynamic = "force-dynamic";

export const GET = withTenant(async (ctx) => {
  const [canales, eq, resp] = await Promise.all([
    ctx.db.select("chat_canales", "id, nombre, tipo, proveedor, activo").order("created_at"),
    leerEquipo(ctx.db, ctx.usuarioId),
    ctx.db.select("chat_respuestas_rapidas", "id, atajo, texto, orden, activo, canal_id").eq("activo", true).order("orden").order("atajo"),
  ]);
  if (canales.error || resp.error) return ERR.server();
  const out: OpcionesBandeja = {
    yo: ctx.usuarioId,
    es_admin: ctx.rol === "ADMIN",
    puede_soporte: puedeCargarSoporte(ctx.rol, eq.yo),
    canales: (canales.data ?? []) as unknown as OpcionesBandeja["canales"],
    equipo: eq.equipo,
    respuestas: (resp.data ?? []) as unknown as RespuestaRapida[],
    plantillas: PLANTILLAS,
  };
  return ok(out);
});
