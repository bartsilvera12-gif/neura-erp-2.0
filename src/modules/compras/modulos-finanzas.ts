import type { Modulo } from "@/modules/types";

/**
 * Ítems sueltos de "Finanzas" (sin submenú), igual que en el sistema actual:
 *   · Pagos → /pagos: registrar pagos de facturas pendientes de cobro (pestañas Pendientes /
 *     Cobrados). "Cobrar" manda la transferencia a Conciliación. Va después de Conciliación.
 * "Gastos y Servicios" y "Compras" ahora viven juntos en Gastos empresariales (compras/module.ts).
 */
export const moduloPagos: Modulo = {
  id: "pagos",
  label: "Pagos",
  href: "/pagos",
  grupo: "finanzas",
  icon: "banknote",
  familia: "Finanzas",
};
