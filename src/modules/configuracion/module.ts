import type { Modulo } from "@/modules/types";

/**
 * Configuración (un solo ítem del menú con submenú):
 *   · Datos de la empresa: identificación fiscal y contacto que salen en todos los documentos.
 *   · Facturación: modo, impresión, numeración, condiciones de pago y SIFEN.
 * Las pantallas (hrefs) son las mismas de antes, así los perfiles guardados siguen valiendo.
 * Nivel ADMIN con el permiso "Configuración del sistema" (el Administrador lo tiene siempre).
 */
export const moduloConfiguracion: Modulo = {
  id: "configuracion",
  label: "Configuración",
  href: "/configuracion/empresa",
  icon: "settings",
  familia: "Configuración",
  roles: ["ADMIN"],
  permiso: "configuracion",
  children: [
    { label: "Datos de la empresa", href: "/configuracion/empresa" },
    { label: "Facturación", href: "/configuracion/facturacion" },
  ],
};
