import type { Modulo } from "@/modules/types";

/**
 * Configuración: un solo ítem del menú que abre /configuracion, un panel con una tarjeta por
 * sub-módulo (como Inventario):
 *   · Datos de la empresa: identificación fiscal y contacto que salen en todos los documentos.
 *   · Facturación: modo, impresión, numeración, condiciones de pago y SIFEN.
 *   · Usuarios: usuarios, perfiles, pantallas y permisos.
 * Las pantallas (hrefs) son las mismas de antes, así los perfiles guardados siguen valiendo.
 * Solo nivel ADMIN; cada sub-pantalla pide su permiso: "Configuración del sistema" o, para
 * Usuarios, "Administrar usuarios" (el Administrador los tiene siempre).
 */
export const moduloConfiguracion: Modulo = {
  id: "configuracion",
  label: "Configuración",
  href: "/configuracion",
  panel: true,
  icon: "settings",
  familia: "Configuración",
  roles: ["ADMIN"],
  children: [
    { label: "Datos de la empresa", href: "/configuracion/empresa", permiso: "configuracion" },
    { label: "Facturación", href: "/configuracion/facturacion", permiso: "configuracion" },
    { label: "Mesas y QR", href: "/configuracion/mesas", permiso: "configuracion" },
    { label: "Usuarios", href: "/configuracion/usuarios", permiso: "administrar_usuarios" },
  ],
};
