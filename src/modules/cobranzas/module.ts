import type { Modulo } from "@/modules/types";

/**
 * Cobranzas, en "Finanzas" y sin submenú (como en el sistema actual):
 *   · Cobranzas → /cobranzas: Seguimiento (clientes con deuda, tramos, promesas). Desde ahí
 *     se llega a las Cuentas a cobrar de siempre (/clientes/cobrar, cobro en caja).
 *   · Conciliación → /cobranzas/conciliacion: transferencias que esperan aprobación. Va como
 *     ítem suelto para que el admin la tenga a mano (también llega desde la campanita).
 */
export const moduloCobranzas: Modulo = {
  id: "cobranzas",
  label: "Cobranzas",
  href: "/cobranzas",
  icon: "coins",
  familia: "Finanzas",
};

export const moduloConciliacion: Modulo = {
  id: "conciliacion",
  label: "Conciliación",
  href: "/cobranzas/conciliacion",
  icon: "scale",
  familia: "Finanzas",
};
