import type { Modulo } from "@/modules/types";

/**
 * Manifiesto del módulo Reportes (familia propia en el menú, como Ferretería República).
 * Un solo ítem, sin submenú: abre /reportes, que lista los reportes disponibles
 * (src/modules/reportes/catalogo.ts).
 */
export const moduloReportes: Modulo = {
  id: "reportes",
  label: "Reportes",
  href: "/reportes",
  icon: "chart",
  familia: "Reportes",
  roles: ["ADMIN"],
};
