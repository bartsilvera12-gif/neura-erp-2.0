import type { Modulo } from "@/modules/types";

/** Clientes: el maestro, su cuenta corriente, las suscripciones (cuotas mensuales) y las cuentas a cobrar. */
export const moduloClientes: Modulo = {
  id: "clientes",
  label: "Clientes",
  href: "/clientes",
  icon: "users",
  familia: "Comercial",
  children: [
    { label: "Clientes", href: "/clientes" },
    { label: "Suscripciones", href: "/clientes/suscripciones" },
    { label: "Cuentas a cobrar", href: "/clientes/cobrar" },
  ],
};
