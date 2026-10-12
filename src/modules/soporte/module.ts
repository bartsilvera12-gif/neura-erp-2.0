import type { Modulo } from "@/modules/types";

/**
 * Soporte: tickets de los clientes (copia fiel del sistema actual). Los tickets nacen
 * de la Tipificación del cliente; acá se trabajan, se revisan (QA opcional) y se miden.
 * Lo usan ADMIN y quien tenga usuarios.usa_soporte (lo controla el layout del módulo y
 * cada API); la Configuración, solo ADMIN.
 */
export const moduloSoporte: Modulo = {
  id: "soporte",
  label: "Soporte",
  href: "/soporte",
  icon: "lifebuoy",
  familia: "Soporte",
  children: [
    { label: "Dashboard", href: "/soporte" },
    { label: "Tickets", href: "/soporte/tickets" },
    { label: "Mis tickets", href: "/soporte/mis-tickets" },
    { label: "Configuración", href: "/soporte/configuracion" },
  ],
};
