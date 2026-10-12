import type { Modulo } from "@/modules/types";

/**
 * Conversaciones: bandeja omnicanal (WhatsApp y, más adelante, IG/Messenger). Lista con
 * pestañas Mías / Sin asignar / Todas / Cerradas, chat en vivo, notas internas, etiquetas,
 * respuestas rápidas, plantillas (fuera de las 24 h), transferir y finalizar con tipificación.
 * Sin submenú. Colas con asignación automática y SLA (38_conversaciones_colas.sql); Finalizadas,
 * Monitoreo e Historial omnicanal son ítems sueltos de la familia (modulos-omnicanal.ts).
 */
export const moduloConversaciones: Modulo = {
  id: "conversaciones",
  label: "Conversaciones",
  href: "/conversaciones",
  icon: "messages",
  familia: "Omnicanal",
};
