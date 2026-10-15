import type { Modulo } from "@/modules/types";

/**
 * Ítems del menú de la familia "Omnicanal" que en el sistema actual (sistemas-propio) van
 * sueltos, sin submenú, después de Conversaciones: Finalizadas, Monitoreo e Historial
 * omnicanal. Son pantallas del módulo Conversaciones, cada una con su ítem propio.
 * Monitoreo: en el menú solo ADMIN; la página y la API también dejan entrar a los
 * supervisores de una cola (chat_cola_agentes.es_supervisor). Colas se configura desde
 * Monitoreo (no es ítem del menú).
 */
export const moduloFinalizadas: Modulo = {
  id: "conversaciones-finalizadas",
  label: "Finalizadas",
  href: "/conversaciones/finalizadas",
  icon: "list-checks",
  familia: "Omnicanal",
};

export const moduloMonitoreo: Modulo = {
  id: "monitoreo",
  label: "Monitoreo",
  href: "/conversaciones/monitoreo",
  icon: "activity",
  familia: "Omnicanal",
  roles: ["ADMIN"],
  accesoPropio: true,
};

export const moduloHistorialOmnicanal: Modulo = {
  id: "historial-omnicanal",
  label: "Historial omnicanal",
  href: "/conversaciones/historial",
  icon: "history",
  familia: "Omnicanal",
};
