import type { Modulo } from "@/modules/types";

/**
 * Ítems sueltos de "Finanzas" (sin submenú), igual que en el sistema actual:
 *   · Pagos → /pagos: registrar pagos de facturas pendientes de cobro (pestañas Pendientes /
 *     Cobrados). "Cobrar" manda la transferencia a Conciliación. Va después de Conciliación.
 *   · Gastos y Servicios → /gastos: documentos que no afectan inventario (alquiler,
 *     honorarios, servicios) con sus datos fiscales. Mismos roles que Compras.
 * Los pagos A PROVEEDORES (/compras/pagos) son un subítem de Compras ("Pagos a proveedores").
 */
export const moduloPagos: Modulo = {
  id: "pagos",
  label: "Pagos",
  href: "/pagos",
  icon: "banknote",
  familia: "Finanzas",
};

export const moduloGastos: Modulo = {
  id: "gastos",
  label: "Gastos y Servicios",
  href: "/gastos",
  icon: "receipt",
  familia: "Finanzas",
  roles: ["ADMIN"],
};
