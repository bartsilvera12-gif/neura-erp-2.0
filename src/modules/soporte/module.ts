import type { Modulo } from "@/modules/types";

/**
 * Soporte: tickets de los clientes (copia fiel del sistema actual). Los tickets nacen
 * de la Tipificación del cliente; acá se trabajan, se revisan (QA opcional) y se miden.
 * Lo usan ADMIN y quien tenga usuarios.usa_soporte (lo controla el layout del módulo y
 * cada API); la Configuración, solo ADMIN.
 *
 * El ítem del menú abre /soporte/panel (tarjetas con foto, una por sub-pantalla; también bajo el
 * layout de /soporte, así que pide el mismo acceso). Las sub-pantallas no se mueven (Dashboard
 * sigue en /soporte), así los perfiles guardados y los links siguen valiendo.
 */
export const moduloSoporte: Modulo = {
  id: "soporte",
  label: "Soporte",
  href: "/soporte/panel",
  panel: true,
  icon: "lifebuoy",
  familia: "Soporte",
  children: [
    { label: "Dashboard", href: "/soporte" },
    { label: "Tickets", href: "/soporte/tickets" },
    { label: "Mis tickets", href: "/soporte/mis-tickets" },
    { label: "Configuración", href: "/soporte/configuracion" },
  ],
};
