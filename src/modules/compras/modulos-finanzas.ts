import type { Modulo } from "@/modules/types";

/**
 * Ítem suelto del menú (sin submenú), igual que en el sistema actual: "Pagos" en
 * "Finanzas", justo después de Cobranzas. Es la pantalla de cuentas a pagar del módulo
 * Compras (/compras/pagos), pero va como ítem propio del sidebar. Mismos roles que Compras.
 */
export const moduloPagos: Modulo = {
  id: "pagos",
  label: "Pagos",
  href: "/compras/pagos",
  icon: "banknote",
  familia: "Finanzas",
  roles: ["ADMIN"],
};
