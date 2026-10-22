"use client";

/**
 * /soporte/panel — Panel de Soporte (el ítem "Soporte" del menú abre acá): una tarjeta con foto por
 * sub-pantalla (PanelModulo → TarjetaImagen). Las rutas de las pantallas no cambian (Dashboard sigue
 * en /soporte). Vive bajo el layout de /soporte, así que entra solo quien hoy entra al módulo (ADMIN o
 * usuarios.usa_soporte). Además del perfil, las tarjetas siguen lo mismo que ya deciden las pantallas
 * con /api/soporte/acceso: Dashboard solo si `dashboard` (técnicos y QA van directo a Mis tickets) y
 * Configuración solo si `configuracion` (ADMIN). Fotos y créditos: public/soporte/ y
 * docs/creditos-imagenes-demo.md (sección "Panel Soporte").
 */
import { useEffect, useMemo, useState } from "react";
import { PanelModulo, hslDeMarca, type TarjetaPanel } from "@/components/ui/PanelModulo";
import { clienteConfig } from "@/cliente.config";
import { apiSoporte } from "@/modules/soporte/api";

const TARJETAS: TarjetaPanel[] = [
  { href: "/soporte", titulo: "Dashboard", imagen: "/soporte/dashboard-metricas-pantalla.webp", color: hslDeMarca(clienteConfig.color), posicion: "50% 25%" },
  { href: "/soporte/tickets", titulo: "Tickets", imagen: "/soporte/tickets-mesa-ayuda.webp", color: "214 40% 25%", posicion: "55% 45%" },
  { href: "/soporte/mis-tickets", titulo: "Mis tickets", imagen: "/soporte/mis-tickets-lista-pendientes.webp", color: "258 28% 30%", posicion: "60% 40%" },
  { href: "/soporte/configuracion", titulo: "Configuración", imagen: "/soporte/configuracion-engranajes.webp", color: "205 22% 22%", posicion: "40% 85%" },
];

type Acceso = { dashboard: boolean; configuracion: boolean };

export default function PanelSoportePage() {
  const [acceso, setAcceso] = useState<Acceso | null>(null);

  useEffect(() => {
    let vivo = true;
    apiSoporte<Acceso>("/api/soporte/acceso")
      .then((a) => vivo && setAcceso(a))
      // Sin acceso, el layout de /soporte ya muestra "Acceso denegado"; acá solo se deja de esperar.
      .catch(() => vivo && setAcceso({ dashboard: false, configuracion: false }));
    return () => {
      vivo = false;
    };
  }, []);

  const tarjetas = useMemo(
    () =>
      !acceso
        ? TARJETAS
        : TARJETAS.filter((t) => (t.href === "/soporte" ? acceso.dashboard : t.href === "/soporte/configuracion" ? acceso.configuracion : true)),
    [acceso],
  );

  return (
    <PanelModulo
      kicker="Soporte"
      titulo="Soporte"
      subtitulo="Los tickets de los clientes: el estado general, la cola de trabajo y lo que te toca a vos."
      tarjetas={tarjetas}
      cargando={!acceso}
      vacio="No tenés pantallas de Soporte habilitadas."
    />
  );
}
