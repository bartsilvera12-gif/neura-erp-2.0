import type { Modulo } from "@/modules/types";

/**
 * Omnicanal: un solo ítem del menú (familia "Omnicanal") que abre /omnicanal, un panel con una
 * tarjeta con foto por pantalla (como Inventario y Configuración):
 *   · Conversaciones: bandeja omnicanal (WhatsApp y, más adelante, IG/Messenger) con pestañas
 *     Mías / Sin asignar / Todas / Cerradas, chat en vivo, notas, etiquetas, plantillas,
 *     transferir y finalizar con tipificación. Colas con asignación automática y SLA.
 *   · Finalizadas: conversaciones cerradas con su tipificación.
 *   · Monitoreo: centro de control. En el menú/perfiles solo nivel ADMIN; la página y la API
 *     también dejan entrar a los supervisores de una cola (chat_cola_agentes.es_supervisor):
 *     `accesoPropio` (el guard no corta) y el panel les muestra la tarjeta
 *     (/api/conversaciones/monitoreo/acceso). Colas se configura desde Monitoreo
 *     (/conversaciones/monitoreo/colas, no es tarjeta).
 *   · Historial omnicanal: todas las conversaciones de un contacto.
 * Las rutas de las pantallas son las mismas de antes (cuando eran 4 ítems sueltos), así los
 * perfiles guardados (perfil_pantallas, por href) siguen valiendo. Se mantiene el id
 * "conversaciones" del módulo.
 */
export const moduloOmnicanal: Modulo = {
  id: "conversaciones",
  label: "Omnicanal",
  href: "/omnicanal",
  panel: true,
  icon: "messages",
  familia: "Omnicanal",
  children: [
    { label: "Conversaciones", href: "/conversaciones" },
    { label: "Finalizadas", href: "/conversaciones/finalizadas" },
    { label: "Monitoreo", href: "/conversaciones/monitoreo", roles: ["ADMIN"], accesoPropio: true },
    { label: "Historial omnicanal", href: "/conversaciones/historial" },
  ],
};
