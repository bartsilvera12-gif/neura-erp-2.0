"use client";

/**
 * /omnicanal — Panel Omnicanal (el ítem "Omnicanal" del menú abre acá): una tarjeta con foto por
 * pantalla (PanelModulo → TarjetaImagen). Las rutas no cambian (/conversaciones, …/finalizadas,
 * …/monitoreo, …/historial). Se muestran solo las que el perfil puede abrir; Monitoreo es nivel
 * ADMIN en los perfiles, pero también la ve un supervisor de cola (`acceso`). Configuración de
 * colas no es tarjeta: se entra desde Monitoreo. Fotos y créditos: public/omnicanal/ y
 * docs/creditos-imagenes-demo.md (sección "Panel Omnicanal").
 */
import { PanelModulo, hslDeMarca, type TarjetaPanel } from "@/components/ui/PanelModulo";
import { clienteConfig } from "@/cliente.config";

const TARJETAS: TarjetaPanel[] = [
  { href: "/conversaciones", titulo: "Conversaciones", imagen: "/omnicanal/conversaciones-chat-dueno.webp", color: hslDeMarca(clienteConfig.color), posicion: "55% 45%" },
  { href: "/conversaciones/finalizadas", titulo: "Finalizadas", imagen: "/omnicanal/finalizadas-checklist-dueno.webp", color: "152 34% 22%", posicion: "40% 35%" },
  {
    href: "/conversaciones/monitoreo", titulo: "Monitoreo", imagen: "/omnicanal/monitoreo-pantallas-dueno.webp", color: "214 40% 24%", posicion: "45% 35%",
    acceso: "/api/conversaciones/monitoreo/acceso",
  },
  { href: "/conversaciones/historial", titulo: "Historial omnicanal", imagen: "/omnicanal/historial-archivo-dueno.webp", color: "28 40% 23%", posicion: "50% 40%" },
];

export default function PanelOmnicanalPage() {
  return (
    <PanelModulo
      kicker="Atención al cliente"
      titulo="Omnicanal"
      subtitulo="Chats de todos los canales, su seguimiento y el historial de cada contacto."
      tarjetas={TARJETAS}
      vacio="No tenés pantallas de Omnicanal habilitadas."
    />
  );
}
