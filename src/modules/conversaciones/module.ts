import type { Modulo } from "@/modules/types";

/**
 * Conversaciones: bandeja omnicanal (WhatsApp y, más adelante, IG/Messenger). Lista con
 * pestañas Mías / Sin asignar / Todas / Cerradas, chat en vivo, notas internas, etiquetas,
 * respuestas rápidas, plantillas (fuera de las 24 h), transferir y finalizar con tipificación.
 * Sin submenú. Colas, SLA, monitoreo e historial: siguiente fase.
 */
export const moduloConversaciones: Modulo = {
  id: "conversaciones",
  label: "Conversaciones",
  href: "/conversaciones",
  icon: "messages",
  familia: "Omnicanal",
};
