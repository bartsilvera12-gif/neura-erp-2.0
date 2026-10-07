import type { Modulo } from "@/modules/types";
import { REPORTES } from "./catalogo";

/** Manifiesto del módulo Reportes (familia propia en el menú, como Ferretería República). */
export const moduloReportes: Modulo = {
  id: "reportes",
  label: "Reportes",
  href: "/reportes",
  icon: "chart",
  familia: "Reportes",
  roles: ["ADMIN"],
  children: [{ label: "Todos los reportes", href: "/reportes" }, ...REPORTES.map((r) => ({ label: r.menu, href: r.href }))],
};
