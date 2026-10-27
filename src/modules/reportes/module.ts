import type { Modulo } from "@/modules/types";
import { REPORTES } from "@/modules/reportes/catalogo";

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
  // Cada reporte, para que el buscador del menú lo encuentre ("existencias", "ventas por mes").
  // Mismos permisos que la lista de reportes (reportesPara).
  atajos: REPORTES.map((r) => ({
    label: r.titulo,
    href: r.href,
    seccion: `Reportes · ${r.seccion}`,
    permisos: r.roles?.includes("SUPERVISOR") ? ["ver_reportes_financieros", "ver_cierres_caja"] : ["ver_reportes_financieros"],
  })),
};
