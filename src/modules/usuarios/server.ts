/**
 * Lógica de servidor de Configuración › Usuarios (las rutas solo la llaman).
 * Escrituras de usuarios / perfiles: SIEMPRE por las funciones admin_* de la base (receta 55),
 * con la sesión del admin (validan nivel ADMIN + "administrar usuarios" y dejan historial).
 * Cuentas de acceso (invitación, links): src/lib/usuarios/cuentas.ts (service role).
 */
import type { NextRequest } from "next/server";
import type { TenantContext } from "@/lib/api/with-tenant";
import { ERR, created, fail, ok } from "@/lib/api/responses";
import { invalidarSesiones } from "@/lib/api/resolve-session";
import { borrarCuentaNueva, buscarCuenta, enviarRestablecer, generarLink, infoCuenta, invitarPorEmail, urlBase } from "@/lib/usuarios/cuentas";
import type { CrearUsuario } from "@/modules/usuarios/esquemas";

export function falloRpc(error: { message: string; code?: string }) {
  const msg = error.message.replace(/^.*?ERROR:\s*/, "");
  if (RE_LIMITE.test(msg)) return fail(msg, 409, "limite_usuarios");
  return fail(msg, error.code === "42501" || /^Sin permiso|^Tu perfil no/i.test(msg) ? 403 : 400);
}

/** Mensaje del límite de usuarios del plan (receta 76: trigger tg_usuarios_cupo). */
const RE_LIMITE = /l[ií]mite de \d+ usuarios/i;
const mensajeLimite = (limite: number) =>
  `Llegaste al límite de ${limite} usuarios de tu plan. Para sumar más, hablá con el soporte de Neura.`;

type Cupo = { limite: number; usados: number; disponibles: number; excedido: boolean };

/**
 * Antes de crear la cuenta de acceso o mandar la invitación: si el cupo está lleno se corta acá
 * (no quedan cuentas sueltas ni emails mandados). La base lo vuelve a controlar con bloqueo por
 * empresa al insertar (trigger), así que dos altas a la vez no pasan las dos.
 */
async function cupoLleno(ctx: TenantContext) {
  const { data, error } = await ctx.db.rpc<Cupo>("usuarios_cupo");
  if (error) return falloRpc(error);
  if (data && data.disponibles <= 0) return fail(mensajeLimite(data.limite), 409, "limite_usuarios");
  return null;
}

/** Además del permiso, nivel ADMIN (la base lo exige igual; esto corta antes de tocar auth). */
export function soloAdmin(ctx: TenantContext) {
  return ctx.rol === "ADMIN" ? null : ERR.forbidden();
}

/** Después de cambiar usuarios / perfiles: las sesiones cacheadas se vuelven a leer. */
export function cambioDeAcceso() {
  invalidarSesiones();
}

type Alta = { id: string };

async function altaEnBase(ctx: TenantContext, input: CrearUsuario, authUserId: string, origen: "invitado" | "vinculado") {
  return ctx.db.rpc<Alta>("admin_crear_usuario", {
    p: {
      auth_user_id: authUserId,
      email: input.email,
      nombres: input.nombres,
      apellidos: input.apellidos,
      ci: input.ci,
      telefono: input.telefono,
      perfil_id: input.perfil_id,
      sucursal_id: input.sucursal_id,
      es_tecnico: input.es_tecnico ?? false,
      es_qa: input.es_qa ?? false,
      usa_soporte: input.usa_soporte ?? false,
      origen,
    },
  });
}

/**
 * Alta de un usuario:
 *   · el email ya es usuario de este sistema → error claro
 *   · el email ya tiene cuenta (otro cliente del mismo servidor de auth) → se avisa
 *     ({ estado: "existe" }); con vincular=true se lo suma a la empresa sin tocar su cuenta
 *   · si no → se crea la cuenta por invitación (email) o con un link para copiar (WhatsApp)
 */
export async function crearUsuario(ctx: TenantContext, req: NextRequest, input: CrearUsuario) {
  const corte = soloAdmin(ctx);
  if (corte) return corte;

  // El perfil y la sucursal se validan ANTES de crear la cuenta (no dejar cuentas sueltas).
  const { data: pf } = await ctx.db.select("perfiles", "id").eq("id", input.perfil_id).maybeSingle();
  if (!pf) return fail("Elegí el perfil", 422);
  const lleno = await cupoLleno(ctx);
  if (lleno) return lleno;

  const existente = await buscarCuenta(input.email);
  if (existente?.usuario) {
    return fail(
      existente.usuario.empresa_id === ctx.empresaId
        ? "Ese email ya es usuario de esta empresa: buscalo en el listado"
        : "Ese email ya es usuario de otra empresa de este sistema",
      409,
    );
  }

  const nombre = [input.nombres, input.apellidos].filter(Boolean).join(" ");
  if (existente) {
    if (!input.vincular) {
      // No se cambia nada: el admin decide si lo vincula.
      return ok({ estado: "existe" as const, email: existente.email ?? input.email });
    }
    const { data, error } = await altaEnBase(ctx, input, existente.auth_user_id!, "vinculado");
    if (error || !data) return error ? falloRpc(error) : ERR.server();
    cambioDeAcceso();
    return created({ estado: "vinculado" as const, id: data.id });
  }

  const base = urlBase(req);
  let authUserId: string;
  let link: string | null = null;
  try {
    if (input.modo === "link") {
      const r = await generarLink("invite", input.email, base, nombre);
      authUserId = r.authUserId;
      link = r.link;
    } else {
      authUserId = (await invitarPorEmail(input.email, `${base}/bienvenida`, nombre)).authUserId;
    }
  } catch (e) {
    // Si la cuenta llegó a crearse (el mail falló después), se borra: antes no existía.
    const quedo = await buscarCuenta(input.email).catch(() => null);
    if (quedo?.auth_user_id && !quedo.usuario) await borrarCuentaNueva(quedo.auth_user_id);
    return fail((e as Error).message, 502);
  }

  const { data, error } = await altaEnBase(ctx, input, authUserId, "invitado");
  if (error || !data) {
    await borrarCuentaNueva(authUserId);
    return error ? falloRpc(error) : ERR.server();
  }
  await ctx.db.rpc("admin_registrar_accion_usuario", {
    p_id: data.id,
    p_accion: link ? "link_invitacion" : "invitacion_enviada",
    p_detalle: {},
  });
  cambioDeAcceso();
  return created({ estado: link ? ("link" as const) : ("invitado" as const), id: data.id, link });
}

/**
 * Acceso de un usuario existente:
 *   enviar_invitacion / link_invitacion   invitación pendiente (nunca entró), cuenta creada acá
 *   enviar_restablecer                     email a su dueño para poner otra contraseña
 *   link_restablecer                       link para copiar (solo cuentas creadas acá)
 */
export async function accesoUsuario(
  ctx: TenantContext,
  req: NextRequest,
  usuarioId: string,
  accion: "enviar_invitacion" | "link_invitacion" | "enviar_restablecer" | "link_restablecer",
) {
  const corte = soloAdmin(ctx);
  if (corte) return corte;
  // La base valida que quien pide administre usuarios (y deja el historial) ANTES de tocar auth.
  const permiso = await ctx.db.rpc("admin_historial", { p_usuario: usuarioId, p_perfil: null, p_limite: 1 });
  if (permiso.error) return falloRpc(permiso.error);

  const info = await infoCuenta(usuarioId, ctx.empresaId);
  if (!info) return ERR.notFound("Usuario");
  if (!info.existe || !info.email) return fail("Este usuario no tiene una cuenta de acceso", 409);
  if (!info.activo) return fail("El usuario está desactivado: activalo primero", 409);
  const pendiente = !info.ultimo_ingreso;
  const propia = info.origen === "invitado";
  const base = urlBase(req);

  try {
    let link: string | null = null;
    let registro: string;
    if (accion === "enviar_invitacion" || accion === "link_invitacion") {
      if (!pendiente) return fail("Ya entró al sistema: mandale un link para restablecer la contraseña", 409);
      if (!propia) return fail("La cuenta la usa otro sistema: solo se le puede mandar el email para restablecer la contraseña", 409);
      if (accion === "enviar_invitacion") {
        await invitarPorEmail(info.email, `${base}/bienvenida`, info.nombre ?? "");
        registro = "invitacion_enviada";
      } else {
        // Ya confirmó el email (abrió el link) pero nunca terminó: va un link de restablecer.
        link = (await generarLink(info.confirmado ? "recovery" : "invite", info.email, base, info.nombre)).link;
        registro = "link_invitacion";
      }
    } else if (accion === "enviar_restablecer") {
      try {
        await enviarRestablecer(info.email, base);
      } catch (e) {
        // Cuenta compartida: no hay link para copiar; que la restablezca desde el otro sistema.
        if (!propia) throw new Error("No se pudo mandar el email (el correo del servidor no está configurado). Como la cuenta también se usa en otro sistema, la persona puede cambiar su contraseña desde allá.");
        throw e;
      }
      registro = "restablecer_enviado";
    } else {
      if (!propia) return fail("La cuenta la usa otro sistema: por seguridad el link le llega solo a su email", 409);
      link = (await generarLink("recovery", info.email, base)).link;
      registro = "link_restablecer";
    }
    await ctx.db.rpc("admin_registrar_accion_usuario", { p_id: usuarioId, p_accion: registro, p_detalle: {} });
    return ok({ accion, link, email: info.email });
  } catch (e) {
    return fail((e as Error).message, 502);
  }
}
