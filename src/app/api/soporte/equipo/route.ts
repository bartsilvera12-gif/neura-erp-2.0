/**
 * Equipo de Soporte (pestaña "Equipo" de Configuración): los tildes de cada usuario.
 *   PATCH /api/soporte/equipo { usuario_id, es_tecnico?, es_qa?, usa_soporte? } (solo ADMIN)
 *
 * es_tecnico / es_qa: puede quedar a cargo de un ticket ("Tomar"); QA recibe las revisiones.
 * usa_soporte: entra al módulo sin ser ADMIN.
 * La tabla usuarios ya no se escribe directo (receta 55): va por usuario_flags_soporte, que
 * valida el permiso y deja el cambio en el historial de usuarios.
 */
import { z } from "zod";
import { withTenant } from "@/lib/api/with-tenant";
import { ok } from "@/lib/api/responses";
import { invalidarSesiones } from "@/lib/api/resolve-session";
import { falla, invalidarEquipo, personasDeEmpresa } from "@/modules/soporte/server";

const esquema = z.object({
  usuario_id: z.string().uuid("Usuario inválido"),
  es_tecnico: z.boolean().optional(),
  es_qa: z.boolean().optional(),
  usa_soporte: z.boolean().optional(),
});

export const PATCH = withTenant(
  async (ctx, _req, input) => {
    const patch: Record<string, boolean> = {};
    if (typeof input.es_tecnico === "boolean") patch.es_tecnico = input.es_tecnico;
    if (typeof input.es_qa === "boolean") patch.es_qa = input.es_qa;
    if (typeof input.usa_soporte === "boolean") patch.usa_soporte = input.usa_soporte;
    if (Object.keys(patch).length === 0) return falla("Nada para actualizar");
    const { error } = await ctx.db.rpc("usuario_flags_soporte", { p_usuario: input.usuario_id, p: patch });
    if (error) {
      const msg = error.message.replace(/^.*?ERROR:\s*/, "");
      return falla(/no encontrado/i.test(msg) ? "Usuario no encontrado" : msg || "No se pudo guardar el cambio", /no encontrado/i.test(msg) ? 404 : 400);
    }
    invalidarEquipo(ctx);
    invalidarSesiones();
    return ok(await personasDeEmpresa(ctx));
  },
  { roles: ["ADMIN"], body: esquema },
);
