/**
 * Acceso de un usuario: POST /api/configuracion/usuarios/[id]/acceso { accion }
 *   enviar_invitacion | link_invitacion   (invitación pendiente, cuenta creada acá)
 *   enviar_restablecer                     (email a su dueño)
 *   link_restablecer                       (link para copiar; solo cuentas creadas acá)
 * → { accion, link?, email }. El admin nunca ve ni escribe contraseñas.
 */
import { withTenant } from "@/lib/api/with-tenant";
import { ERR } from "@/lib/api/responses";
import { accionAcceso } from "@/modules/usuarios/esquemas";
import { accesoUsuario } from "@/modules/usuarios/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withTenant(
  async (ctx, req, input) => {
    const segs = new URL(req.url).pathname.split("/").filter(Boolean);
    const id = segs[segs.indexOf("usuarios") + 1];
    if (!/^[0-9a-f-]{36}$/i.test(id ?? "")) return ERR.invalid("Falta el id del usuario");
    return accesoUsuario(ctx, req, id, input.accion);
  },
  { permiso: "administrar_usuarios", body: accionAcceso },
);
