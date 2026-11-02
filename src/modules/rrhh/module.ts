import type { Modulo } from "@/modules/types";

// Receta 118: los salarios los ve solo el nivel Administrador con el permiso administrar_rrhh.
export const moduloRrhh: Modulo = {
  id: "rrhh",
  label: "RR HH",
  palabras: ["recursos humanos", "personal", "empleados", "legajo", "salario", "sueldo", "ausencias", "vacaciones", "aguinaldo", "liquidacion", "ips"],
  href: "/rrhh",
  icon: "id-card",
  familia: "Administración",
  roles: ["ADMIN"],
  permiso: "administrar_rrhh",
  children: [
    { label: "Personal", href: "/rrhh" },
    { label: "Liquidaciones", href: "/rrhh/liquidaciones" },
  ],
};
