/**
 * Ficha de una persona (receta 118).
 *   GET   → datos, ausencias, vacaciones, liquidaciones e historial
 *   PUT   → guarda el legajo
 *   POST  → { accion: ausencia | anular_ausencia | vacacion | anular_vacacion | nota }
 */
import type { NextRequest } from "next/server";
import { withTenant } from "@/lib/api/with-tenant";
import { ERR, ok } from "@/lib/api/responses";
import { invalidarSesiones } from "@/lib/api/resolve-session";
import { errorDb } from "@/modules/clientes/suscripciones/server";
import { accionFicha, guardarLegajo } from "@/modules/rrhh/esquemas";

function idDe(req: NextRequest) {
  const segs = new URL(req.url).pathname.split("/").filter(Boolean);
  const id = segs[segs.indexOf("rrhh") + 1];
  return /^[0-9a-f-]{36}$/i.test(id ?? "") ? id : null;
}

export const GET = withTenant(async (ctx, req) => {
  const id = idDe(req);
  if (!id) return ERR.invalid("Falta el id");
  const { data, error } = await ctx.db.rpc("rrhh_ficha", { p_usuario: id });
  if (error) return errorDb(error, "No se pudo leer la ficha");
  return ok(data);
}, { permiso: "administrar_rrhh" });

export const PUT = withTenant(async (ctx, req, input) => {
  const id = idDe(req);
  if (!id) return ERR.invalid("Falta el id");
  // Primero el acceso: si sus reglas lo rechazan, no se guarda nada.
  const { acceso, ...legajo } = input;
  if (acceso) {
    if (!ctx.puede("administrar_usuarios")) return ERR.forbidden();
    const r = await ctx.db.rpc("admin_actualizar_usuario", { p_id: id, p: acceso });
    if (r.error) return errorDb(r.error, "No se pudo cambiar el perfil o la sucursal");
    invalidarSesiones();
  }
  const { error } = await ctx.db.rpc("rrhh_guardar_legajo", { p_usuario: id, p: legajo });
  if (error) return errorDb(error, "No se pudo guardar");
  return ok({ guardado: true });
}, { permiso: "administrar_rrhh", body: guardarLegajo });

export const POST = withTenant(async (ctx, req, input) => {
  const id = idDe(req);
  if (!id) return ERR.invalid("Falta el id");
  const { accion, ...p } = input;
  const llamada =
    input.accion === "ausencia" ? ctx.db.rpc("rrhh_ausencia_guardar", { p_usuario: id, p })
    : input.accion === "anular_ausencia" ? ctx.db.rpc("rrhh_ausencia_anular", { p_id: input.id, p_motivo: input.motivo })
    : input.accion === "vacacion" ? ctx.db.rpc("rrhh_vacacion_guardar", { p_usuario: id, p })
    : input.accion === "anular_vacacion" ? ctx.db.rpc("rrhh_vacacion_anular", { p_id: input.id, p_motivo: input.motivo })
    : ctx.db.rpc("rrhh_nota_agregar", { p_usuario: id, p_tipo: input.tipo, p_texto: input.texto });
  const { error } = await llamada;
  if (error) return errorDb(error, "No se pudo guardar");
  return ok({ accion });
}, { permiso: "administrar_rrhh", body: accionFicha });
