import type { Modulo } from "@/modules/types";

/**
 * Configuración › Usuarios: el listado de usuarios (alta por invitación, perfil, sucursal,
 * activar / desactivar) y los perfiles con sus pantallas y permisos. Sin submenú: las dos
 * vistas son pestañas dentro de la pantalla. Solo nivel ADMIN con "Administrar usuarios".
 */
export const moduloUsuarios: Modulo = {
  id: "usuarios",
  label: "Usuarios",
  href: "/configuracion/usuarios",
  icon: "user-cog",
  familia: "Configuración",
  roles: ["ADMIN"],
  permiso: "administrar_usuarios",
};
