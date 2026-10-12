import type { Modulo } from "@/modules/types";

/** Clientes: el maestro, su cuenta corriente, las suscripciones (cuotas mensuales) y las cuentas a cobrar. */
export const moduloClientes: Modulo = {
  id: "clientes",
  label: "Clientes",
  href: "/clientes",
  icon: "users",
  familia: "Comercial",
  // Sin submenú, como en el sistema actual: Gestión Clientes, Planes, Agenda y Cobranzas
  // son ítems propios del menú (modulos-comerciales.ts); Tipificaciones se configura
  // desde Soporte › Configuración.
};
