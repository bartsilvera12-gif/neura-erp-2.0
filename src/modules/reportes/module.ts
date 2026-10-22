import type { Modulo } from "@/modules/types";

/**
 * Manifiesto del módulo Reportes (familia Finanzas). Un solo ítem, sin submenú: abre
 * /reportes, que lista los reportes por sección (src/modules/reportes/catalogo.ts).
 * ADMIN ve todos; SUPERVISOR solo el cierre de caja de su sucursal.
 */
export const moduloReportes: Modulo = {
  id: "reportes",
  label: "Reportes",
  href: "/reportes",
  grupo: "finanzas",
  icon: "chart",
  familia: "Finanzas",
  roles: ["ADMIN", "SUPERVISOR"],
};
