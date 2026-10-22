"use client";

/**
 * /configuracion — Panel de Configuración: una tarjeta con foto por sub-módulo (PanelModulo →
 * TarjetaImagen), solo con el título y la flecha. Se muestran solo las que el perfil puede abrir
 * (mismas reglas que el menú y el guard).
 */
import { PanelModulo, hslDeMarca, type TarjetaPanel } from "@/components/ui/PanelModulo";
import { clienteConfig } from "@/cliente.config";

const TARJETAS: TarjetaPanel[] = [
  { href: "/configuracion/empresa", titulo: "Datos de la empresa", imagen: "/configuracion/empresa-edificios.webp", color: hslDeMarca(clienteConfig.color), posicion: "50% 35%" },
  { href: "/configuracion/facturacion", titulo: "Facturación", imagen: "/configuracion/facturacion-calculadora.webp", color: "222 47% 27%", posicion: "60% 40%" },
  { href: "/configuracion/mesas", titulo: "Mesas y QR", imagen: "/finanzas/nueva-venta-escaner-celular.webp", color: "196 45% 24%", posicion: "50% 45%" },
  { href: "/configuracion/usuarios", titulo: "Usuarios", imagen: "/configuracion/usuarios-equipo.webp", color: "28 62% 24%", posicion: "45% 45%" },
];

export default function ConfiguracionPage() {
  return <PanelModulo kicker="Ajustes" titulo="Configuración" subtitulo="Elegí qué querés configurar." tarjetas={TARJETAS} vacio="No tenés configuraciones habilitadas." />;
}
