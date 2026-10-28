import type { Modulo } from "@/modules/types";

/**
 * Ítems del menú que en el sistema actual (sistemas-propio) van sueltos, sin submenú:
 * Gestión Clientes, Planes y Agenda en "Comercial". Son pantallas del módulo Clientes,
 * pero cada una es un módulo propio. (Cobranzas vive en modules/cobranzas.) En el menú van
 * dentro del ítem "Comercial" (grupo "comercial" → panel /comercial); las rutas no cambian.
 */
export const moduloGestionClientes: Modulo = {
  id: "gestion-clientes",
  label: "Gestión Clientes",
  palabras: ["consultas", "tipificar", "atencion al cliente"],
  href: "/clientes/gestion",
  grupo: "comercial",
  icon: "user-search",
  familia: "Comercial",
};

export const moduloPlanes: Modulo = {
  id: "planes",
  label: "Planes",
  palabras: ["suscripciones", "abonos", "planes mensuales"],
  href: "/clientes/suscripciones",
  grupo: "comercial",
  icon: "file",
  familia: "Comercial",
};

export const moduloAgenda: Modulo = {
  id: "agenda",
  label: "Agenda",
  href: "/clientes/agenda",
  grupo: "comercial",
  icon: "calendar",
  familia: "Comercial",
};
