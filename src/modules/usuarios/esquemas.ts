/**
 * Validación (zod) de Configuración › Usuarios. La base vuelve a validar todo (reglas de
 * último administrador, perfiles de sistema, permisos del catálogo…).
 */
import { z } from "zod";
import { TODOS_LOS_PERMISOS } from "@/modules/usuarios/permisos";

const texto = (max: number) => z.string().trim().max(max, `Máximo ${max} caracteres`);
const opcional = (max: number) => texto(max).nullish().transform((v) => (v ? v : null));

export const datosUsuario = z.object({
  nombres: texto(80).min(1, "Escribí el nombre"),
  apellidos: opcional(80),
  ci: opcional(20),
  telefono: opcional(40),
  perfil_id: z.string().uuid("Elegí el perfil"),
  sucursal_id: z.string().uuid().nullish().transform((v) => v ?? null),
  es_tecnico: z.boolean().optional(),
  es_qa: z.boolean().optional(),
  usa_soporte: z.boolean().optional(),
});

export const crearUsuario = datosUsuario.extend({
  email: z.string().trim().toLowerCase().email("Email inválido").max(160),
  /** email: GoTrue manda la invitación · link: se genera el link para copiarlo (WhatsApp) */
  modo: z.enum(["email", "link"]).default("email"),
  /** El email ya tenía cuenta (otro sistema): el admin confirmó vincularlo a esta empresa. */
  vincular: z.boolean().optional(),
});
export type CrearUsuario = z.infer<typeof crearUsuario>;

export const editarUsuario = z
  .object({
    nombres: texto(80).min(1, "Escribí el nombre"),
    apellidos: opcional(80),
    ci: opcional(20),
    telefono: opcional(40),
    perfil_id: z.string().uuid("Elegí el perfil"),
    sucursal_id: z.string().uuid().nullable(),
    activo: z.boolean(),
    es_tecnico: z.boolean(),
    es_qa: z.boolean(),
    usa_soporte: z.boolean(),
  })
  .partial();

export const accionAcceso = z.object({
  accion: z.enum(["enviar_invitacion", "link_invitacion", "enviar_restablecer", "link_restablecer"]),
});

export const guardarPerfil = z.object({
  id: z.string().uuid().nullish(),
  nombre: texto(60).min(1, "Escribí el nombre del perfil"),
  descripcion: opcional(300),
  nivel_base: z.enum(["ADMIN", "SUPERVISOR", "CAJERO", "VENDEDOR"]),
  alcance_sucursal: z.enum(["propia", "todas"]),
  tope_descuento_pct: z.number().min(0, "El tope va de 0 a 100").max(100, "El tope va de 0 a 100").nullish(),
  pantallas: z.array(z.string().regex(/^\/[a-z0-9/_-]{0,120}$/, "Pantalla inválida")).max(200),
  permisos: z.array(z.enum(TODOS_LOS_PERMISOS as [string, ...string[]])).max(100),
});
