import type { Modulo } from "@/modules/types";

/**
 * Ítems del menú que en el sistema actual (sistemas-propio) van sueltos, sin submenú:
 * Gestión Clientes, Planes y Agenda en "Comercial"; Cobranzas en "Finanzas".
 * Son pantallas del módulo Clientes, pero cada una es un ítem propio del sidebar.
 */
export const moduloGestionClientes: Modulo = {
  id: "gestion-clientes",
  label: "Gestión Clientes",
  href: "/clientes/gestion",
  icon: "user-search",
  familia: "Comercial",
};

export const moduloPlanes: Modulo = {
  id: "planes",
  label: "Planes",
  href: "/clientes/suscripciones",
  icon: "file",
  familia: "Comercial",
};

export const moduloAgenda: Modulo = {
  id: "agenda",
  label: "Agenda",
  href: "/clientes/agenda",
  icon: "calendar",
  familia: "Comercial",
};

export const moduloCobranzas: Modulo = {
  id: "cobranzas",
  label: "Cobranzas",
  href: "/clientes/cobrar",
  icon: "coins",
  familia: "Finanzas",
};
