"use client";

/**
 * /gastos-empresariales/panel — Panel de Gastos empresariales (la tarjeta de /finanzas abre acá):
 * una tarjeta con foto por sub-pantalla (PanelModulo → TarjetaImagen). Las rutas no cambian (el
 * Resumen sigue en /gastos-empresariales). Acá no se muestran las pestañas del módulo
 * (PestanasGastos). Fotos y créditos: public/finanzas/ y docs/creditos-imagenes-demo.md
 * (sección "Panel Finanzas").
 */
import { PanelModulo, hslDeMarca, type TarjetaPanel } from "@/components/ui/PanelModulo";
import { clienteConfig } from "@/cliente.config";

const TARJETAS: TarjetaPanel[] = [
  { href: "/gastos-empresariales", titulo: "Resumen", imagen: "/finanzas/gastos-resumen-graficos-papel.webp", color: hslDeMarca(clienteConfig.color), posicion: "55% 45%" },
  { href: "/gastos-empresariales/compras-gastos", titulo: "Compras y gastos", imagen: "/finanzas/compras-canasto-supermercado.webp", color: "26 50% 24%", posicion: "45% 55%" },
  { href: "/compras/ordenes", titulo: "Órdenes de compra", imagen: "/finanzas/ordenes-compra-caja-pedido.webp", color: "205 32% 21%", posicion: "30% 60%" },
  { href: "/proveedores", titulo: "Proveedores", imagen: "/finanzas/proveedores-apreton-manos.webp", color: "258 28% 30%", posicion: "50% 60%" },
  { href: "/compras/pagos", titulo: "Pagos a proveedores", imagen: "/finanzas/pagos-proveedores-celular-laptop.webp", color: "214 40% 24%", posicion: "50% 50%" },
  { href: "/gastos-empresariales/recurrentes", titulo: "Recurrentes", imagen: "/finanzas/recurrentes-calendario-mensual.webp", color: "150 38% 22%", posicion: "50% 35%" },
];

export default function PanelGastosPage() {
  return (
    <PanelModulo
      volver={{ href: "/finanzas", label: "Finanzas" }}
      kicker="Finanzas"
      titulo="Gastos empresariales"
      subtitulo="Compras de mercadería, gastos de la empresa, proveedores y lo que se les paga."
      tarjetas={TARJETAS}
      vacio="No tenés pantallas de Gastos empresariales habilitadas."
    />
  );
}
