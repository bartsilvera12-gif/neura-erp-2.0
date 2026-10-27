import type { Modulo } from "@/modules/types";

/** Clientes: el maestro, su cuenta corriente, las suscripciones (cuotas mensuales) y las cuentas a cobrar. */
export const moduloClientes: Modulo = {
  id: "clientes",
  label: "Clientes",
  href: "/clientes",
  grupo: "comercial",
  icon: "users",
  familia: "Comercial",
  // Sin submenú, como en el sistema actual: Gestión Clientes, Planes y Agenda son módulos
  // propios (modulos-comerciales.ts); Tipificaciones se configura desde Soporte › Configuración.
  // En el menú va dentro del ítem "Comercial" (grupo "comercial" → panel /comercial).
  atajos: [
    { label: "Tipificaciones", href: "/clientes/tipificaciones" },
    { label: "Cuentas a cobrar de clientes", href: "/clientes/cobrar" },
  ],
};
